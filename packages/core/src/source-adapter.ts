import type {
  MangaDetail,
  MangaSearchResult,
  Page,
  SourceAdapterDescriptor,
  TestResult,
} from './types.js';

/** HTTP 客户端（由 sources 包实现，适配器通过 SourceContext 使用） */
export interface HttpClient {
  /** GET 并解析 JSON；非 2xx 抛 HttpError */
  getJson<T = unknown>(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<T>;
  /** GET 并返回文本 */
  getText(url: string, headers?: Record<string, string>, timeoutMs?: number): Promise<string>;
  /** GET 并返回原始字节（下载图片用）；signal 用于任务取消时中断在途请求 */
  getBuffer(
    url: string,
    headers?: Record<string, string>,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array>;
}

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/** 适配器运行时上下文：baseUrl 与 config 来自用户配置的源实例 */
export interface SourceContext {
  baseUrl: string;
  config: Record<string, unknown>;
  http: HttpClient;
  log: Logger;
}

/**
 * 网站源适配器契约。
 * 新增一个网站源 = 实现本接口并在 packages/sources 注册（见 README「如何新增网站源」）。
 */
export interface MangaSourceAdapter extends SourceAdapterDescriptor {
  /** 连接自检（可选；缺省时服务端退化为检查 baseUrl 可达性） */
  test?(ctx: SourceContext): Promise<TestResult>;
  /** 搜索 */
  search(query: string, ctx: SourceContext): Promise<MangaSearchResult[]>;
  /** 详情（含章节列表） */
  getMangaDetail(mangaId: string, ctx: SourceContext): Promise<MangaDetail>;
  /** 章节图片页列表 */
  getPages(chapterId: string, ctx: SourceContext): Promise<Page[]>;
  /** 服务端图片代理拉取在线图片时附加的请求头（可选，防盗链用） */
  getImageHeaders?(url: string, ctx: SourceContext): Record<string, string> | undefined;
}
