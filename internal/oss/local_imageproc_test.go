package oss

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
)

func TestParseImageSpec(t *testing.T) {
	cases := []struct {
		name              string
		spec              string
		w, h, q           int
		fmt               string
	}{
		{
			name: "thumb",
			spec: "image/resize,m_lfit,w_480/quality,q_80/format,webp",
			w:    480, h: 0, q: 80, fmt: "webp",
		},
		{
			name: "preview",
			spec: "image/resize,m_lfit,w_1600/quality,q_85/format,webp",
			w:    1600, h: 0, q: 85, fmt: "webp",
		},
		{
			name: "wh",
			spec: "image/resize,w_300,h_200",
			w:    300, h: 200, q: 80, fmt: "",
		},
		{
			name: "format only",
			spec: "image/format,png",
			w:    0, h: 0, q: 80, fmt: "png",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w, h, q, f := parseImageSpec(tc.spec)
			if w != tc.w || h != tc.h || q != tc.q || f != tc.fmt {
				t.Fatalf("parseImageSpec(%q) = w=%d h=%d q=%d fmt=%q; want w=%d h=%d q=%d fmt=%q",
					tc.spec, w, h, q, f, tc.w, tc.h, tc.q, tc.fmt)
			}
		})
	}
}

func TestDefaultImageProcessorResize(t *testing.T) {
	src := makeJPEG(t, 1600, 1000)

	out, mime := defaultImageProcessor(src, "image/jpeg",
		"image/resize,m_lfit,w_480/quality,q_80/format,webp")
	if mime != "image/webp" { // mock advertises requested mime even if data is jpeg
		t.Fatalf("unexpected mime: %s", mime)
	}
	dec, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode result: %v", err)
	}
	b := dec.Bounds()
	if b.Dx() != 480 || b.Dy() != 300 {
		t.Fatalf("unexpected size %dx%d, want 480x300", b.Dx(), b.Dy())
	}
}

func TestDefaultImageProcessorNoUpscale(t *testing.T) {
	src := makeJPEG(t, 320, 200)
	out, _ := defaultImageProcessor(src, "image/jpeg",
		"image/resize,m_lfit,w_1600")
	dec, _, err := image.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatal(err)
	}
	b := dec.Bounds()
	if b.Dx() != 320 || b.Dy() != 200 {
		t.Fatalf("expected unchanged 320x200; got %dx%d", b.Dx(), b.Dy())
	}
}

func TestVideoSnapshotPlaceholder(t *testing.T) {
	out, mime := defaultImageProcessor(nil, "video/mp4", "video/snapshot,t_1000,f_jpg,w_480")
	if mime != "image/png" {
		t.Fatalf("expected png mime; got %s", mime)
	}
	if len(out) == 0 {
		t.Fatal("empty placeholder")
	}
}

func makeJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: 100, G: 150, B: 200, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
