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
