package transcoder

import (
	"context"
	"log/slog"
	"time"
)

// Result is the outcome of an HLS job.
type Result struct {
	AssetID int
	Status  string // "ready" | "failed"
	HLSKey  string
	Error   string
}

// Transcoder submits asynchronous HLS transcoding jobs.
type Transcoder interface {
	Backend() string
	SubmitHLS(ctx context.Context, assetID int, srcKey string)
}

// CompleteFunc is invoked when a job finishes (called from any goroutine).
type CompleteFunc func(Result)

// FakeTranscoder pretends to do MPS work. After a short delay it marks the
// asset ready, reusing the original key as the "HLS" key — browsers play the
// raw mp4 via <video> just fine, so on-demand UX is preserved without any
// actual encoding cost. Used in dev / tests / when no real backend exists yet.
type FakeTranscoder struct {
	Delay   time.Duration
	OnDone  CompleteFunc
	Logger  *slog.Logger
}

func (t *FakeTranscoder) Backend() string { return "fake" }

func (t *FakeTranscoder) SubmitHLS(_ context.Context, assetID int, srcKey string) {
	if t.Logger != nil {
		t.Logger.Info("transcode submit (fake)", "asset_id", assetID, "src", srcKey)
	}
	go func() {
		if t.Delay > 0 {
			time.Sleep(t.Delay)
		}
		if t.OnDone != nil {
			t.OnDone(Result{
				AssetID: assetID,
				Status:  "ready",
				HLSKey:  srcKey, // playback fallback to original
			})
		}
	}()
}

// AliyunMPSTranscoder is a placeholder for the real 阿里云 MPS integration.
// SubmitHLS submits the asset for HLS conversion via MPS API; completion
// arrives later via the /api/oss/mps-callback HTTP endpoint, which calls
// OnDone.
//
// TODO: wire up github.com/alibabacloud-go/mts-20140618.
type AliyunMPSTranscoder struct {
	OnDone CompleteFunc
	Logger *slog.Logger
}

func (t *AliyunMPSTranscoder) Backend() string { return "aliyun-mps" }

func (t *AliyunMPSTranscoder) SubmitHLS(_ context.Context, assetID int, srcKey string) {
	if t.Logger != nil {
		t.Logger.Warn("aliyun MPS not implemented; falling back to original mp4",
			"asset_id", assetID, "src", srcKey)
	}
	// For now, immediately mark ready with original key so playback works.
	// Replace with real MPS submission when ready to integrate.
	if t.OnDone != nil {
		t.OnDone(Result{AssetID: assetID, Status: "ready", HLSKey: srcKey})
	}
}
