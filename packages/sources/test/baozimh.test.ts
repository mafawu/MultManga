import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceContext } from '@multmanga/core';
import { baozimhAdapter } from '../src/baozimh/index.js';

function makeCtx(): SourceContext {
  return {
    baseUrl: 'https://cn.baozimhcn.com',
    config: {},
    http: {
      getJson: vi.fn(),
      getText: vi.fn(),
      getBuffer: vi.fn(),
    },
    log: console,
  } as unknown as SourceContext;
}

afterEach(() => vi.restoreAllMocks());

const SEARCH_HTML = `
<html><body>
  <div class="comics-card">
    <a href="/comic/zangsongdefulilian" title="葬送的芙莉莲" class="comics-card__poster">
      <amp-img src="https://static-tw.baozimhcn.com/cover/zangsongdefulilian.jpg?w=285&amp;h=375&amp;q=100"></amp-img>
    </a>
    <h3 class="comics-card__title">葬送的芙莉莲</h3>
  </div>
</body></html>`;

const DETAIL_HTML = `
<html><body>
  <h1 class="comics-detail__title">葬送的芙莉莲</h1>
  <div class="comics-detail__desc">勇者一行击败魔王后的故事。</div>
  <div id="chapter-items">
    <a href="/user/page_direct?comic_id=zangsongdefulilian&amp;section_slot=0&amp;chapter_slot=0"><span>第1话</span></a>
    <a href="/user/page_direct?comic_id=zangsongdefulilian&amp;section_slot=0&amp;chapter_slot=1"><span>第2话</span></a>
  </div>
</body></html>`;

const CHAPTER_HTML = `
<html><body>
  <div class="comic-contain">
    <amp-img src="https://s1.bzcdn.net/scomic/zangsongdefulilian/0/0-ekr4/1.jpg"></amp-img>
    <amp-img src="https://s1.bzcdn.net/scomic/zangsongdefulilian/0/0-ekr4/2.jpg"></amp-img>
    <img src="https://s1.bzcdn.net/scomic/zangsongdefulilian/0/0-ekr4/3.jpg">
  </div>
</body></html>`;

describe('baozimhAdapter.search', () => {
  it('从 comics-card 解析标题、ID 与封面', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getText).mockResolvedValue(SEARCH_HTML);
    const results = await baozimhAdapter.search('芙莉莲', ctx);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      mangaId: 'zangsongdefulilian',
      title: '葬送的芙莉莲',
      url: 'https://cn.baozimhcn.com/comic/zangsongdefulilian',
    });
    expect(results[0]!.coverUrl).toContain('static-tw.baozimhcn.com');
  });
});

describe('baozimhAdapter.getMangaDetail', () => {
  it('解析简介与章节（含 &amp; 解码的跳转地址）', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getText).mockResolvedValue(DETAIL_HTML);
    const detail = await baozimhAdapter.getMangaDetail('zangsongdefulilian', ctx);
    expect(detail.title).toBe('葬送的芙莉莲');
    expect(detail.description).toBe('勇者一行击败魔王后的故事。');
    expect(detail.chapters).toHaveLength(2);
    expect(detail.chapters[0]!.title).toBe('第1话');
    expect(detail.chapters[0]!.chapterId).toContain('chapter_slot=0');
    expect(detail.chapters[0]!.chapterId).not.toContain('&amp;');
  });
});

describe('baozimhAdapter.getPages', () => {
  it('从章节页解析 comic-contain 中的 amp-img 与 img', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getText).mockResolvedValue(CHAPTER_HTML);
    const pages = await baozimhAdapter.getPages('https://cn.baozimhcn.com/user/page_direct?x=1', ctx);
    expect(pages).toHaveLength(3);
    // 镜像替换：s1.bzcdn.net → static-tw.baozimhcn.com
    expect(pages[0]!.url).toBe('https://static-tw.baozimhcn.com/scomic/zangsongdefulilian/0/0-ekr4/1.jpg');
    expect(pages[2]!.url).toBe('https://static-tw.baozimhcn.com/scomic/zangsongdefulilian/0/0-ekr4/3.jpg');
  });

  it('替换任意 sN.bzcdn.net 子域（含 s2，实测该 CDN 连接被重置）', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getText).mockResolvedValue(`
      <html><body><div class="comic-contain">
        <amp-img src="https://s2.bzcdn.net/scomic/xxx/0/2-df6a/1.jpg"></amp-img>
        <amp-img src="https://s3.bzcdn.net/scomic/xxx/0/2-df6a/2.jpg"></amp-img>
        <img src="https://s1.bzcdn.net/scomic/xxx/0/2-df6a/3.jpg">
      </div></body></html>`);
    const pages = await baozimhAdapter.getPages('https://cn.baozimhcn.com/x', ctx);
    expect(pages.map((p) => p.url)).toEqual([
      'https://static-tw.baozimhcn.com/scomic/xxx/0/2-df6a/1.jpg',
      'https://static-tw.baozimhcn.com/scomic/xxx/0/2-df6a/2.jpg',
      'https://static-tw.baozimhcn.com/scomic/xxx/0/2-df6a/3.jpg',
    ]);
  });

  it('章节无图片时抛错', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getText).mockResolvedValue('<html><body></body></html>');
    await expect(baozimhAdapter.getPages('https://x', ctx)).rejects.toThrow('无图片');
  });
});

describe('baozimhAdapter 其他', () => {
  it('getImageHeaders 附加站点 Referer', () => {
    const ctx = makeCtx();
    expect(baozimhAdapter.getImageHeaders!('https://s1.bzcdn.net/1.jpg', ctx).Referer).toContain('baozimhcn');
  });

  it('test 依据页面结构判断', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getText).mockResolvedValue(SEARCH_HTML);
    const r = await baozimhAdapter.test!(ctx);
    expect(r.ok).toBe(true);
  });
});
