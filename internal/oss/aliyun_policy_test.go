package oss

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/cloverstd/travel-moments/internal/config"
)

// Verify that the aliyun policy structure & signature look correct without
// needing the real OSS service.
func TestAliyunSignUploadPolicy(t *testing.T) {
	s, err := NewAliyunStorage(config.OSSConfig{
		Endpoint:        "oss-cn-hangzhou.aliyuncs.com",
		Bucket:          "my-bucket",
		AccessKeyID:     "AK",
		AccessKeySecret: "SK",
	})
	if err != nil {
		t.Fatal(err)
	}
	pol, err := s.SignUploadPolicy("trips/1/raw/x.jpg", 1024, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(pol.Host, "https://my-bucket.oss-cn-hangzhou.aliyuncs.com") {
		t.Fatalf("unexpected host %s", pol.Host)
	}
	if pol.AccessKeyID != "AK" {
		t.Fatalf("access key %s", pol.AccessKeyID)
	}

	// Verify signature: base64(hmac_sha1(SK, policy_b64))
	mac := hmac.New(sha1.New, []byte("SK"))
	mac.Write([]byte(pol.Policy))
	want := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if pol.Signature != want {
		t.Fatalf("sig mismatch")
	}

	// Decode the policy JSON and assert key/maxsize made it in.
	raw, err := base64.StdEncoding.DecodeString(pol.Policy)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Expiration string          `json:"expiration"`
		Conditions [][]interface{} `json:"conditions"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	var hasKey, hasSize bool
	for _, cond := range doc.Conditions {
		if len(cond) >= 3 && cond[0] == "eq" && cond[1] == "$key" && cond[2] == "trips/1/raw/x.jpg" {
			hasKey = true
		}
		if len(cond) >= 3 && cond[0] == "content-length-range" {
			if hi, ok := cond[2].(float64); ok && hi == 1024 {
				hasSize = true
			}
		}
	}
	if !hasKey || !hasSize {
		t.Fatalf("policy missing key/size constraints: %+v", doc.Conditions)
	}
}
