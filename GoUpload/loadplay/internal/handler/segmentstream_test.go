package handler

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"errors"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"testing/iotest"
	"time"

	"github.com/gofiber/fiber/v2"

	"goupload/lib/logger"
	"goupload/loadplay/internal/diskcache"
	"goupload/loadplay/lib/storage"
)

func randomBytes(n int, seed int64) []byte {
	out := make([]byte, n)
	rand.New(rand.NewSource(seed)).Read(out)
	return out
}

// openSealed decrypts as a player would and checks the padding.
func openSealed(t *testing.T, key []byte, seq uint64, sealed []byte) []byte {
	t.Helper()
	if len(sealed) == 0 || len(sealed)%aes.BlockSize != 0 {
		t.Fatalf("sealed length %d is not whole blocks", len(sealed))
	}
	block, _ := aes.NewCipher(key)
	iv := make([]byte, aes.BlockSize)
	binary.BigEndian.PutUint64(iv[8:], seq)
	out := make([]byte, len(sealed))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(out, sealed)
	pad := int(out[len(out)-1])
	if pad < 1 || pad > aes.BlockSize || !bytes.Equal(out[len(out)-pad:], bytes.Repeat([]byte{byte(pad)}, pad)) {
		t.Fatalf("bad padding %d", pad)
	}
	return out[:len(out)-pad]
}

func TestSealingReaderIsHLSAES128(t *testing.T) {
	key := segmentKey(testSecret, keyedToken())
	wraps := map[string]func(io.Reader) io.Reader{
		"whole":    func(r io.Reader) io.Reader { return r },
		"one byte": iotest.OneByteReader,
		"half":     iotest.HalfReader,
		"data+eof": iotest.DataErrReader,
	}
	for _, size := range []int{0, 1, 15, 16, 17, 188 * 7, sealChunk - 1, sealChunk, sealChunk + 17, 3*sealChunk + 5} {
		plain := randomBytes(size, int64(size))
		for name, wrap := range wraps {
			if name == "one byte" && size > sealChunk {
				continue
			}
			mode, err := segmentSealer(key, 42)
			if err != nil {
				t.Fatal(err)
			}
			sealed, err := io.ReadAll(newSealingReader(wrap(bytes.NewReader(plain)), mode))
			if err != nil {
				t.Fatalf("%s/%d: %v", name, size, err)
			}
			if len(sealed) != sealedSize(size) {
				t.Fatalf("%s/%d: sealed to %d, want %d", name, size, len(sealed), sealedSize(size))
			}
			if got := openSealed(t, key, 42, sealed); !bytes.Equal(got, plain) {
				t.Fatalf("%s/%d: did not round trip", name, size)
			}
		}
	}
}

func TestSealingReaderPassesOnAFailedSource(t *testing.T) {
	key := segmentKey(testSecret, keyedToken())
	mode, _ := segmentSealer(key, 7)
	plain := randomBytes(40, 1)
	boom := errors.New("upstream went away")
	sealed, err := io.ReadAll(newSealingReader(io.MultiReader(bytes.NewReader(plain), iotest.ErrReader(boom)), mode))
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the source's error", err)
	}
	// Only the whole blocks before the failure went out, and sealed.
	if len(sealed) != 32 || bytes.Contains(sealed, plain[:16]) {
		t.Fatalf("leaked %d bytes before the error", len(sealed))
	}
}

func TestObjectFillFeedsReadersAsItDownloads(t *testing.T) {
	plain := randomBytes(5*sealChunk+3, 2)
	fill := newObjectFill(len(plain))
	pr, pw := io.Pipe()
	var got []byte
	var readErr error
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		got, readErr = io.ReadAll(fill.reader())
	}()
	go func() {
		for off := 0; off < len(plain); off += 1000 {
			pw.Write(plain[off:min(off+1000, len(plain))])
		}
		pw.Close()
	}()
	if err := fill.readFrom(pr, maxSegmentBytes); err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	if readErr != nil || !bytes.Equal(got, plain) || !bytes.Equal(fill.bytes(), plain) {
		t.Fatalf("reader got %d bytes err=%v", len(got), readErr)
	}
}

func TestObjectFillStopsAtTheCap(t *testing.T) {
	fill := newObjectFill(-1)
	if err := fill.readFrom(bytes.NewReader(make([]byte, 100)), 64); !errors.Is(err, errSegmentTooLarge) {
		t.Fatalf("err = %v", err)
	}
	if _, err := io.ReadAll(fill.reader()); !errors.Is(err, errSegmentTooLarge) {
		t.Fatalf("reader err = %v, a capped object must not read as complete", err)
	}
}

// memUpstream answers every storage fetch with body, unless failing.
type memUpstream struct {
	mu        sync.Mutex
	calls     int
	body      []byte
	sendSize  bool
	cutAfter  int
	unhealthy bool
}

