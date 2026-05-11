package oss

import (
	"errors"

	alioss "github.com/aliyun/aliyun-oss-go-sdk/oss"

	"github.com/cloverstd/travel-moments/internal/config"
)

// AliyunStorage is the production Storage backed by 阿里云 OSS.
type AliyunStorage struct {
	cfg    config.OSSConfig
	client *alioss.Client
	bucket *alioss.Bucket
}

// NewAliyunStorage creates the aliyun-backed Storage.
func NewAliyunStorage(cfg config.OSSConfig) (*AliyunStorage, error) {
	if cfg.Endpoint == "" || cfg.Bucket == "" {
		return nil, errors.New("OSS endpoint and bucket required")
	}
	if cfg.AccessKeyID == "" || cfg.AccessKeySecret == "" {
		return nil, errors.New("OSS credentials missing")
	}
	c, err := alioss.New(cfg.Endpoint, cfg.AccessKeyID, cfg.AccessKeySecret)
	if err != nil {
		return nil, err
	}
	b, err := c.Bucket(cfg.Bucket)
	if err != nil {
		return nil, err
	}
	return &AliyunStorage{cfg: cfg, client: c, bucket: b}, nil
}

func (s *AliyunStorage) Backend() string { return "aliyun" }
