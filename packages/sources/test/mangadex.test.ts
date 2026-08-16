import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceContext } from '@multmanga/core';
import { mangadexAdapter } from '../src/mangadex/index.js';

function makeCtx(config: Record<string, unknown> = {}): SourceContext {
  return {
    baseUrl: 'https://api.mangadex.org',
    config,
    http: {
      getJson: vi.fn(),
      getText: vi.fn(),
      getBuffer: vi.fn(),
    },
    log: console,
  } as unknown as SourceContext;
}

const searchResponse = {
  data: [
    {
      id: 'abc-123',
      attributes: {
        title: { en: 'Frieren', 'zh-hans': '葬送的芙莉莲' },
        description: { 'zh-hans': '简介' },
        status: 'ongoing',
      },
      relationships: [
        { type: 'cover_art', attributes: { fileName: 'cover.jpg' } },
        { type: 'author', attributes: { name: '山田' } },
      ],
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mangadexAdapter.search', () => {
  it('映射搜索结果并选取中文标题', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson).mockResolvedValue(searchResponse);
    const results = await mangadexAdapter.search('芙莉莲', ctx);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      mangaId: 'abc-123',
      title: '葬送的芙莉莲',
      author: '山田',
      coverUrl: 'https://uploads.mangadex.org/covers/abc-123/cover.jpg.256.jpg',
    });
    const calledUrl = decodeURIComponent(vi.mocked(ctx.http.getJson).mock.calls[0][0] as string);
    expect(calledUrl).toContain('/manga?');
    expect(calledUrl).toContain('availableTranslatedLanguage[]=zh');
    expect(calledUrl).toContain('contentRating[]=safe');
  });
});

describe('mangadexAdapter.getMangaDetail', () => {
  it('合并详情与章节列表并按章节号排序', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson)
      .mockResolvedValueOnce({ data: searchResponse.data[0] })
      .mockResolvedValueOnce({
        data: [
          { id: 'c2', attributes: { chapter: '2', title: '第二章', publishAt: '2024-01-02' } },
          { id: 'c1', attributes: { chapter: '1', title: null, publishAt: '2024-01-01' } },
        ],
      });
    const detail = await mangadexAdapter.getMangaDetail('abc-123', ctx);
    expect(detail.chapters).toHaveLength(2);
    expect(detail.chapters[0]!.chapterId).toBe('c1');
    expect(detail.chapters[0]!.title).toBe('第 1 话');
    expect(detail.chapters[1]!.chapterId).toBe('c2');
    expect(detail.chapters[1]!.chapterNumber).toBe(2);
  });
});

describe('mangadexAdapter.getPages', () => {
  it('从 at-home 服务器构造图片 URL', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson).mockResolvedValue({
      baseUrl: 'https://uploads.mangadex.org',
      chapter: { hash: 'h123', data: ['p1.jpg', 'p2.jpg'] },
    });
    const pages = await mangadexAdapter.getPages('ch-1', ctx);
    expect(pages).toEqual([
      { url: 'https://uploads.mangadex.org/data/h123/p1.jpg' },
      { url: 'https://uploads.mangadex.org/data/h123/p2.jpg' },
    ]);
  });

  it('章节无图片时抛错', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson).mockResolvedValue({ baseUrl: 'x', chapter: { hash: 'h', data: [] } });
    await expect(mangadexAdapter.getPages('ch-1', ctx)).rejects.toThrow('无图片数据');
  });
});

describe('mangadexAdapter.test', () => {
  it('ping 返回 pong 视为连接正常', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getText).mockResolvedValue('pong');
    const r = await mangadexAdapter.test!(ctx);
    expect(r.ok).toBe(true);
  });
});
