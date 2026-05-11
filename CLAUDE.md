# CLAUDE.md

项目级 Claude 指令。仓库根的所有约定优先于全局指令。

---

## 项目概要

私密旅行相册分享：后端 Go + Echo + ent + PostgreSQL，前端 React + Vite + Tailwind v4，单二进制（前端 `//go:embed` 进去）。照片 / 视频走阿里云 OSS 私有 bucket + 短时签名 URL；分享通过密码链接，可追踪、可撤销、可一次性。

## 常用命令

```bash
make dev            # 同时跑前端 vite (5173) 和后端 air (8080)，HMR + Go 热重载
make dev-back       # 只跑后端
make dev-front      # 只跑前端
make build          # 前端 vite build + Go build → ./bin/server （单文件可部署）
make test           # go test ./...
make install-tools  # 装 air

go generate ./internal/ent/...   # 改 schema 后重新生成 ent 代码
docker compose up -d              # 起本地 postgres
```

## 目录与代码约定

- 后端按资源拆 handler 文件：`internal/handler/{auth,trip,asset,share,collection,comment,upload_grant,passkey,settings,public}.go`。新加 handler 优先延续 `Handler` struct + method 形式，依赖通过 `Deps` 注入。
- ent schema 在 `internal/ent/schema/`。任何字段改动后 **必须** 跑 `go generate ./internal/ent/...`，生成的代码也提交（无独立迁移工具，靠 `Schema.Create`）。
- 前端 alias 是 `@/* → web/src/*`。API 客户端集中在 `web/src/lib/api.ts`，所有 fetch 走 `apiFetch`。组件优先小而单一，复杂状态留在 page 层。
- Tailwind v4：用类组合，不写 css 文件；`web/src/lib/cn.ts` 是 `cn(...)` 工具。
- 错误返回统一用 `echo.NewHTTPError`，前端按 `ApiError` 处理。

## 数据库

PostgreSQL，连接通过 `DATABASE_URL`。本地 `docker compose up -d` 起一个 17-alpine 实例。schema 演进靠 ent `Schema.Create`（启动自动跑），无独立 migration 工具。

测试用内存 SQLite（`?_fk=1`），见 `internal/handler/integration_test.go`。

## 鉴权 / Token

三套 JWT，**同一个 secret，靠 Subject 区分**：

| Subject | 谁颁发 / 用 | 中间件 |
|---|---|---|
| `user` | 账号登录或 passkey 登录 | `auth.RequireUser` / `RequireRole` |
| `share` | 访客通过分享密码换得，存 `tm_share` cookie | `auth.RequireShareSession` |
| `upload` | 一次性上传链接 consume 后，存 sessionStorage | `auth.RequireUploadOrUser` |

**`JWT.Parse` 必须校验 subject**（曾因没校验导致 upload token 被误读成 `UserID=0` 的幽灵用户，FK 失败）。

## OSS 抽象

`internal/oss` 有两个实现：
- `AliyunStorage` 走真实 OSS（生产）
- `LocalStorage` 把文件落到 `./data/oss/`，签名 URL 指向 `/api/_mock/oss/*`（开发 / 测试）

handler 一律依赖 `oss.Storage` interface。新增 OSS 能力时：先在 interface 加方法，两边实现一遍，再在 handler 用。

签名 URL 走 `cache.SignedURL` LRU + TTL 缓存，key 是 `(asset_id, variant)`；改图片处理参数（admin 设置）会 invalidate 缓存。

## 转码

`internal/transcoder.Transcoder` interface。当前 `FakeTranscoder` 把原 mp4 当 HLS（浏览器能直接 `<video>` 播）。真正接阿里云 IMS 在 `AliyunIMSTranscoder` stub 里——配 `IMS_TEMPLATE_GROUP_ID` 等环境变量后再扩展。

视频是**懒触发**：访客第一次拉 video URL 才会提交转码作业，没人看就不花钱。

## 前端坑

- iOS Safari 输入框 < 16px 会自动放大 → 全局强制 ≥ 16px（`web/src/index.css`）。
- WebAuthn 要 HTTPS（或 localhost）；`PUBLIC_BASE_URL` 决定 RP ID。
- `crypto.randomUUID()` 在非 secure context 不可用 → `web/src/lib/uuid.ts` 有 fallback，所有 UUID 走这个。
- 分享 URL 把密码放 `#hash`：复制时 `${origin}/s/CODE#${encodeURIComponent(password)}`；前端 mount 时取出立刻 `history.replaceState` 清掉地址栏，写 localStorage 持久化。

## 不要做

- **不要**把 `.env` / 真实 AK/AS / `data/` / `tmp/` / `web/node_modules/` 提交进 git（`.gitignore` 已覆盖，加文件前先确认）。
- **不要**在生产代码里 import `database/sql` 之外的 sqlite 包；sqlite3 只在测试用，靠 build tag 自然剔除。
- **不要**用 `git rebase -i` / `git add -i` / `--no-verify` / `git push --force`（要强推用 `--force-with-lease`）。
- 改 ent schema 后**不要**手写迁移，直接重新生成 + `Schema.Create` 自动处理。

## 测试

`go test ./...` 必须通过。关键测试：
- `cache`：SignedURL 命中 / TTL 失效
- `oss`：LocalStorage policy + upload + image 处理
- `handler`：登录矩阵、上传 grant 流程、分享 + 转发 + 级联撤销、视频懒转码、editor 禁登

新增功能尽量在 `integration_test.go` 加端到端测试。

## 部署

镜像：`ghcr.io/noah4222/travel-moments:latest`（由 `.github/workflows/docker.yml` 自动构建，多架构 amd64+arm64）。

完整部署说明见 `README.md`。
