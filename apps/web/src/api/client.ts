import type {
  AdapterInfo,
  AppSettings,
  ChapterPages,
  ContinueInfo,
  DownloadJob,
  Info,
  LibraryDetail,
  LibraryItem,
  SearchResult,
  SourceItem,
  TestResult,
} from './types';

export interface MangaDetailView {
  mangaId: string;
  title: string;
  author?: string;
  description?: string;
  coverUrl?: string;
  status?: string;
  url?: string;
  sourceId: string;
  sourceName: string;
  chapters: { chapterId: string; title: string; chapterNumber?: number }[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const res = await fetch(path, {
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  info: () => request<Info>('/api/info'),
  adapters: () => request<AdapterInfo[]>('/api/adapters'),

  sources: () => request<SourceItem[]>('/api/sources'),
  createSource: (body: { adapterId: string; name?: string; baseUrl?: string; config?: Record<string, unknown>; enabled?: boolean }) =>
    request<SourceItem>('/api/sources', { method: 'POST', body: JSON.stringify(body) }),
  updateSource: (id: string, body: Partial<{ name: string; baseUrl: string; config: Record<string, unknown>; enabled: boolean }>) =>
    request<SourceItem>(`/api/sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteSource: (id: string) => request<{ ok: boolean }>(`/api/sources/${id}`, { method: 'DELETE' }),
  testSource: (id: string) => request<TestResult>(`/api/sources/${id}/test`, { method: 'POST' }),

  search: (q: string, sourceIds?: string[]) =>
    request<SearchResult>('/api/search', { method: 'POST', body: JSON.stringify({ q, sourceIds }) }),

  mangaDetail: (sourceId: string, mangaId: string) =>
    request<MangaDetailView>(`/api/manga/${encodeURIComponent(sourceId)}/${encodeURIComponent(mangaId)}`),

  library: () => request<LibraryItem[]>('/api/library'),
  libraryDetail: (id: string) => request<LibraryDetail>(`/api/library/${id}`),
  addToLibrary: (sourceId: string, mangaId: string) =>
    request<LibraryDetail>('/api/library', { method: 'POST', body: JSON.stringify({ sourceId, mangaId }) }),
  deleteLibrary: (id: string, deleteFiles = true) =>
    request<{ ok: boolean }>(`/api/library/${id}?deleteFiles=${deleteFiles}`, { method: 'DELETE' }),
  refreshLibrary: (id: string) => request<LibraryDetail>(`/api/library/${id}/refresh`, { method: 'POST' }),

  downloadChapter: (libId: string, chapterId: string) =>
    request<{ ok: boolean }>(`/api/library/${libId}/chapters/${chapterId}/download`, { method: 'POST' }),
  downloadAll: (libId: string) =>
    request<{ ok: boolean; enqueued: number }>(`/api/library/${libId}/download-all`, { method: 'POST' }),
  downloads: () => request<DownloadJob[]>('/api/downloads'),
  jobAction: (jobId: string, action: 'pause' | 'resume' | 'cancel' | 'retry') =>
    request<{ ok: boolean }>(`/api/downloads/${jobId}/${action}`, { method: 'POST' }),
  deleteJob: (jobId: string) => request<{ ok: boolean }>(`/api/downloads/${jobId}`, { method: 'DELETE' }),
  deleteChapter: (chapterId: string) => request<{ ok: boolean }>(`/api/chapters/${chapterId}`, { method: 'DELETE' }),

  saveProgress: (chapterId: string, pageIndex: number) =>
    request<{ ok: boolean }>(`/api/reading-progress/${chapterId}`, {
      method: 'PUT',
      body: JSON.stringify({ pageIndex }),
    }),
  continueReading: (libId: string) => request<ContinueInfo | null>(`/api/library/${libId}/continue`),
  chapterPages: (chapterId: string) => request<ChapterPages>(`/api/chapters/${chapterId}/pages`),

  settings: () => request<AppSettings>('/api/settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
};
