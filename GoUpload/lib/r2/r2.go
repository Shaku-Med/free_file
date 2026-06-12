// Package r2 is a tiny, self-contained S3-compatible client for Cloudflare
// R2. It implements only what this project needs (PutObject + presigned GET)
// with AWS SigV4 signing, so we avoid pulling the full AWS SDK.
//
// SECURITY: credentials come from env only (never hardcoded). Presigned URLs
// are generated server-side and must never be sent to a browser  callers
// proxy the bytes, exactly like the GitHub-raw path. The bucket stays private.
package r2

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"goupload/lib/env"
)

const (
	service         = "s3"
	algorithm       = "AWS4-HMAC-SHA256"
	unsignedPayload = "UNSIGNED-PAYLOAD"
)

type Config struct {
	AccountID       string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	Endpoint        string // optional; default https://<account>.r2.cloudflarestorage.com
	Region          string // default "auto"
}

type Client struct {
	cfg    Config
	scheme string
	host   string
	http   *http.Client
}

// FromEnv builds a client from R2_* env vars, or nil when not configured.
// nil is a valid "R2 disabled" signal  callers fall back to GitHub.
func FromEnv() *Client {
	c, err := New(Config{
		AccountID:       env.Get("R2_ACCOUNT_ID", ""),
		AccessKeyID:     env.Get("R2_ACCESS_KEY_ID", ""),
		SecretAccessKey: env.Get("R2_SECRET_ACCESS_KEY", ""),
		Bucket:          env.Get("R2_BUCKET", ""),
		Endpoint:        env.Get("R2_ENDPOINT", ""),
		Region:          env.Get("R2_REGION", "auto"),
	})
	if err != nil {
		return nil
	}
	return c
}

func New(cfg Config) (*Client, error) {
	if cfg.AccessKeyID == "" || cfg.SecretAccessKey == "" || cfg.Bucket == "" {
		return nil, errors.New("r2: missing credentials or bucket")
	}
	if cfg.Region == "" {
		cfg.Region = "auto"
	}
	endpoint := strings.TrimRight(cfg.Endpoint, "/")
	if endpoint == "" {
		if cfg.AccountID == "" {
			return nil, errors.New("r2: need R2_ENDPOINT or R2_ACCOUNT_ID")
		}
		endpoint = "https://" + cfg.AccountID + ".r2.cloudflarestorage.com"
	}
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" || u.Scheme == "" {
		return nil, errors.New("r2: invalid endpoint")
	}
	return &Client{
		cfg:    cfg,
		scheme: u.Scheme,
		host:   u.Host,
		http:   &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (c *Client) Bucket() string { return c.cfg.Bucket }

// PutObject uploads bytes to key (path-style /<bucket>/<key>). Body is read
// fully into memory by the caller; intended for the small objects this
// pipeline writes (HLS segments, thumbnails, images, manifests).
func (c *Client) PutObject(ctx context.Context, key string, body []byte, contentType string) error {
	if key == "" {
		return errors.New("r2: empty key")
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := sha256Hex(body)
	canonicalURI := c.canonicalURI(key)

	canonicalHeaders := "content-type:" + contentType + "\n" +
		"host:" + c.host + "\n" +
		"x-amz-content-sha256:" + payloadHash + "\n" +
		"x-amz-date:" + amzDate + "\n"
	signedHeaders := "content-type;host;x-amz-content-sha256;x-amz-date"

	canonicalRequest := "PUT\n" + canonicalURI + "\n\n" +
		canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash
	auth := c.authorization(dateStamp, amzDate, signedHeaders, canonicalRequest)

	req, err := http.NewRequestWithContext(ctx, http.MethodPut, c.urlFor(key, canonicalURI), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("Authorization", auth)

	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4<<10))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("r2: put %s status %d", key, res.StatusCode)
	}
	return nil
}

// DeleteObject removes an object. 404 is treated as success (idempotent).
func (c *Client) DeleteObject(ctx context.Context, key string) error {
	if key == "" {
		return errors.New("r2: empty key")
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := sha256Hex(nil)
	canonicalURI := c.canonicalURI(key)

	canonicalHeaders := "host:" + c.host + "\n" +
		"x-amz-content-sha256:" + payloadHash + "\n" +
		"x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"

	canonicalRequest := "DELETE\n" + canonicalURI + "\n\n" +
		canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash
	auth := c.authorization(dateStamp, amzDate, signedHeaders, canonicalRequest)

	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.urlFor(key, canonicalURI), nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("Authorization", auth)

	res, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4<<10))
	if res.StatusCode == 200 || res.StatusCode == 204 || res.StatusCode == 404 {
		return nil
	}
	return fmt.Errorf("r2: delete %s status %d", key, res.StatusCode)
}

// listBucketResult is the subset of the ListObjectsV2 XML we consume.
type listBucketResult struct {
	IsTruncated           bool   `xml:"IsTruncated"`
	NextContinuationToken string `xml:"NextContinuationToken"`
	Contents              []struct {
		Key string `xml:"Key"`
	} `xml:"Contents"`
}

