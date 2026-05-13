package oss

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"
)

type policyDoc struct {
	Expiration string          `json:"expiration"`
	Conditions [][]interface{} `json:"conditions"`
}

// SignUploadPolicy creates an exclusive single-key upload policy for OSS.
//
//   - key: exact object key the file will be stored as
//   - maxSize: max bytes accepted by OSS (default 500 MiB)
//   - ttl: how long the policy stays valid (default 30 min)
func (s *AliyunStorage) SignUploadPolicy(key string, maxSize int64, ttl time.Duration) (*UploadPolicy, error) {
	if maxSize <= 0 {
		maxSize = 500 << 20
	}
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	exp := time.Now().UTC().Add(ttl)

	cond := [][]interface{}{
		{"eq", "$bucket", s.cfg.Bucket},
		{"eq", "$key", key},
		{"content-length-range", 0, maxSize},
		// Allow (but do not require) the browser to set a Cache-Control header
		// on the new object — used to make immutable thumbs cache forever.
		{"starts-with", "$Cache-Control", ""},
	}
	doc := policyDoc{
		Expiration: exp.Format("2006-01-02T15:04:05.000Z"),
		Conditions: cond,
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		return nil, err
	}
	policyB64 := base64.StdEncoding.EncodeToString(raw)

	mac := hmac.New(sha1.New, []byte(s.cfg.AccessKeySecret))
	mac.Write([]byte(policyB64))
	sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))

	return &UploadPolicy{
		Host:          fmt.Sprintf("https://%s.%s", s.cfg.Bucket, s.cfg.Endpoint),
		AccessKeyID:   s.cfg.AccessKeyID,
		Policy:        policyB64,
		Signature:     sig,
		Key:           key,
		ExpiresAt:     exp.Format(time.RFC3339),
		MaxSize:       maxSize,
		SuccessStatus: "200",
	}, nil
}

func (s *AliyunStorage) HeadObject(key string) (bool, int64, error) {
	meta, err := s.bucket.GetObjectDetailedMeta(key)
	if err != nil {
		return false, 0, err
	}
	size := int64(0)
	if v := meta.Get("Content-Length"); v != "" {
		var n int64
		fmt.Sscanf(v, "%d", &n)
		size = n
	}
	return true, size, nil
}

func (s *AliyunStorage) DeleteObject(key string) error {
	return s.bucket.DeleteObject(key)
}

// ProcessAndSaveAs uses OSS image-process with the `sys/saveas` suffix so the
// processed bytes are written directly back into the bucket — no round-trip
// through this server. The process spec must NOT include the leading
// `image/` prefix consumer code might prepend elsewhere; pass it exactly as
// the caller wants it, e.g. `image/rotate,90/crop,x_0,y_0,w_500,h_500`.
func (s *AliyunStorage) ProcessAndSaveAs(srcKey, processSpec, destKey string) (int64, error) {
	if processSpec == "" {
		return 0, fmt.Errorf("empty process spec")
	}
	if _, err := sanitizeKey(srcKey); err != nil {
		return 0, err
	}
	if _, err := sanitizeKey(destKey); err != nil {
		return 0, err
	}
	// `sys/saveas` takes URL-safe base64 (no padding) of the key + bucket.
	encKey := base64.RawURLEncoding.EncodeToString([]byte(destKey))
	encBucket := base64.RawURLEncoding.EncodeToString([]byte(s.cfg.Bucket))
	processor := fmt.Sprintf("%s|sys/saveas,o_%s,b_%s", processSpec, encKey, encBucket)
	if _, err := s.bucket.ProcessObject(srcKey, processor); err != nil {
		return 0, err
	}
	_, size, err := s.HeadObject(destKey)
	if err != nil {
		return 0, err
	}
	return size, nil
}
