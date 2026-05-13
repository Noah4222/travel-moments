# 分享访问追溯（Admin Audit）— 设计稿

日期：2026-05-13
状态：approved，待写实现计划

## 背景

后端早已记录全套 visit / asset_view / share_link tree 数据，每个 share 也有 `/shares/:id/stats` 和 `/shares/:id/tree` API（admin only）。但**入口只在 trip 详情的 SharesPanel 里**，必须先进某个 trip 再点某个 share 才能看，跨 trip / 跨 share 的"谁来过、看了什么、转给谁"无处汇总。本设计补一个 admin 一级页面解决此问题。

## 目标 / 非目标

**目标**

- Admin 在一个入口看到全站访问情况：事件流、分享总览、相册维度。
- 单个 trip 有详细趋势页（90 天）。
- 仅 admin 可见；editor 不感知。
- 不引入新表，全部基于现有 `visit / asset_view / share_link / share_trip / trip / collection` 现算。

**非目标**

- 不做实时推送（SSE / 轮询）。
- 不做导出（CSV / 异步任务）；以后可加 `?format=csv`。
- 不做 editor 视角的访客视图（保留现有 admin only 策略）。
- 不引入预聚合表 / 缓存表；当前数据规模（1 万 visits 以下）现算足够。
- 不动现有 TripDetail 里的 SharesPanel 入口。

## 架构

新增 admin 一级页面 `Audit`：

```
/admin/audit?tab=events   事件流（默认）
/admin/audit?tab=shares   分享总览
/admin/audit?tab=trips    相册维度
/admin/audit/trip/:id     单个 trip 详细趋势页
```

后端在 `internal/handler/audit.go`，路由组 `/api/admin/audit/*`，组级中间件 `auth.RequireRole(auth.RoleAdmin)`。复用：
- `auth.RequireRole` / `auth.MustClaims`
- `truncString`、`topN`（`share_stats.go`）
- 前端 `SharesPanel` 内的 `StatsModal`（抽出复用）；`ShareTreePanel`（从 `SharesPanel` 抽出供复用）

## 后端 API

所有接口 `GET`，路径前缀 `/api/admin/audit`，admin only。

### `GET /events`

**Query**：`before` (RFC3339)、`limit` (默认 50，最大 200)、`trip_id`、`share_id`、`ip`

**返回**：

```json
{
  "events": [
    {
      "visit_id": 123,
      "share_id": 45,
      "share_code": "abc",
      "trip_id": 7,
      "trip_title": "云南",
      "ip": "1.2.3.4",
      "ua": "...",
      "country": "CN",
      "referer": "...",
      "visited_at": "...",
      "asset_view_count": 12,
      "is_share_creator": true
    }
  ],
  "next_before": "2026-05-12T..."
}
```

**实现要点**：
- `Visit.Query().Order(desc visited_at, desc id).Where(visited_at < before).Limit(limit+1)`，多取 1 判断 `next_before`。
- 批量 `ShareLink.Query().Where(IDIn(...))` + `Trip.Query()` 内存 join 拿 `share_code / trip_title`。
- `AssetView.Query().Where(VisitIDIn(...)).GroupBy(visit_id).Aggregate(count)` 一次拿 `asset_view_count`。
- `ShareLink.Query().Where(CreatorVisitIDIn(...))` 拿 `is_share_creator` 的 visit id set。
- trip 已删：`trip_title` = `"(已删除)"`。

### `GET /shares`

**Query**：`q`（模糊匹配 note / code）、`status`（`active`/`expired`/`revoked`/`all`，默认 `active`）、`order`（`recent_visit`/`visits`/`created`，默认 `recent_visit`）、`limit`、`before`

**返回**（每行）：
- ShareLink 基础字段 + `trip_title`
- `visits`、`unique_ips`、`child_count`、`last_visit_at`

**实现要点**：
- 一次 `ShareLink.Query().All()` 取全量（小数据量 OK），按 status 过滤。
- 一次 `Visit.Query().GroupBy(share_id).Aggregate(count, count_distinct(ip), max(visited_at))` 拿聚合，内存 join。
- 一次 `ShareLink.Query().GroupBy(parent_share_id).Aggregate(count)` 拿 `child_count`。

### `GET /trips`

**返回**（每行）：`trip_id / title / share_count / total_visits / unique_visitors / last_visit_at`

**实现要点**：
- 注意 `share_trips` 多 trip 关联表：某 share 可挂多个 trip，聚合时要 union。
- `unique_visitors` = `count_distinct(visit.ip)` 限定该 trip 关联的所有 share。

### `GET /trips/:id`

**返回**：

```json
{
  "trip": {...},
  "shares": [...],
  "daily": [{"date": "2026-05-01", "visits": 3, "unique_ips": 2}, ...],
  "top_assets": [{"asset_id": 1, "views": 12, "thumb_url": "..."}, ...],
  "referers": [{"host": "t.me", "count": 5}, ...],
  "countries": [{"code": "CN", "count": 12}, ...]
}
```

