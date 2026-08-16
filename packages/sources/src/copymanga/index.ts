import type {
  ChapterMeta,
  MangaDetail,
  MangaSearchResult,
  MangaSourceAdapter,
  Page,
  SourceContext,
  TestResult,
} from '@multmanga/core';

/**
 * Copymanga（拷贝漫画）适配器。
 * 注意：Copymanga 域名不稳定（api.copymanga.tv 曾多次更换），
 * 默认 baseUrl 可通过源配置覆盖为当前可用镜像域名。
 */
const DEFAULT_API_BASE = 'https://api.copymanga.tv';
const WEB_BASE = 'https://www.copymanga.tv';

function apiHeaders(ctx: SourceContext): Record<string, string> {
  return {
    platform: String(ctx.config.platform ?? '1'),
    version: String(ctx.config.version ?? '2.3.4'),
  };
}

function toResult(m: Record<string, any>): MangaSearchResult {
  const pathWord = String(m.path_word ?? '');
  return {
    mangaId: pathWord,
    title: m.name ?? pathWord ?? 'Untitled',
    author: Array.isArray(m.author)
      ? m.author.map((a: any) => a.name).filter(Boolean).join(', ')
      : undefined,
    coverUrl: m.cover ? String(m.cover) : undefined,
    status: m.status ? String(m.status) : undefined,
    url: `${WEB_BASE}/comic/${encodeURIComponent(pathWord)}`,
  };
}

const copymangaAdapter: MangaSourceAdapter = {
  id: 'copymanga',
  name: 'Copymanga',
  version: '1.0.0',
  description: 'Copymanga（拷贝漫画，中文漫画）',
  defaultBaseUrl: DEFAULT_API_BASE,
  configSchema: [
    { key: 'platform', label: 'platform 头', type: 'string', default: '1' },
    { key: 'version', label: 'version 头', type: 'string', default: '2.3.4' },
    {
      key: 'referer',
      label: '图片 Referer',
      type: 'string',
      default: WEB_BASE,
      help: '图片防盗链所需的 Referer，通常保持默认',
    },
  ],

  async test(ctx: SourceContext): Promise<TestResult> {
    try {
      const data = await ctx.http.getJson<any>(
        `${ctx.baseUrl}/api/v3/search/comic?format=json&q=test&limit=1&offset=0`,
        apiHeaders(ctx),
      );
      const list = data?.results?.list;
      if (Array.isArray(list)) return { ok: true, message: `连接正常（命中 ${list.length} 条）` };
      return { ok: false, message: `意外响应: ${JSON.stringify(data).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  async search(query: string, ctx: SourceContext): Promise<MangaSearchResult[]> {
    const params = new URLSearchParams({ format: 'json', q: query, limit: '30', offset: '0' });
    const data = await ctx.http.getJson<any>(
      `${ctx.baseUrl}/api/v3/search/comic?${params}`,
      apiHeaders(ctx),
    );
    return (data?.results?.list ?? []).map(toResult);
  },

  async getMangaDetail(mangaId: string, ctx: SourceContext): Promise<MangaDetail> {
    const comic = encodeURIComponent(mangaId);
    const [detail, chaptersRes] = await Promise.all([
      ctx.http.getJson<any>(`${ctx.baseUrl}/api/v3/comic/${comic}?format=json`, apiHeaders(ctx)),
      ctx.http.getJson<any>(
        `${ctx.baseUrl}/api/v3/comic/${comic}/group/default/chapters?format=json&limit=500&offset=0`,
        apiHeaders(ctx),
      ),
    ]);
    const d = detail?.results;
    const chapters: ChapterMeta[] = (chaptersRes?.results?.list ?? []).map((c: Record<string, any>) => ({
      // 复合 ID：path_word/uuid，getPages 需要两者
      chapterId: `${mangaId}/${String(c.uuid)}`,
      title: c.name ?? (c.index !== undefined ? `第 ${c.index} 话` : String(c.uuid)),
      chapterNumber: c.index !== undefined && c.index !== '' ? Number(c.index) : undefined,
    }));
    return {
      mangaId,
      title: d?.name ?? mangaId,
      author: Array.isArray(d?.author)
        ? d.author.map((a: any) => a.name).filter(Boolean).join(', ')
        : undefined,
      description: d?.description ? String(d.description) : undefined,
      coverUrl: d?.cover ? String(d.cover) : undefined,
      status: d?.status ? String(d.status) : undefined,
      chapters,
    };
  },

  async getPages(chapterId: string, ctx: SourceContext): Promise<Page[]> {
    const idx = chapterId.indexOf('/');
    if (idx <= 0) throw new Error(`Copymanga: 无效章节 ID "${chapterId}"`);
    const pathWord = chapterId.slice(0, idx);
    const uuid = chapterId.slice(idx + 1);
    const data = await ctx.http.getJson<any>(
      `${ctx.baseUrl}/api/v3/comic/${encodeURIComponent(pathWord)}/chapter2/${encodeURIComponent(uuid)}?format=json`,
      apiHeaders(ctx),
    );
    const words = data?.results?.chapter?.words ?? [];
    return words
      .map((w: Record<string, any>) => ({ url: String(w.url) }))
      .filter((p: Page) => p.url && p.url.startsWith('http'));
  },

  getImageHeaders(_url: string, ctx: SourceContext): Record<string, string> {
    return { Referer: String(ctx.config.referer ?? WEB_BASE) };
  },
};

export { copymangaAdapter };
