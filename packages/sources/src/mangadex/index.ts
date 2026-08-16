import type { ChapterMeta, MangaDetail, MangaSearchResult, MangaSourceAdapter, Page, SourceContext, TestResult } from '@multmanga/core';

const API_BASE = 'https://api.mangadex.org';
const DEFAULT_LANGS = ['zh', 'en'];
const TITLE_ORDER = ['zh-hans', 'zh', 'zh-hant', 'en'];
// MangaDex 语言代码校验：^[a-z]{2}(-[a-z]{2})?$（如 zh、en、ja、zh-hk）
const LANG_PATTERN = /^[a-z]{2}(-[a-z]{2})?$/;

function getLanguages(ctx: SourceContext): string[] {
  let raw: string[] = DEFAULT_LANGS;
  const cfg = ctx.config.languages;
  if (typeof cfg === 'string' && cfg.trim()) {
    raw = cfg.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(cfg) && cfg.length > 0) {
    raw = cfg.map(String);
  }
  return raw.filter((l) => LANG_PATTERN.test(l));
}

function pickTitle(titles: Record<string, string> | undefined): string {
  if (!titles) return 'Untitled';
  for (const lang of TITLE_ORDER) {
    if (titles[lang]) return titles[lang];
  }
  return Object.values(titles)[0] ?? 'Untitled';
}

function pickDescription(desc: Record<string, string> | undefined): string {
  if (!desc) return '';
  for (const lang of TITLE_ORDER) {
    if (desc[lang]) return desc[lang];
  }
  return Object.values(desc)[0] ?? '';
}

function coverFile(manga: Record<string, any>): string | undefined {
  const rel = (manga.relationships ?? []).find((r: any) => r.type === 'cover_art');
  return rel?.attributes?.fileName;
}

function toResult(m: Record<string, any>): MangaSearchResult {
  const mangaId = String(m.id);
  const cover = coverFile(m);
  const authorRel = (m.relationships ?? []).find((r: any) => r.type === 'author');
  return {
    mangaId,
    title: pickTitle(m.attributes?.title),
    author: authorRel?.attributes?.name,
    description: pickDescription(m.attributes?.description),
    coverUrl: cover ? `https://uploads.mangadex.org/covers/${mangaId}/${cover}.256.jpg` : undefined,
    status: m.attributes?.status,
    url: `https://mangadex.org/title/${mangaId}`,
  };
}

function feedParams(langs: string[]): URLSearchParams {
  const p = new URLSearchParams({
    limit: '500',
    'order[chapter]': 'asc',
    'includes[]': 'scanlation_group',
  });
  for (const l of langs) p.append('translatedLanguage[]', l);
  return p;
}

const mangadexAdapter: MangaSourceAdapter = {
  id: 'mangadex',
  name: 'MangaDex',
  version: '1.0.0',
  description: 'MangaDex 官方 API（多语言漫画聚合站）',
  defaultBaseUrl: API_BASE,
  configSchema: [
    {
      key: 'languages',
      label: '翻译语言（MangaDex 语言代码，逗号分隔）',
      type: 'string',
      default: 'zh,en',
      help: '如 zh,en,ja；仅支持两位代码（xx 或 xx-xx，如 zh-hk），其余会被忽略',
    },
  ],

  async test(ctx: SourceContext): Promise<TestResult> {
    try {
      const text = await ctx.http.getText(`${ctx.baseUrl}/ping`);
      if (text.trim().toLowerCase() === 'pong') return { ok: true, message: '连接正常（pong）' };
      return { ok: false, message: `意外响应: ${text.slice(0, 200)}` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  async search(query: string, ctx: SourceContext): Promise<MangaSearchResult[]> {
    const langs = getLanguages(ctx);
    const params = new URLSearchParams({ title: query, limit: '25', 'includes[]': 'cover_art' });
    params.append('contentRating[]', 'safe');
    params.append('contentRating[]', 'suggestive');
    for (const l of langs) params.append('availableTranslatedLanguage[]', l);
    const data = await ctx.http.getJson<any>(`${ctx.baseUrl}/manga?${params}`);
    return (data.data ?? []).map(toResult);
  },

  async getMangaDetail(mangaId: string, ctx: SourceContext): Promise<MangaDetail> {
    const langs = getLanguages(ctx);
    const [manga, feed] = await Promise.all([
      ctx.http.getJson<any>(`${ctx.baseUrl}/manga/${encodeURIComponent(mangaId)}?includes[]=cover_art&includes[]=author`),
      ctx.http.getJson<any>(`${ctx.baseUrl}/manga/${encodeURIComponent(mangaId)}/feed?${feedParams(langs)}`),
    ]);
    const m = manga.data as Record<string, any>;
    const chapters: ChapterMeta[] = (feed.data ?? []).map((c: Record<string, any>) => {
      const attrs = c.attributes ?? {};
      const num = attrs.chapter;
      const hasNum = num !== null && num !== undefined && num !== '';
      return {
        chapterId: String(c.id),
        title: attrs.title || (hasNum ? `第 ${num} 话` : String(c.id)),
        chapterNumber: hasNum ? Number(num) : undefined,
        volume: attrs.volume ?? undefined,
        publishedAt: attrs.publishAt ?? undefined,
      };
    });
    chapters.sort(
      (a, b) =>
        (a.chapterNumber ?? Number.MAX_SAFE_INTEGER) - (b.chapterNumber ?? Number.MAX_SAFE_INTEGER) ||
        (a.publishedAt ?? '').localeCompare(b.publishedAt ?? ''),
    );
    return { ...toResult(m), chapters };
  },

  async getPages(chapterId: string, ctx: SourceContext): Promise<Page[]> {
    const data = await ctx.http.getJson<any>(`${ctx.baseUrl}/at-home/server/${encodeURIComponent(chapterId)}`);
    const base = data?.baseUrl as string | undefined;
    const hash = data?.chapter?.hash as string | undefined;
    const files = (data?.chapter?.data ?? []) as string[];
    if (!base || !hash || files.length === 0) {
      throw new Error(`MangaDex: 章节无图片数据 (${chapterId})`);
    }
    return files.map((f) => ({ url: `${base}/data/${hash}/${f}` }));
  },
};

export { mangadexAdapter };
