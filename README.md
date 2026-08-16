# MultManga · 漫画聚合工具

本地运行的漫画聚合工具：**添加网站源 → 搜索 → 下载 → 管理书架 → 阅读**。同一局域网内手机与 PC 均可通过浏览器访问。

已实现里程碑 M0–M5（M5 收尾进行中）：项目脚手架、源适配器 SDK 与内置源（MangaDex / Copymanga / 包子漫画 / 武芊漫画）、服务端 API、下载引擎、**完整前端 UI**（书架 / 搜索 / 源管理 / 详情 / 下载 / 设置 / 阅读器，响应式，支持局域网手机访问）。

## 快速上手

要求：Node.js ≥ 24、pnpm ≥ 9（推荐 11）。

```bash
pnpm install     # 安装依赖
pnpm dev         # 同时启动服务端(3088) 与前端开发服务器(5173)
```

打开 http://localhost:3088 （或局域网手机访问 `http://<PC-IP>:3088`，启动横幅会打印可用地址；设置页「关于」中也可查看）。

- 服务端数据目录：`apps/server/data/`（db 与下载的漫画文件，已 gitignore）
- 首次启动会自动种子四个内置源：MangaDex、Copymanga、包子漫画、武芊漫画
- 生产模式：`pnpm build && pnpm start` —— 单进程托管前端构建产物与 API（含 SPA 路由回退）

### 常用命令

| 命令 | 说明 |
|---|---|
| `pnpm dev` | 开发模式（服务端 tsx watch + Vite 热更新） |
| `pnpm test` | 运行全部测试（vitest） |
| `pnpm typecheck` | 全部包类型检查 |
| `pnpm build` | 构建前端产物（`apps/web/dist`） |
| `pnpm start` | 生产模式：单进程服务端（若存在 web dist 则一并托管） |
| `pnpm --filter @multmanga/server start` | 仅启动服务端 |

> 注意：Windows 沙箱/受限环境下，esbuild 类工具需要完整权限运行（见「已知环境问题」）。

## 主要 API（前缀 `/api`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/adapters` | 已注册适配器列表（含配置表单 schema） |
| GET/POST/PATCH/DELETE | `/sources` | 源管理；POST 体 `{adapterId, name?, baseUrl?, config?, enabled?}` |
| POST | `/sources/:id/test` | 测试源连通性 |
| GET/POST | `/search` | 搜索：`GET /search?q=&sourceId=` 或 `POST /search {q, sourceIds[]}`（跨源并行） |
| GET | `/manga/:sourceId/:mangaId` | 漫画详情+章节（在线拉取） |
| GET/POST | `/library` | 书架列表（含 unreadCount 未读数）/ 加入书架 `{sourceId, mangaId}` |
| GET/POST/DELETE | `/library/:id` `/library/:id/refresh` | 详情（含章节+下载状态+阅读进度）/ 刷新章节 / 删除 |
| POST | `/library/:id/chapters/:chapterId/download` | 入队下载 |
| GET | `/downloads` | 下载任务列表（含进度/错误） |
| POST | `/downloads/:jobId/:action` | `pause` / `resume` / `cancel` / `retry` |
| DELETE | `/chapters/:chapterId` | 删除章节本地文件并复位状态 |
| GET | `/chapters/:chapterId/pages` | 章节阅读页列表（已下载→本地文件；未下载→在线代理地址） |
| PUT | `/reading-progress/:chapterId` | 保存阅读进度 `{pageIndex}` |
| GET | `/library/:id/continue` | 最近阅读位置 |
| GET | `/events` | SSE：下载进度与任务状态实时推送 |
| GET | `/files/*` | 已下载章节的本地图片（`/files/<libraryId>/<chapterId>/001.jpg`） |
| GET | `/proxy?url=&sourceId=&referer=` | 在线图片代理（解决跨域/防盗链） |
| GET/PATCH | `/settings` | 设置：存储目录、并发数、UA、CBZ、可选访问令牌 |
| GET | `/info` | 服务信息（版本、局域网地址、设置摘要） |

## 如何新增一个网站源

每个网站源 = 一个实现 `MangaSourceAdapter` 契约的模块（放在 `packages/sources/src/<name>/` 并注册）。

### 1. 实现契约（`packages/core/src/source-adapter.ts`）

