# Travel Moments

私密旅行相册分享。照片/视频存阿里云 OSS 私有 bucket，分享通过带密码的链接出去，每次访问都签短时 URL，可追踪、可撤销、可一次性。后端 Go + ent + PostgreSQL，前端 React + Vite + Tailwind，单二进制内嵌前端。

> **AVIF/WebP**, **实况图片**, **Passkey 登录**, **一次性上传链接**（让朋友传图不用账号）, **多相册分享**, **弹幕**, **EXIF**, **HLS 视频懒转码** 等等都在。

---

## 功能一览

| 模块 | 能力 |
|---|---|
| 浏览 | trip / collection（圈选子集）/ 单图 / 多相册 四种分享 scope；上下张、轮播、键盘、移动端滑动、EXIF 面板 |
| 安全 | 分享密码（bcrypt）+ Cookie 会话；密码写在 `#hash` 避免 IM 爬虫；URL 自动登 + localStorage 记忆；级联撤销 |
| 追踪 | Visit / AssetView 计数；admin 看 IP/UA/树；访问次数对访客的可见性可按相册开关 |
| 转发 | 访客转发生成子分享，传播树可视化；admin 可禁止再转发 |
| 上传 | OSS 浏览器直传，PostObject policy；HEIC/JPG + MOV 自动识别为实况图片；EXIF 异步抓 |
| 一次性上传链接 | admin 给非账号朋友生成 `/upload/<code>#<token>` 链接：第一次打开消耗密钥，页面停留期可继续上传；可配过期时间和撤销 |
| 评论 / 弹幕 | trip / asset 级评论；视频带时间戳弹幕；admin 可隐藏 / 编辑 |
| Passkey | 注册多个 Passkey；usernameless 登录；签名计数 / 备份状态都跟踪 |
| 转码 | mp4 上传即可播；按需触发 HLS 转码并切到自适应码率，没人看不花钱 |
| 图片优化 | AVIF 优先 + WebP 兜底 + 原图下载；缩略图/预览图/封面尺寸 admin 可视化调 |
| 后台 | 相册集 / 用户 / 设置 三个 admin 模块；mobile-first 响应式 |

---

## 快速开始（本地开发）

```bash
# 0. 一次性
make install-tools             # 装 air（Go 热重载）
docker compose up -d           # 起 postgres

# 1. 配置 .env（从模板拷一份）
cp .env.example .env
# 至少填 JWT_SECRET；OSS 留空会走 LocalStorage mock，文件落 ./data/oss/

# 2. 同时跑前后端，HMR + 自动重启
make dev
# → 前端 http://127.0.0.1:5173  （vite，HMR）
# → 后端 http://127.0.0.1:8080  （air 监听 .go 文件）
# 前端把 /api/* 代理到后端
```

首次启动会按 `.env` 里的 `SEED_ADMIN_USERNAME / PASSWORD` 自动建一个 admin。

---

## 部署（生产）

### 方式 A：拉 GHCR 镜像 + docker compose（推荐）

`ghcr.io/noah4222/travel-moments` 由 GitHub Action 自动构建多架构镜像（amd64 + arm64），推到 GitHub Container Registry。

```yaml
# docker-compose.prod.yml
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: travel
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: travel_moments
    volumes:
      - pg-data:/var/lib/postgresql/data

  app:
    image: ghcr.io/noah4222/travel-moments:latest
    restart: unless-stopped
    depends_on: [postgres]
    ports: ["8080:8080"]
    environment:
      HTTP_ADDR: ":8080"
      DATABASE_URL: "postgres://travel:change-me@postgres:5432/travel_moments?sslmode=disable"
      JWT_SECRET: "${JWT_SECRET}"                # 用 openssl rand -hex 32 生成
      SEED_ADMIN_USERNAME: admin
      SEED_ADMIN_PASSWORD: "${SEED_ADMIN_PASSWORD}"
      PUBLIC_BASE_URL: "https://moments.example.com"    # WebAuthn RP
      OSS_BACKEND: aliyun
      OSS_ENDPOINT: oss-cn-shanghai.aliyuncs.com
      OSS_REGION: cn-shanghai
      OSS_BUCKET: "${OSS_BUCKET}"
      OSS_ACCESS_KEY_ID: "${OSS_ACCESS_KEY_ID}"
      OSS_ACCESS_KEY_SECRET: "${OSS_ACCESS_KEY_SECRET}"

volumes:
  pg-data: {}
```

