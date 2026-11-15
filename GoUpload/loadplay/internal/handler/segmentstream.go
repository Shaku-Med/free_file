package handler

import (
	"crypto/aes"
	"crypto/cipher"
	"encoding/binary"
	"errors"
	"io"
	"sync"
)

const sealChunk = 32 << 10

var errSegmentTooLarge = errors.New("segment over the size cap")

// segmentSealer is HLS AES-128 for one segment: CBC with the segment's
// media sequence number as the IV.
func segmentSealer(key []byte, seq uint64) (cipher.BlockMode, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	iv := make([]byte, aes.BlockSize)
	binary.BigEndian.PutUint64(iv[8:], seq)
	return cipher.NewCBCEncrypter(block, iv), nil
}

// sealedSize is how long a segment of size bytes is once padded and sealed.
func sealedSize(size int) int {
	return size + aes.BlockSize - size%aes.BlockSize
}

// sealingReader encrypts src as it is read: whole blocks as they arrive, then
// the PKCS7 padded tail once src ends. What it returns is never plaintext,
// and an error from src is passed on rather than ending the stream early.
type sealingReader struct {
	src  io.Reader
	mode cipher.BlockMode
	in   []byte // plaintext still to seal, under a block long between fills
	buf  []byte
	out  []byte // sealed bytes not yet read, backed by buf
	done bool
}

func newSealingReader(src io.Reader, mode cipher.BlockMode) *sealingReader {
	return &sealingReader{
		src:  src,
		mode: mode,
		in:   make([]byte, 0, sealChunk+aes.BlockSize),
		buf:  make([]byte, sealChunk+aes.BlockSize),
	}
}

func (s *sealingReader) Read(p []byte) (int, error) {
	for len(s.out) == 0 {
		if s.done {
			return 0, io.EOF
		}
		if err := s.fill(); err != nil {
			return 0, err
		}
	}
	n := copy(p, s.out)
	s.out = s.out[n:]
	return n, nil
}

func (s *sealingReader) fill() error {
	n, err := s.src.Read(s.in[len(s.in):sealChunk])
	s.in = s.in[:len(s.in)+n]
	if err == io.EOF {
		pad := aes.BlockSize - len(s.in)%aes.BlockSize
		for i := 0; i < pad; i++ {
			s.in = append(s.in, byte(pad))
		}
		s.seal(len(s.in))
		s.done = true
		return nil
	}
	if err != nil {
		return err
	}
	s.seal(len(s.in) / aes.BlockSize * aes.BlockSize)
	return nil
}

func (s *sealingReader) seal(whole int) {
	s.out = s.buf[:whole]
	s.mode.CryptBlocks(s.out, s.in[:whole])
	s.in = s.in[:copy(s.in, s.in[whole:])]
}

// objectFill is an upstream object while it downloads. The download runs at
// upstream speed whatever the client does, so its gate slot and timeout only
// ever cover the fetch, and readers follow along as the bytes arrive.
type objectFill struct {
	mu   sync.Mutex
	grew *sync.Cond
	data []byte
	err  error // io.EOF once the whole object is in
}

func newObjectFill(sizeHint int) *objectFill {
	f := &objectFill{}
	if sizeHint > 0 {
		f.data = make([]byte, 0, sizeHint)
	}
	f.grew = sync.NewCond(&f.mu)
	return f
}

// readFrom copies src in until it ends, fails or passes limit bytes. It
// returns nil only once the object is complete.
func (f *objectFill) readFrom(src io.Reader, limit int) error {
	chunk := make([]byte, sealChunk)
	for {
		n, err := src.Read(chunk)
		f.mu.Lock()
		if n > 0 {
			if len(f.data)+n > limit {
				err = errSegmentTooLarge
			} else {
				f.data = append(f.data, chunk[:n]...)
			}
		}
		if err != nil {
			f.err = err
		}
		f.mu.Unlock()
		f.grew.Broadcast()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

// bytes is the finished object. Only call it after readFrom returned nil.
func (f *objectFill) bytes() []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.data
}

func (f *objectFill) reader() io.Reader {
	return &fillReader{f: f}
}

type fillReader struct {
	f   *objectFill
	off int
}

func (r *fillReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	f := r.f
	f.mu.Lock()
	defer f.mu.Unlock()
	for r.off == len(f.data) && f.err == nil {
		f.grew.Wait()
	}
	if r.off < len(f.data) {
		n := copy(p, f.data[r.off:])
		r.off += n
		return n, nil
	}
	return 0, f.err
}