```ts
export interface MangaSourceAdapter {
  id: string;                    // 唯一标识，如 'my-site'
  name: string;                  // 显示名
  version: string;               // 适配器版本（源接口变动时递增）
  description?: string;
  defaultBaseUrl?: string;       // 默认 API 地址
  configSchema?: ConfigField[];  // 前端据此动态渲染配置表单（语言、headers 等）
  test?(ctx): Promise<TestResult>;            // 连接自检（可选）
  search(query, ctx): Promise<MangaSearchResult[]>;
  getMangaDetail(mangaId, ctx): Promise<MangaDetail>;   // 含 chapters
  getPages(chapterId, ctx): Promise<Page[]>;            // {url, headers?}
  getImageHeaders?(url, ctx): Record<string, string>;   // 图片防盗链头（可选）
}
```

`ctx` 提供 `baseUrl`（用户配置）、`config`（用户配置项）、`http`（封装好 UA/超时/重试的 HTTP 客户端：`getJson/getText/getBuffer`）、`log`。

### 2. 注册

```ts
// packages/sources/src/my-site/index.ts 导出适配器后：
import { registerAdapter } from '../registry.js';
registerAdapter(mySiteAdapter);
```

在 `packages/sources/src/index.ts` 的 `registerBuiltinAdapters()` 中调用，即可在 UI「添加源」中选到。

### 3. 模板与约定

- **mangaId / chapterId 由适配器自定义**，可为复合 ID（如 Copymanga 用 `path_word/uuid`，因为取页需要两者）。
- **页列表 `Page[]`**：每项 `{url, headers?}`；图片可能需要 Referer 时放在 `headers` 或实现 `getImageHeaders`。
- **不要直接 `fetch`**：一律用 `ctx.http`（自动带 UA、超时、重试退避）。
- 参考实现：`packages/sources/src/mangadex/index.ts`（官方 API）、`packages/sources/src/copymanga/index.ts`（复合章节 ID + 图片 Referer 示例）、`packages/sources/src/baozimh/index.ts`（HTML 解析 + cheerio 示例）、`packages/sources/src/wuqian/index.ts`（纯 API 示例）。

### 移植自 wuji-tauri 的源

`baozimh`（包子漫画）与 `wuqian`（武芊漫画）移植自 [moshstudio/wuji-tauri](https://github.com/moshstudio/wuji-tauri) 源市场中**免登录**的漫画扩展：

- wuji 的源是运行时动态加载的 JS 扩展类（`ComicExtension`），来自其市场服务器 `wuji-server.moshangwangluo.com`；其中「默认源」包（noLogin）的漫画扩展可直接获取，其余 VIP/Pro 源需登录。
- 移植方式：将扩展逻辑改写为 MultManga 的 `MangaSourceAdapter` 静态适配器（API 源直写 JSON；HTML 源用 cheerio 解析），并注册到 `registerBuiltinAdapters()`。
- 注意站点结构可能变动：如包子漫画的图片容器已从 `<img>` 变为 `<amp-img>`，适配器同时兼容两者。

### 4. 测试

每个适配器写 mock HTTP 单测（见 `packages/sources/test/mangadex.test.ts`），用 `vi.stubGlobal('fetch', ...)` 或 mock `ctx.http`。

## 已知环境问题

- **Windows schannel 证书问题**：`curl.exe` / `Invoke-WebRequest` 可能报 `SEC_E_NO_CREDENTIALS`，这是系统级 TLS 问题；Node 内置 fetch 不受影响，全部网络请求走 Node。
- **沙箱限制 spawn**：受限环境下 esbuild 等需 spawn 子进程的工具（vitest/vite/tsx）可能报 `spawn EPERM`，需要提升为完整访问权限运行。
- **Copymanga 域名不稳定**：`api.copymanga.tv` 曾多次更换；连接失败时在「源管理」中把 baseUrl 改为当前可用镜像域名即可（适配器代码本身不依赖具体域名）。

## 数据与备份

- 数据库：`apps/server/data/multmanga.db`（SQLite WAL 模式）。备份 = 复制该文件（连同 `-wal`/`-shm` 一起，或先停服）。
- 漫画文件：`apps/server/data/library/<libraryId>/<chapterId>/`。
- 修改存储目录：`PATCH /api/settings {"storageDir": "D:\\manga"}` 或 UI 设置页（M4）。

## 安全说明

默认无认证，仅建议在可信家庭局域网使用。若需暴露到不可信网络，请在设置页（或 `PATCH /api/settings {"accessToken":"..."}`）开启访问令牌：所有 `/api` 请求需携带 `Authorization: Bearer <token>`（图片 `/api/files`、`/api/proxy` 与 SSE `/api/events` 因无法携带 Header 而豁免）。用户应自行确保对源站内容的合理使用并遵守其条款。
