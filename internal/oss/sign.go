package oss

import (
	"time"

	alioss "github.com/aliyun/aliyun-oss-go-sdk/oss"
)

// Variant describes the kind of derived URL to sign.
type Variant string

const (
	VariantOriginal       Variant = "original"
	VariantThumbWebP      Variant = "thumb_webp"   // ~480px webp for grid
	VariantThumbAVIF      Variant = "thumb_avif"   // ~480px avif for grid
	VariantPreviewWebP    Variant = "preview_webp" // ~1600px webp for lightbox
	VariantPreviewAVIF    Variant = "preview_avif" // ~1600px avif for lightbox
	VariantCoverWebP      Variant = "cover_webp"   // album cover, high quality
	VariantCoverAVIF      Variant = "cover_avif"   // album cover, high quality
	VariantVideoCoverWebP Variant = "vcover_webp"  // video snapshot webp
	VariantVideoCoverAVIF Variant = "vcover_avif"  // video snapshot avif

	// Full-resolution re-encodes — same pixels as the source, just transcoded
	// to a smaller container. Useful as "high-quality preview" buttons in the
	// lightbox without downloading the raw original.
	VariantFullWebP Variant = "full_webp"
	VariantFullAVIF Variant = "full_avif"
)

// ImageProcess returns the OSS image-processing parameter for the variant, or
// "" for the original. AVIF requires 阿里云 OSS 图片处理高级套餐 enabled.
func ImageProcess(v Variant) string {
	switch v {
	case VariantThumbWebP:
		return "image/resize,m_lfit,w_480/quality,q_80/format,webp"
	case VariantThumbAVIF:
		return "image/resize,m_lfit,w_480/quality,q_70/format,avif"
	case VariantPreviewWebP:
		return "image/resize,m_lfit,w_1600/quality,q_85/format,webp"
	case VariantPreviewAVIF:
		return "image/resize,m_lfit,w_1600/quality,q_75/format,avif"
	case VariantCoverWebP:
		return "image/resize,m_lfit,w_1600/quality,q_90/format,webp"
	case VariantCoverAVIF:
		return "image/resize,m_lfit,w_1600/quality,q_80/format,avif"
	case VariantVideoCoverWebP:
		return "video/snapshot,t_1000,f_jpg,w_960"
	case VariantVideoCoverAVIF:
		return "video/snapshot,t_1000,f_jpg,w_960"
	case VariantFullWebP:
		return "image/quality,q_90/format,webp"
	case VariantFullAVIF:
		return "image/quality,q_80/format,avif"
	}
	return ""
}

// SignDownload signs a GET URL for the given object with optional OSS process
// parameter (e.g. image resize).
func (s *AliyunStorage) SignDownload(key string, process string, ttl time.Duration) (string, error) {
	return s.SignDownloadAttachment(key, process, "", ttl)
}

// SignDownloadAttachment signs a download URL and, when filename is provided,
// instructs OSS to set Content-Disposition: attachment so the browser saves it.
func (s *AliyunStorage) SignDownloadAttachment(key, process, filename string, ttl time.Duration) (string, error) {
	expSec := int64(ttl.Seconds())
	if expSec < 1 {
		expSec = 60
	}
	var opts []alioss.Option
	if process != "" {
		opts = append(opts, alioss.Process(process))
	}
	if filename != "" {
		disp := `attachment; filename="` + filename + `"`
		opts = append(opts, alioss.ResponseContentDisposition(disp))
	}
	return s.bucket.SignURL(key, alioss.HTTPGet, expSec, opts...)
}
