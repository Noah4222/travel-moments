package oss

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
	"strconv"
	"strings"

	_ "image/gif" // register gif decoder
	_ "image/png" // register png decoder

	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // register webp decoder
)

// defaultImageProcessor implements a small subset of OSS image-process
// parameters good enough for mock testing.
//
// Supported (image/...):
//   - resize: m_lfit, w_<int>, h_<int>
//   - quality,q_<int>
//   - format,<jpg|png>  (webp falls back to jpg in mock)
//
// For video/snapshot it returns a placeholder PNG; for unrecognized parameters
// it returns nil to indicate "use original".
func defaultImageProcessor(raw []byte, srcMime, spec string) ([]byte, string) {
	if strings.HasPrefix(spec, "video/snapshot") {
		return videoSnapshotPlaceholder(), "image/png"
	}
	if !strings.HasPrefix(spec, "image/") {
		return nil, ""
	}
	if !strings.HasPrefix(srcMime, "image/") {
		return nil, ""
	}

	w, h, q, fmt := parseImageSpec(spec)

	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, ""
	}

	if w > 0 || h > 0 {
		img = lfitResize(img, w, h)
	}

	requestedFmt := fmt
	if fmt == "" {
		fmt = "jpg"
	}
	if fmt == "webp" || fmt == "avif" {
		// stdlib has no avif/webp encoder; encode jpeg but advertise the
		// requested mime so <picture> source type works in dev.
		fmt = "jpg"
	}
	data, mime := encode(img, fmt, q)
	switch requestedFmt {
	case "webp":
		return data, "image/webp"
	case "avif":
		return data, "image/avif"
	}
	return data, mime
}

// parseImageSpec parses the OSS image-process spec, e.g.
//
//	image/resize,m_lfit,w_480/quality,q_80/format,webp
//
// segments separated by "/", each segment is "action[,k_v[,k_v...]]" or
// "format,<value>".
func parseImageSpec(spec string) (w, h, q int, fmt string) {
	q = 80
	for _, seg := range strings.Split(spec, "/") {
		seg = strings.TrimSpace(seg)
		if seg == "" || seg == "image" {
			continue
		}
		parts := strings.Split(seg, ",")
		action := parts[0]
		for _, p := range parts[1:] {
			k, v, ok := strings.Cut(p, "_")
			if !ok {
				// no "_" — values like "format,webp" arrive as a single token
				if action == "format" {
					fmt = p
				}
				continue
			}
			n, _ := strconv.Atoi(v)
			switch k {
			case "w":
				w = n
			case "h":
				h = n
			case "q":
				q = n
			}
		}
	}
	return
}

func lfitResize(img image.Image, w, h int) image.Image {
	bounds := img.Bounds()
	srcW, srcH := bounds.Dx(), bounds.Dy()
	if w <= 0 {
		w = srcW
	}
	if h <= 0 {
		h = srcH
	}
	scaleW := float64(w) / float64(srcW)
	scaleH := float64(h) / float64(srcH)
	scale := scaleW
	if scaleH < scaleW {
		scale = scaleH
	}
	if scale >= 1 {
		return img
	}
	dstW := int(float64(srcW) * scale)
	dstH := int(float64(srcH) * scale)
	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, bounds, xdraw.Over, nil)
	return dst
}

func encode(img image.Image, fmt string, q int) ([]byte, string) {
	var buf bytes.Buffer
	switch fmt {
	case "png":
		_ = png.Encode(&buf, img)
		return buf.Bytes(), "image/png"
	default:
		if q <= 0 || q > 100 {
			q = 80
		}
		_ = jpeg.Encode(&buf, img, &jpeg.Options{Quality: q})
		return buf.Bytes(), "image/jpeg"
	}
}

// 1x1 dark gray PNG with a white triangle, base64-decoded once.
var videoSnapshotPNG = []byte{
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
	0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x80,
	0x08, 0x02, 0x00, 0x00, 0x00, 0x4D, 0x53, 0x29, 0x91, 0x00, 0x00, 0x00,
	0x21, 0x49, 0x44, 0x41, 0x54, 0x78, 0xDA, 0xED, 0xC1, 0x01, 0x0D, 0x00,
	0x00, 0x00, 0xC2, 0xA0, 0xF7, 0x4F, 0x6D, 0x0E, 0x37, 0xA0, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xBE, 0x0D, 0x21, 0x00, 0x00, 0x01,
	0x9A, 0x60, 0xE1, 0xD5, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
	0xAE, 0x42, 0x60, 0x82,
}

func videoSnapshotPlaceholder() []byte { return videoSnapshotPNG }
