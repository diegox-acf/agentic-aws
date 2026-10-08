package links

import (
	"bytes"
	"testing"
)

func TestValidCode(t *testing.T) {
	tests := []struct {
		name string
		code string
		want bool
	}{
		{"digits and letters", "aB3xY9z", true},
		{"all digits", "0123456", true},
		{"empty", "", false},
		{"too short", "abc123", false},
		{"too long", "abc12345", false},
		{"dash", "abc-123", false},
		{"underscore", "abc_123", false},
		{"slash", "abc/123", false},
		{"non-ascii (7 bytes, 6 runes)", "abcdeé", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ValidCode(tt.code); got != tt.want {
				t.Errorf("ValidCode(%q) = %v, want %v", tt.code, got, tt.want)
			}
		})
	}
}

func TestNewCode_ProducesValidCodes(t *testing.T) {
	seen := map[string]bool{}
	for range 1000 {
		code, err := NewCode()
		if err != nil {
			t.Fatalf("NewCode() error = %v", err)
		}
		if !ValidCode(code) {
			t.Fatalf("NewCode() = %q, not a valid code", code)
		}
		seen[code] = true
	}
	// 1000 draws from 62^7 values: any repeat means the generator is broken.
	if len(seen) != 1000 {
		t.Errorf("got %d unique codes out of 1000", len(seen))
	}
}

func TestCodeFrom(t *testing.T) {
	tests := []struct {
		name  string
		input []byte
		want  string
	}{
		{"maps byte value mod 62", []byte{0, 1, 61, 62, 123, 247, 10}, "01z0zzA"},
		{"skips bytes >= 248", []byte{248, 255, 0, 250, 1, 2, 3, 4, 5, 6}, "0123456"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := codeFrom(bytes.NewReader(tt.input))
			if err != nil {
				t.Fatalf("codeFrom() error = %v", err)
			}
			if got != tt.want {
				t.Errorf("codeFrom() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCodeFrom_ShortReaderFails(t *testing.T) {
	// Only 6 usable bytes: the generator must report an error, not return a short code.
	if _, err := codeFrom(bytes.NewReader([]byte{1, 2, 3, 4, 5, 6, 255})); err == nil {
		t.Fatal("codeFrom() error = nil, want error for exhausted reader")
	}
}
