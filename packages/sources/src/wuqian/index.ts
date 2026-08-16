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
 * 武芊漫画（移植自 wuji-tauri 源市场「武芊漫画」扩展）
 * 纯 API 源：https://comic.mkzcdn.com
 * - 搜索：/search/keyword/?keyword=&page_num=&page_size=
 * - 详情：/comic/info/?comic_id=（标题/封面）；/chapter/v1/?comic_id=（章节）
 * - 内容：/chapter/content/?chapter_id=&comic_id=（图片）
 * 章节 ID 采用复合格式 `comic_id/chapter_id`（取内容时两者都需要）。
 */
const DEFAULT_BASE = 'https://comic.mkzcdn.com';

function toResult(d: Record<string, any>): MangaSearchResult {
  return {
    mangaId: String(d.comic_id),
    title: String(d.title ?? 'Untitled'),
    author: d.author_title ? String(d.author_title) : undefined,
    coverUrl: d.cover ? String(d.cover) : undefined,
  };
}

const wuqianAdapter: MangaSourceAdapter = {
  id: 'wuqian',
  name: '武芊漫画',
  version: '1.0.0',
  description: '武芊漫画（移植自 wuji 源市场，API 源）',
  defaultBaseUrl: DEFAULT_BASE,

  async test(ctx: SourceContext): Promise<TestResult> {
    try {
      const data = await ctx.http.getJson<any>(`${ctx.baseUrl}/search/keyword/?keyword=a&page_num=1&page_size=1`);
      if (data?.code === '200') return { ok: true, message: '连接正常' };
      return { ok: false, message: `意外响应: ${JSON.stringify(data).slice(0, 200)}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  async search(query: string, ctx: SourceContext): Promise<MangaSearchResult[]> {
    const data = await ctx.http.getJson<any>(
      `${ctx.baseUrl}/search/keyword/?keyword=${encodeURIComponent(query)}&page_num=1&page_size=30`,
    );
    if (data?.code !== '200') return [];
    return (data.data?.list ?? []).map(toResult);
  },

  async getMangaDetail(mangaId: string, ctx: SourceContext): Promise<MangaDetail> {
    const [info, chaptersRes] = await Promise.all([
      ctx.http.getJson<any>(`${ctx.baseUrl}/comic/info/?comic_id=${encodeURIComponent(mangaId)}`),
      ctx.http.getJson<any>(`${ctx.baseUrl}/chapter/v1/?comic_id=${encodeURIComponent(mangaId)}`),
    ]);
    const d = info?.data;
    const chapters: ChapterMeta[] = ((chaptersRes?.data ?? []) as Record<string, any>[]).map((c) => ({
      // 复合 ID：内容接口需要 comic_id + chapter_id
      chapterId: `${mangaId}/${c.chapter_id}`,
      title: c.title ?? (c.number != null ? `第 ${c.number} 话` : String(c.chapter_id)),
      chapterNumber: c.number != null && c.number !== '' ? Number(c.number) : undefined,
    }));
    return {
      mangaId,
      title: d?.title ? String(d.title) : mangaId,
      author: d?.author_title ? String(d.author_title) : undefined,
      description: typeof d?.content === 'string' && d.content.trim() ? d.content.trim() : undefined,
      coverUrl: d?.cover ? String(d.cover) : undefined,
      chapters,
    };
  },

  async getPages(chapterId: string, ctx: SourceContext): Promise<Page[]> {
    const idx = chapterId.indexOf('/');
    if (idx <= 0) throw new Error(`武芊漫画: 无效章节 ID "${chapterId}"`);
    const comicId = chapterId.slice(0, idx);
    const chId = chapterId.slice(idx + 1);
    const data = await ctx.http.getJson<any>(
      `${ctx.baseUrl}/chapter/content/?chapter_id=${encodeURIComponent(chId)}&comic_id=${encodeURIComponent(comicId)}`,
    );
    if (data?.code !== '200') {
      throw new Error(`武芊漫画: 获取内容失败 (${data?.message ?? data?.code ?? 'unknown'})`);
    }
    return (data.data ?? [])
      .map((p: Record<string, any>) => ({ url: String(p.image) }))
      .filter((p: Page) => p.url.startsWith('http'));
  },
};

export { wuqianAdapter };
