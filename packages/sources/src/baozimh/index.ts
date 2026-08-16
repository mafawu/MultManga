import { load } from 'cheerio';
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
 * 包子漫画（移植自 wuji-tauri 源市场「包子漫画」扩展）
 * 站址：https://cn.baozimhcn.com
 * 搜索/详情/章节均为 HTML 解析；章节链接为 /user/page_direct 跳转地址，会 302 到实际章节页。
 */
const DEFAULT_BASE = 'https://cn.baozimhcn.com';

function abs(baseUrl: string, href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith('//')) return 'https:' + href;
  return `${baseUrl.replace(/\/+$/, '')}/${href.replace(/^\/+/, '')}`;
}

function searchResult($el: ReturnType<ReturnType<typeof load>>, baseUrl: string): MangaSearchResult | null {
  const title =
    $el.find('h3').first().text().trim() ||
    $el.find('a.comics-card__poster').attr('title')?.trim() ||
    '';
  const href = $el.find('a.comics-card__poster').attr('href');
  const id = href ? href.split('/').filter(Boolean).pop() ?? '' : '';
  if (!title || !id || !href) return null;
  const img = $el.find('amp-img').first();
  const cover = img.attr('src') ?? img.attr('data-src') ?? '';
  return {
    mangaId: id,
    title,
    coverUrl: cover || undefined,
    url: abs(baseUrl, href),
  };
}

const baozimhAdapter: MangaSourceAdapter = {
  id: 'baozimh',
  name: '包子漫画',
  version: '1.0.0',
  description: '包子漫画（移植自 wuji 源市场，HTML 源）',
  defaultBaseUrl: DEFAULT_BASE,

  async test(ctx: SourceContext): Promise<TestResult> {
    try {
      const html = await ctx.http.getText(`${ctx.baseUrl}/search?q=a`);
      if (html.includes('comics-card')) return { ok: true, message: '连接正常' };
      return { ok: false, message: '页面结构异常（未找到漫画卡片）' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },

  async search(query: string, ctx: SourceContext): Promise<MangaSearchResult[]> {
    const html = await ctx.http.getText(`${ctx.baseUrl}/search?q=${encodeURIComponent(query)}`);
    const $ = load(html);
    const results: MangaSearchResult[] = [];
    $('.comics-card').each((_, el) => {
      const r = searchResult($(el), ctx.baseUrl);
      if (r) results.push(r);
    });
    return results;
  },

  async getMangaDetail(mangaId: string, ctx: SourceContext): Promise<MangaDetail> {
    const html = await ctx.http.getText(`${ctx.baseUrl}/comic/${encodeURIComponent(mangaId)}`);
    const $ = load(html);
    const title = $('.comics-detail__title').first().text().trim() || mangaId;
    const intro = $('.comics-detail__desc').first().text().trim();
    const cover =
      $('.comics-detail__poster amp-img, .comics-detail amp-img, .comics-detail__poster img')
        .first()
        .attr('src') ?? undefined;

    const chapters: ChapterMeta[] = [];
    let els = $('#chapter-items a[href], #chapters_other_list a[href]');
    if (els.length === 0) els = $('.l-content:nth-child(3) a[href]');
    els.each((_, el) => {
      const $el = $(el);
      const t = $el.find('span').first().text().trim();
      const href = $el.attr('href');
      if (t && href) {
        chapters.push({ chapterId: abs(ctx.baseUrl, href), title: t });
      }
    });

    return {
      mangaId,
      title,
      description: intro || undefined,
      coverUrl: cover,
      chapters,
    };
  },

  async getPages(chapterId: string, ctx: SourceContext): Promise<Page[]> {
    const html = await ctx.http.getText(chapterId);
    const $ = load(html);
    const urls: string[] = [];
    // 站点用 <amp-img> 承载图片（部分页面为 <img>），两者都取
    $('.comic-contain img, .comic-contain amp-img').each((_, el) => {
      let src = $(el).attr('src');
      if (!src) return;
      // 图片 CDN 镜像替换：章节页给出的 s*.bzcdn.net（s1/s2/s3…）在部分网络下
      // HTTPS 连接被重置 / HTTP 404，统一换到站点自己的 static-tw.baozimhcn.com
      // （与封面同源，实测可访问，同路径资源可正常返回）
      src = src.replace(/s\d+\.bzcdn\.net/gi, 'static-tw.baozimhcn.com');
      // wuji 源遗留的反盗链镜像规则（旧域名，无匹配则原样保留）
      src = src.replace('.baozicdn.com/', '-mha1-nlams.baozicdn.com/');
      if (!/^https?:\/\//i.test(src)) {
        src = src.startsWith('//') ? 'https:' + src : abs(ctx.baseUrl, src);
      }
      urls.push(src);
    });
    if (urls.length === 0) throw new Error('包子漫画: 章节无图片');
    return urls.map((url) => ({ url }));
  },

  getImageHeaders(): Record<string, string> {
    return { Referer: `${DEFAULT_BASE}/` };
  },
};

export { baozimhAdapter };
