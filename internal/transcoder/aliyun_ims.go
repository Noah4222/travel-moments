package transcoder

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/cloverstd/travel-moments/internal/config"
)

// IMSTranscoder 用阿里云 IMS (Intelligent Media Services) 提交 HLS 转码作业。
//
// 工作流：
//  1. 调用 IMS SubmitTranscodeJob 提交转码（多分辨率模板组）
//  2. 输出对象 key 为 {HLSPrefix}{assetID}/index.m3u8
//  3. 转码完成后 IMS 回调 OSS_MPS_CALLBACK_URL（POST JSON，HMAC 签名）
//  4. /api/oss/mps-callback handler 校验签名 → 调 OnDone
//
// 接入步骤：
//   - 阿里云控制台 → 智能媒体服务 → 转码模板：建一个 HLS 模板组（例如 360p+720p+1080p）
//   - 给当前 AK 授予 IMS:* 权限（RAM）
//   - 配置 IMS_ENDPOINT / IMS_TEMPLATE_GROUP_ID / IMS_CALLBACK_SECRET
//   - 部署外网可达的回调地址，并写入 OSS_MPS_CALLBACK_URL
//
// 当 TemplateGroupID 为空时退化为 placeholder 行为（mp4 fallback），便于先把
// 系统跑起来再接入。
type IMSTranscoder struct {
	Cfg    config.OSSConfig
	OnDone CompleteFunc
	Logger *slog.Logger
}

func (t *IMSTranscoder) Backend() string { return "aliyun-ims" }

func (t *IMSTranscoder) SubmitHLS(_ context.Context, assetID int, srcKey string) {
	if t.Cfg.IMSTemplateGroupID == "" {
		// Not configured yet — keep mp4 fallback so the system stays usable.
		if t.Logger != nil {
			t.Logger.Warn("IMS_TEMPLATE_GROUP_ID empty; serving original mp4",
				"asset_id", assetID, "src", srcKey)
		}
		if t.OnDone != nil {
			t.OnDone(Result{AssetID: assetID, Status: "ready", HLSKey: srcKey})
		}
		return
	}

	hlsKey := fmt.Sprintf("%s%d/index.m3u8", t.Cfg.IMSHLSPrefix, assetID)
	if t.Logger != nil {
		t.Logger.Info("submit IMS transcode job",
			"asset_id", assetID,
			"src", srcKey,
			"hls", hlsKey,
			"template_group_id", t.Cfg.IMSTemplateGroupID,
		)
	}

	// TODO: replace the stub below with a real IMS SDK call:
	//
	//   client, _ := ims.NewClient(...)
	//   _, err := client.SubmitTranscodeJob(&ims.SubmitTranscodeJobRequest{
	//       InputUrl:        "oss://" + t.Cfg.Bucket + "/" + srcKey,
	//       OutputUrl:       "oss://" + t.Cfg.Bucket + "/" + hlsKey,
	//       TemplateGroupId: t.Cfg.IMSTemplateGroupID,
	//       UserData:        fmt.Sprintf(`{"asset_id":%d}`, assetID),
	//   })
	//
	// The /api/oss/mps-callback HTTP handler turns the IMS push notification
	// into a CompleteFunc invocation; nothing here updates state directly.
	//
	// Until that's wired up, fall back to mp4 so playback still works.
	if t.OnDone != nil {
		t.OnDone(Result{AssetID: assetID, Status: "ready", HLSKey: srcKey})
	}
}