启动：
```bash
JWT_SECRET=$(openssl rand -hex 32) \
SEED_ADMIN_PASSWORD=$(openssl rand -base64 24) \
OSS_BUCKET=tm-test2 \
OSS_ACCESS_KEY_ID=LTAI... \
OSS_ACCESS_KEY_SECRET=... \
docker compose -f docker-compose.prod.yml up -d
```

升级：`docker compose pull && docker compose up -d`。

### 方式 B：自己 build

```bash
docker build -t travel-moments .
docker run --rm -p 8080:8080 --env-file .env travel-moments
```

### 方式 C：裸二进制（无 Docker）

```bash
make build      # 前端 vite build + Go build → ./bin/server
./bin/server
```

二进制是单文件，前端被 `//go:embed` 进去，部署只要这一个文件 + Postgres。

---

## 必要的外部配置

### 1. PostgreSQL

任何 13+ 都行。第一次启动会自动跑 ent 的 `Schema.Create` 迁移。

### 2. 阿里云 OSS

**bucket 必须是私有读写**。CORS 配（控制台 → bucket → 权限管理 → 跨域设置）：

| 字段 | 值 |
|---|---|
| 来源 | `*`（开发期）或 `https://你的域名` |
| 方法 | `POST, GET, HEAD` |
| 允许 Headers | `*` |
| 暴露 Headers | `ETag, x-oss-request-id` |

如果想用 AVIF，去 OSS 控制台开通**图片处理高级套餐**；否则默认参数会从 `image_process_*_avif` 设置回退到 WebP（前端自动用 `<picture>` 降级）。

### 3. WebAuthn / Passkey

只要 `.env` 设了 `PUBLIC_BASE_URL`（HTTPS 域名，或本地 `http://localhost:port`），Passkey 就会生效。RP ID 自动从 URL 推。

注意：localhost 之外 **必须 HTTPS**，否则浏览器拒绝 WebAuthn API。

### 4. 反向代理（可选）

后端是普通 HTTP，建议 nginx / caddy 在前面终止 TLS。Caddy 一行就行：

```
moments.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

---

## 环境变量

完整列表见 [`.env.example`](./.env.example)。核心：

| 变量 | 默认 | 必填 |
|---|---|---|
| `HTTP_ADDR` | `:8080` | |
| `DATABASE_URL` | — | ✅ |
| `JWT_SECRET` | — | ✅（生产请改！）|
| `SEED_ADMIN_USERNAME` / `_PASSWORD` | `admin` / `admin123` | 强烈建议改 |
| `PUBLIC_BASE_URL` | — | Passkey + 单图分享链接外网形态需要 |
| `OSS_BACKEND` | `auto` | 空 = 有凭证就走 aliyun，否则本地 mock |
| `OSS_ENDPOINT / BUCKET / ACCESS_KEY_ID / SECRET` | — | OSS 必填 |

更细的运行时设置（图片处理参数 / 上传 Cache-Control / 签名 URL TTL / 单图分享有效期 / upload-grant 会话时长）都能在 admin 后台 **设置** 页改，写到 `app_settings` 表覆盖 `.env`。

---

## 项目结构

```
.
├── cmd/server/         # main.go
├── internal/
│   ├── auth/           # JWT (user/share/upload) + bcrypt
│   ├── cache/          # signed URL LRU+TTL 缓存
│   ├── config/         # env 加载
│   ├── ent/            # ent ORM 生成 (schema 在 ./schema)
│   ├── handler/        # echo handler（按资源拆文件）
│   ├── oss/            # aliyun + local mock backend
│   ├── transcoder/     # HLS 转码接口 (fake + aliyun ims)
│   ├── settings/       # AppSetting 运行时配置
│   ├── server/         # 路由组装
│   ├── seed/           # 首次启动建 admin
│   └── frontend/       # //go:embed all:dist
└── web/                # React + Vite (输出到 internal/frontend/dist)
    └── src/
        ├── components/
        ├── pages/
        └── lib/
```

---

## 测试

```bash
go test ./...
```

包括：cache TTL、OSS local backend、handler 集成测试（含 share 流程 / 视频懒转码 / upload grant / editor 禁登）。

---

## License

MIT
