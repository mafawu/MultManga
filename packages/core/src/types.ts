/** 搜索结果条目（源适配器返回） */
export interface MangaSearchResult {
  /** 源内的漫画 ID（适配器自行定义格式） */
  mangaId: string;
  title: string;
  author?: string;
  description?: string;
  coverUrl?: string;
  status?: string;
  url?: string;
}

/** 章节元信息 */
export interface ChapterMeta {
  /** 源内的章节 ID（适配器自行定义格式，可为复合 ID） */
  chapterId: string;
  title: string;
  chapterNumber?: number;
  volume?: string;
  publishedAt?: string;
}

/** 漫画详情（含章节列表） */
export interface MangaDetail extends MangaSearchResult {
  chapters: ChapterMeta[];
}

/** 章节内的一页图片 */
export interface Page {
  url: string;
  /** 该页需要的额外请求头（如防盗链 Referer） */
  headers?: Record<string, string>;
}

/** 聚合搜索命中项（跨源搜索结果携带源信息） */
export interface SearchHit extends MangaSearchResult {
  sourceId: string;
  sourceName: string;
}

export type ConfigFieldType = 'string' | 'number' | 'boolean' | 'select';

/** 适配器配置表单字段描述（前端据此动态渲染） */
export interface ConfigField {
  key: string;
  label: string;
  type: ConfigFieldType;
  default?: string | number | boolean;
  options?: { label: string; value: string }[];
  help?: string;
}

/** 适配器元信息 */
export interface SourceAdapterDescriptor {
  id: string;
  name: string;
  version: string;
  description?: string;
  defaultBaseUrl?: string;
  configSchema?: ConfigField[];
}

/** 源连接测试结果 */
export interface TestResult {
  ok: boolean;
  message: string;
}

export type ChapterDownloadState = 'none' | 'queued' | 'downloading' | 'done' | 'failed';
export type DownloadJobState = 'queued' | 'running' | 'paused' | 'canceled' | 'failed' | 'done';

export interface LibraryItem {
  id: string;
  sourceId: string;
  sourceName: string;
  adapterId: string;
  mangaId: string;
  title: string;
  author?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  status?: string | null;
  updatedAt: string;
  addedAt: string;
  downloadedCount: number;
  chapterCount: number;
  /** 未读完的章节数（无进度或未读完最后一页） */
  unreadCount: number;
  /** 最近阅读时间（无阅读记录为 null） */
  lastReadAt?: string | null;
}

export interface LibraryChapter {
  id: string;
  libraryId: string;
  chapterId: string;
  title: string;
  chapterNumber?: number | null;
  /** 源返回章节列表时的原始顺序（无章节号时用于排序） */
  chapterOrder?: number | null;
  downloadState: ChapterDownloadState;
  localDir?: string | null;
  pageCount?: number | null;
  createdAt: string;
  pageIndex?: number | null;
  jobState?: DownloadJobState | null;
}

export interface LibraryDetail extends LibraryItem {
  chapters: LibraryChapter[];
}

export interface DownloadJobView {
  id: string;
  chapterId: string;
  state: DownloadJobState;
  progress: number;
  error?: string | null;
  /** JSON 数组：[{ index, url, error }] —— 单页下载失败但任务继续时的失败页清单 */
  failedPages?: string | null;
  /** 已成功下载页数（进度明细） */
  pagesDone?: number | null;
  /** 总页数（进度明细） */
  pagesTotal?: number | null;
  createdAt: string;
  updatedAt: string;
  chapterTitle: string;
  chapterNumber?: number | null;
  libraryId: string;
  mangaTitle: string;
  sourceName: string;
}

/** 单页下载失败记录（持久化于 download_jobs.failed_pages） */
export interface FailedPageRecord {
  /** 1 起始页码 */
  index: number;
  url: string;
  error: string;
}

/** 下载进度事件阶段 */
export type DownloadPhase = 'fetching_pages' | 'downloading' | 'packing';

/** download.progress 事件载荷 */
export interface DownloadProgressEvent {
  jobId: string;
  chapterId: string;
  libraryId?: string;
  page?: number;
  total?: number;
  progress: number;
  phase?: DownloadPhase;
}
