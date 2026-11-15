package handler

import (
	"bufio"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"regexp"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"goupload/loadplay/internal/token"
)

// A downloader that copies the player's requests (same token, cookies,
// Origin, Referer, Sec-Fetch and UA) gets every byte the player does, so a
// keyed playback encrypts its segments with standard HLS AES-128 and hands
// the key only to the page that minted it. The mint response gives that page
// a proof secret; each key request carries a fresh random r and
// HMAC(proof, "key|"+r), and the key comes back masked with
// HMAC(proof, "mask|"+r). A request without the proof is refused, and a copy
// of the player's own request or response is useless without it. There is
// deliberately no "each r works once" memory: replaying only returns the same
// masked bytes, and the memory could be filled to lock everyone out.

// keyAssetName is where a playback's key is served, under the same /v/
// route as its playlists. Real assets always sit in a dated folder, so a
// bare name can't collide with one.
const keyAssetName = "lp.key"

const (
	segmentKeyLabel = "lp-segkey-v1|"
	proofKeyLabel   = "lp-proof-v1|"
	// Highest media sequence a segment request may name.
	maxSegmentSeq = 10_000_000
)

var keyNonceRe = regexp.MustCompile(`^[A-Za-z0-9_-]{16,64}$`)

func derive(secret []byte, label string, tok *token.Playback) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(label + tok.FileID + "|" + tok.Nonce))
	return mac.Sum(nil)
}

func segmentKey(secret []byte, tok *token.Playback) []byte {
	return derive(secret, segmentKeyLabel, tok)[:16]
}

func proofKey(secret []byte, tok *token.Playback) []byte {
	return derive(secret, proofKeyLabel, tok)
}

func macOf(key []byte, msg string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(msg))
	return mac.Sum(nil)
}

// encryptSegment is HLS AES-128: CBC over the whole segment with PKCS7
// padding, the IV being the segment's media sequence number.
func encryptSegment(key []byte, seq uint64, plain []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	iv := make([]byte, aes.BlockSize)
	binary.BigEndian.PutUint64(iv[8:], seq)
	pad := aes.BlockSize - len(plain)%aes.BlockSize
	out := make([]byte, len(plain)+pad)
	copy(out, plain)
	for i := len(plain); i < len(out); i++ {
		out[i] = byte(pad)
	}
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(out, out)
	return out, nil
}

// keyablePlaylist is a media playlist of whole .ts segments with no key,
// init section or byte ranges of its own: the only shape encrypted here.
func keyablePlaylist(body string) bool {
	segments := 0
	scanner := bufio.NewScanner(strings.NewReader(body))
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch {
		case line == "":
		case strings.HasPrefix(line, "#EXT-X-KEY"), strings.HasPrefix(line, "#EXT-X-MAP"),
			strings.HasPrefix(line, "#EXT-X-BYTERANGE"), strings.HasPrefix(line, "#EXT-X-STREAM-INF"):
			return false
		case strings.HasPrefix(line, "#"):
		default:
			// rewriteManifest drops absolute URLs, which would shift every
			// later segment's sequence number.
			lower := strings.ToLower(strings.SplitN(line, "?", 2)[0])
			if strings.Contains(lower, "://") || !strings.HasSuffix(lower, ".ts") {
				return false
			}
			segments++
		}
	}
	return scanner.Err() == nil && segments > 0
}

// segmentSeq is the media sequence a keyed segment request names.
func segmentSeq(raw string) (uint64, bool) {
	if raw == "" || len(raw) > 8 {
		return 0, false
	}
	n, err := strconv.ParseUint(raw, 10, 64)
	return n, err == nil && n <= maxSegmentSeq
}

// maskedKey checks a key request's proof, returning the key masked for that
// request, or why it was refused.
func maskedKey(secret []byte, tok *token.Playback, r, x string) ([]byte, string) {
	if !tok.IsKeyed() {
		return nil, "not_keyed"
	}
	got, err := base64.RawURLEncoding.DecodeString(x)
	if !keyNonceRe.MatchString(r) || err != nil {
		return nil, "malformed"
	}
	proof := proofKey(secret, tok)
	if !hmac.Equal(got, macOf(proof, "key|"+r)) {
		return nil, "mismatch"
	}
	key := segmentKey(secret, tok)
	mask := macOf(proof, "mask|"+r)
	out := make([]byte, len(key))
	for i := range out {
		out[i] = key[i] ^ mask[i]
	}
	return out, ""
}

// serveKey answers GET /v/:fileId/lp.key for a keyed token.
func serveKey(c *fiber.Ctx, deps ManifestDeps, tok *token.Playback) error {
	if c.Params("fileId") != tok.FileID {
		return deny(c, fiber.StatusForbidden)
	}
	// Access first, so a key is never spent on a file that's gone private.
	if _, denyStatus := resolveAccessAndStorage(c.Context(), deps, tok); denyStatus != 0 {
		return deny(c, denyStatus)
	}
	out, reason := maskedKey(deps.Secret, tok, c.Query("r"), c.Query("x"))
	if out == nil {
		deps.Log.Errorf("key refused reason=%s unique_id=%s nonce_prefix=%s", reason, tok.FileID, safePrefix(tok.Nonce))
		return deny(c, fiber.StatusForbidden)
	}
	setPlaybackResponseHeaders(c, deps)
	c.Set("Content-Type", "application/octet-stream")
	return c.Send(out)
}
