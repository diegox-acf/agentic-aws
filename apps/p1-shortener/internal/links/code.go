package links

import (
	"crypto/rand"
	"fmt"
	"io"
)

const (
	codeLength   = 7
	codeAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	// rejectFrom is the largest multiple of 62 that fits in a byte (4 * 62 = 248). Bytes at or
	// above it are discarded: keeping them would make b % 62 favour the first 8 characters.
	rejectFrom = 248
	// Each byte is kept with probability 248/256, so 16 bytes almost always yield 7 characters
	// in a single read; the loop reads again in the rare case they don't.
	readBatch = 16
)

// NewCode returns a random 7-character base62 code.
func NewCode() (string, error) {
	return codeFrom(rand.Reader)
}

// codeFrom builds a code from the bytes of r using rejection sampling.
func codeFrom(r io.Reader) (string, error) {
	code := make([]byte, 0, codeLength)
	buf := make([]byte, readBatch)
	for len(code) < codeLength {
		n, err := r.Read(buf)
		if n == 0 && err != nil {
			return "", fmt.Errorf("read random bytes: %w", err)
		}
		for _, b := range buf[:n] {
			if b >= rejectFrom {
				continue
			}
			code = append(code, codeAlphabet[b%byte(len(codeAlphabet))])
			if len(code) == codeLength {
				break
			}
		}
	}
	return string(code), nil
}

// ValidCode reports whether code has the shape NewCode produces.
func ValidCode(code string) bool {
	if len(code) != codeLength {
		return false
	}
	for i := 0; i < len(code); i++ {
		if !isBase62(code[i]) {
			return false
		}
	}
	return true
}

func isBase62(c byte) bool {
	return ('0' <= c && c <= '9') || ('A' <= c && c <= 'Z') || ('a' <= c && c <= 'z')
}