// ListKeys returns up to max object keys under prefix (ListObjectsV2,
// paginated). Server-side use only  feeds the purge flow that deletes a
// file's whole storage directory.
func (c *Client) ListKeys(ctx context.Context, prefix string, max int) ([]string, error) {
	if prefix == "" {
		return nil, errors.New("r2: empty prefix")
	}
	if max <= 0 {
		max = 10000
	}
	var keys []string
	token := ""
	for {
		q := url.Values{}
		q.Set("list-type", "2")
		q.Set("prefix", prefix)
		q.Set("max-keys", "1000")
		if token != "" {
			q.Set("continuation-token", token)
		}
		body, err := c.signedGet(ctx, q)
		if err != nil {
			return nil, err
		}
		var page listBucketResult
		if err := xml.Unmarshal(body, &page); err != nil {
			return nil, fmt.Errorf("r2: list parse: %w", err)
		}
		for _, o := range page.Contents {
			if o.Key == "" {
				continue
			}
			keys = append(keys, o.Key)
			if len(keys) >= max {
				return keys, nil
			}
		}
		if !page.IsTruncated || page.NextContinuationToken == "" {
			break
		}
		token = page.NextContinuationToken
	}
	return keys, nil
}

// signedGet performs a SigV4-signed GET against the bucket root with query
// params (used for listings).
func (c *Client) signedGet(ctx context.Context, q url.Values) ([]byte, error) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := sha256Hex(nil)
	canonicalURI := "/" + uriEncode(c.cfg.Bucket, true)
	canonicalQuery := encodeQuerySorted(q)

	canonicalHeaders := "host:" + c.host + "\n" +
		"x-amz-content-sha256:" + payloadHash + "\n" +
		"x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"

	canonicalRequest := "GET\n" + canonicalURI + "\n" + canonicalQuery + "\n" +
		canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash
	auth := c.authorization(dateStamp, amzDate, signedHeaders, canonicalRequest)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.scheme+"://"+c.host+canonicalURI+"?"+canonicalQuery, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("Authorization", auth)

	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	data, readErr := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("r2: list status %d", res.StatusCode)
	}
	return data, readErr
}

// PresignGet returns a short-lived signed GET URL. Server-side use only.
func (c *Client) PresignGet(key string, ttl time.Duration) (string, error) {
	if key == "" {
		return "", errors.New("r2: empty key")
	}
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	scope := dateStamp + "/" + c.cfg.Region + "/" + service + "/aws4_request"
	canonicalURI := c.canonicalURI(key)
	signedHeaders := "host"

	q := url.Values{}
	q.Set("X-Amz-Algorithm", algorithm)
	q.Set("X-Amz-Credential", c.cfg.AccessKeyID+"/"+scope)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", strconv.Itoa(int(ttl.Seconds())))
	q.Set("X-Amz-SignedHeaders", signedHeaders)
	canonicalQuery := encodeQuerySorted(q)

	canonicalHeaders := "host:" + c.host + "\n"
	canonicalRequest := "GET\n" + canonicalURI + "\n" + canonicalQuery + "\n" +
		canonicalHeaders + "\n" + signedHeaders + "\n" + unsignedPayload
	sts := algorithm + "\n" + amzDate + "\n" + scope + "\n" + sha256Hex([]byte(canonicalRequest))
	signature := hex.EncodeToString(hmacSHA256(c.signingKey(dateStamp), []byte(sts)))

	return c.scheme + "://" + c.host + canonicalURI + "?" + canonicalQuery + "&X-Amz-Signature=" + signature, nil
}

func (c *Client) authorization(dateStamp, amzDate, signedHeaders, canonicalRequest string) string {
	scope := dateStamp + "/" + c.cfg.Region + "/" + service + "/aws4_request"
	sts := algorithm + "\n" + amzDate + "\n" + scope + "\n" + sha256Hex([]byte(canonicalRequest))
	signature := hex.EncodeToString(hmacSHA256(c.signingKey(dateStamp), []byte(sts)))
	return algorithm + " Credential=" + c.cfg.AccessKeyID + "/" + scope +
		", SignedHeaders=" + signedHeaders + ", Signature=" + signature
}

// canonicalURI is path-style: /<bucket>/<key> with each segment URI-encoded
// (slashes inside the key preserved).
func (c *Client) canonicalURI(key string) string {
	return "/" + uriEncode(c.cfg.Bucket, true) + "/" + uriEncode(key, false)
}

func (c *Client) urlFor(key, canonicalURI string) string {
	u := &url.URL{Scheme: c.scheme, Host: c.host}
	u.Path = "/" + c.cfg.Bucket + "/" + key
	u.RawPath = canonicalURI
	return u.String()
}

func (c *Client) signingKey(dateStamp string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+c.cfg.SecretAccessKey), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(c.cfg.Region))
	kService := hmacSHA256(kRegion, []byte(service))
	return hmacSHA256(kService, []byte("aws4_request"))
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// uriEncode follows AWS SigV4 rules: unreserved chars pass through, space is
// %20, everything else is percent-encoded. '/' is kept when encodeSlash=false
// so object-key path separators survive.
func uriEncode(s string, encodeSlash bool) string {
	var b strings.Builder
	b.Grow(len(s) + 8)
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch {
		case (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') ||
			(ch >= '0' && ch <= '9') || ch == '-' || ch == '_' || ch == '.' || ch == '~':
			b.WriteByte(ch)
		case ch == '/' && !encodeSlash:
			b.WriteByte('/')
		default:
			fmt.Fprintf(&b, "%%%02X", ch)
		}
	}
	return b.String()
}

func encodeQuerySorted(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		ek := uriEncode(k, true)
		for _, v := range q[k] {
			parts = append(parts, ek+"="+uriEncode(v, true))
		}
	}
	return strings.Join(parts, "&")
}