**实现要点**：
- `daily` 返回连续 90 天（含 0 值）；按 `visited_at.Format("2006-01-02")` 按**服务器本地时区**分桶。
- `top_assets` 取 20，`thumb_url` 走 `cache.SignedURL`。
- `referers` 用 `net/url.Parse` 取 host；空 / 解析失败归入 `(直接访问)`；top 10。
- `countries` top 10。
- HTTP header `Cache-Control: private, max-age=30`。

## 关键策略

- **去重统一按 IP**，与现有 `share_stats.UniqueIPs` 保持一致。
- **时区**：daily 用服务器本地时区，spec 中注明，多时区以后再加 `?tz=`。
- **审计自身不写 audit_log**（避免噪音）；以后加导出 CSV 那次操作要写。
- **被删 trip**：visit 历史保留，行显示 `(已删除)`，仍可点进详细页（多数字段为空）。
- **空 IP**：列表展示 `—`，`unique_ips` 计数时跳过。
- **UA 截断**：复用 `truncString(ua, 200)`。

## 前端

新增：

```
web/src/pages/admin/
├─ Audit.tsx
├─ audit/
│  ├─ EventsTab.tsx
│  ├─ SharesTab.tsx
│  ├─ TripsTab.tsx
│  ├─ TripAuditDetail.tsx
│  └─ Sparkline.tsx
```

`web/src/lib/api.ts` 加四个方法 + TS 类型：`AuditEvent` / `AuditShareRow` / `AuditTripRow` / `AuditTripDetail`。

路由：

```tsx
<Route path="/admin/audit" element={<Audit />} />
<Route path="/admin/audit/trip/:id" element={<TripAuditDetail />} />
```

Layout 顶部导航加「访问追溯」（紧跟 Trips 后），仅对 admin 显示。

**交互**：
- **EventsTab**：表格行点击展开抽屉，显示完整 UA / referer + 该 visit 浏览过的资源缩略图；底部 "加载更多" 按钮（游标分页）；顶部过滤条 `trip / share / ip`。
- **SharesTab**：过滤栏 + 表格；行右侧按钮 `查看统计`（StatsModal）/ `查看转发树`（ShareTreePanel）/ `跳到 Trip`。
- **TripsTab**：纯数字列表，无 sparkline；行点击 → `/admin/audit/trip/:id`。
- **TripAuditDetail**：4 个统计卡 + 90 天大 sparkline（SVG，带 tooltip）+ top assets 缩略图网格 + referer / country 水平条形图（纯 div + width %）。

**StatsModal / ShareTreePanel 复用**：从 `SharesPanel.tsx` 抽到独立文件，原 SharesPanel 改为 import。

## 测试

后端：`internal/handler/audit_test.go`，内存 SQLite + httptest（沿用 `integration_test.go` 模式）。

| # | 用例 |
|---|---|
| 1 | 权限：editor / 未登录访问 `/api/admin/audit/*` → 401/403 |
| 2 | events 分页：60 条 visit，默认拿 50 + `next_before` 非空，带 `before` 拿剩 10 + null |
| 3 | events 过滤：`trip_id` / `share_id` / `ip` 各跑一次 |
| 4 | events 字段：含一条创建子分享的 visit → `is_share_creator=true`；含 trip 已删的 visit → `trip_title="(已删除)"` 不报错 |
| 5 | shares 聚合：`visits / unique_ips / last_visit_at / child_count`；三种 order 各跑 |
| 6 | shares 状态过滤：active / expired / revoked，`status=active` 只返 1 条 |
| 7 | trips 聚合：含挂在 `share_trips` 多 trip 关联表的额外 trip 被计入 |
| 8 | trip 详情 daily 补零：D-30 和 D-1 有访问，返回 90 行，对应日期非零 |
| 9 | trip 详情 referer：空 / `https://t.me/foo` / `https://t.me/bar` → `(直接访问)` 1，`t.me` 2 |
| 10 | 审计自身不写 log：访问 audit endpoint 后 `audit_log` 行数不变 |

前端无测试基础设施，**不引入**。手测 checklist：

- 三个 tab 切换 URL 同步
- 事件流加载更多到底
- 删除一个 trip 后 audit 行显示 `(已删除)` 且不崩溃
- 详细趋势页 sparkline tooltip 显示日期 + 访问数
- editor 账号登录后 Layout 顶部看不到「访问追溯」入口

非功能：1 万 visits 数据下，三个列表 API 单次响应 < 200ms（`time curl` 手测）。

## 范围之外（明确不做）

- 实时推送、CSV 导出、editor 视角访客视图
- 预聚合表 / 缓存表
- IP 地理库（沿用现有 `country` 字段；目前怎么写的就怎么展示）
- 多时区支持
