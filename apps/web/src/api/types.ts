export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  default?: string | number | boolean;
  options?: { label: string; value: string }[];
  help?: string;
}

export interface AdapterInfo {
  id: string;
  name: string;
  version: string;
  description?: string;
  defaultBaseUrl?: string;
  configSchema?: ConfigField[];
}

export interface SourceItem {
  id: string;
  adapterId: string;
  name: string;
  baseUrl: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

export interface SearchHit {
  mangaId: string;
  title: string;
  author?: string;
  description?: string;
  coverUrl?: string;
  status?: string;
  url?: string;
  sourceId: string;
  sourceName: string;
}

export interface SearchResult {
  results: SearchHit[];
  errors: { sourceId: string; sourceName: string; error: string }[];
  count: number;
}

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
  unreadCount: number;
  lastReadAt?: string | null;
}

export type ChapterDownloadState = 'none' | 'queued' | 'downloading' | 'done' | 'failed';
export type DownloadJobState = 'queued' | 'running' | 'paused' | 'canceled' | 'failed' | 'done';

export interface LibraryChapter {
  id: string;
  libraryId: string;
  chapterId: string;
  title: string;
  chapterNumber?: number | null;
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

export interface DownloadJob {
  id: string;
  chapterId: string;
  state: DownloadJobState;
  progress: number;
  error?: string | null;
  /** JSON 数组：[{ index, url, error }] —— 单页失败但任务继续时的失败页清单 */
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

export interface AppSettings {
  storageDir: string;
  concurrency: number;
  /** 单个章节内图片下载并发数 */
  pageConcurrency: number;
  userAgent: string;
  cbz: boolean;
  accessToken: string;
}

export interface Info {
  name: string;
  version: string;
  port: number;
  lanAddresses: string[];
  settings: {
    storageDir: string;
    concurrency: number;
    pageConcurrency: number;
    userAgent: string;
    cbz: boolean;
    accessTokenEnabled: boolean;
  };
}

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface ChapterPages {
  mode: 'local' | 'online';
  pages: string[];
}

export interface ContinueInfo {
  chapterId: string;
  title: string;
  pageIndex: number;
  pageCount: number | null;
}