func (m *memUpstream) RoundTrip(req *http.Request) (*http.Response, error) {
	m.mu.Lock()
	m.calls++
	m.mu.Unlock()
	if m.unhealthy {
		return nil, errors.New("upstream down")
	}
	var body io.Reader = bytes.NewReader(m.body)
	size := int64(-1)
	if m.sendSize {
		size = int64(len(m.body))
	}
	if m.cutAfter > 0 {
		body = io.MultiReader(bytes.NewReader(m.body[:m.cutAfter]), iotest.ErrReader(io.ErrUnexpectedEOF))
	}
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(body), ContentLength: size, Header: http.Header{}, Request: req}, nil
}

func keyedSegmentApp(t *testing.T, up *memUpstream, cache *diskcache.Cache, key []byte) *fiber.App {
	t.Helper()
	deps := ManifestDeps{Log: logger.New(16), HTTPClient: &http.Client{Transport: up}, SegmentCache: cache}
	st := storage.Config{Owner: "o", Repo: "r"}
	app := fiber.New()
	app.Get("/*", func(c *fiber.Ctx) error {
		return streamKeyedObject(c, deps, st, c.Params("*"), key, 9)
	})
	return app
}

func waitForCache(t *testing.T, cache *diskcache.Cache, key string) []byte {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if data, ok := cache.Get(key); ok {
			return data
		}
		time.Sleep(10 * time.Millisecond)
	}
	return nil
}

func TestKeyedSegmentStreamsSealedAndFillsTheCache(t *testing.T) {
	key := segmentKey(testSecret, keyedToken())
	plain := randomBytes(3*sealChunk+11, 3)
	const segPath = "01_02_2026/abc/720p/0001.ts"
	for _, sendSize := range []bool{true, false} {
		cache, err := diskcache.New(t.TempDir(), 1<<30, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		up := &memUpstream{body: plain, sendSize: sendSize}
		app := keyedSegmentApp(t, up, cache, key)

		res, err := app.Test(httptest.NewRequest("GET", "/"+segPath, nil), -1)
		if err != nil {
			t.Fatal(err)
		}
		sealed, err := io.ReadAll(res.Body)
		if err != nil || res.StatusCode != fiber.StatusOK {
			t.Fatalf("size known=%v: status %d err=%v", sendSize, res.StatusCode, err)
		}
		if sendSize && res.Header.Get("Content-Length") != strconv.Itoa(sealedSize(len(plain))) {
			t.Fatalf("Content-Length = %q", res.Header.Get("Content-Length"))
		}
		if got := openSealed(t, key, 9, sealed); !bytes.Equal(got, plain) {
			t.Fatalf("size known=%v: did not round trip", sendSize)
		}

		cacheKey := segmentCacheKey(storage.Config{Owner: "o", Repo: "r"}, segPath)
		if cached := waitForCache(t, cache, cacheKey); !bytes.Equal(cached, plain) {
			t.Fatalf("cache holds %d bytes, want the plain segment", len(cached))
		}

		up.unhealthy = true
		res, err = app.Test(httptest.NewRequest("GET", "/"+segPath, nil), -1)
		if err != nil {
			t.Fatal(err)
		}
		sealed, _ = io.ReadAll(res.Body)
		if res.StatusCode != fiber.StatusOK || !bytes.Equal(openSealed(t, key, 9, sealed), plain) {
			t.Fatalf("cached replay failed: status %d", res.StatusCode)
		}
		if up.calls != 1 {
			t.Fatalf("upstream fetched %d times, want once", up.calls)
		}
	}
}

func TestKeyedSegmentCutShortIsNeverCompleteOrCached(t *testing.T) {
	key := segmentKey(testSecret, keyedToken())
	plain := randomBytes(2*sealChunk, 4)
	const segPath = "01_02_2026/abc/720p/0002.ts"
	cache, err := diskcache.New(t.TempDir(), 1<<30, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	up := &memUpstream{body: plain, sendSize: true, cutAfter: sealChunk + 5}
	app := keyedSegmentApp(t, up, cache, key)

	res, err := app.Test(httptest.NewRequest("GET", "/"+segPath, nil), -1)
	if err == nil {
		sealed, readErr := io.ReadAll(res.Body)
		if readErr == nil && len(sealed) == sealedSize(len(plain)) {
			t.Fatalf("a cut short fetch was sent as a whole segment")
		}
		if bytes.Contains(sealed, plain[:64]) {
			t.Fatalf("plaintext reached the client")
		}
	}
	time.Sleep(100 * time.Millisecond)
	if _, ok := cache.Get(segmentCacheKey(storage.Config{Owner: "o", Repo: "r"}, segPath)); ok {
		t.Fatalf("a cut short fetch was cached")
	}
}
