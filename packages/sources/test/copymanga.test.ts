import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceContext } from '@multmanga/core';
import { copymangaAdapter } from '../src/copymanga/index.js';

function makeCtx(config: Record<string, unknown> = {}): SourceContext {
  return {
    baseUrl: 'https://api.copymanga.tv',
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
  results: {
    list: [
      { path_word: 'frieren', name: '葬送的芙莉莲', cover: 'https://img.example.com/c.jpg', author: [{ name: '山田' }] },
    ],
  },
};

afterEach(() => vi.restoreAllMocks());

describe('copymangaAdapter.search', () => {
  it('映射搜索结果并携带 platform 请求头', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson).mockResolvedValue(searchResponse);
    const results = await copymangaAdapter.search('芙莉莲', ctx);
    expect(results[0]).toMatchObject({
      mangaId: 'frieren',
      title: '葬送的芙莉莲',
      author: '山田',
      coverUrl: 'https://img.example.com/c.jpg',
    });
    const [, headers] = vi.mocked(ctx.http.getJson).mock.calls[0] as [string, Record<string, string>];
    expect(headers.platform).toBe('1');
  });
});

describe('copymangaAdapter.getMangaDetail', () => {
  it('章节 ID 为 path_word/uuid 复合格式', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson)
      .mockResolvedValueOnce({
        results: { name: '葬送的芙莉莲', author: [{ name: '山田' }], cover: 'https://img/c.jpg' },
      })
      .mockResolvedValueOnce({
        results: { list: [{ uuid: 'u1', name: '第 1 话', index: '1' }] },
      });
    const detail = await copymangaAdapter.getMangaDetail('frieren', ctx);
    expect(detail.chapters[0]!.chapterId).toBe('frieren/u1');
    expect(detail.chapters[0]!.chapterNumber).toBe(1);
  });
});

describe('copymangaAdapter.getPages', () => {
  it('解析章节 words 为图片页', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson).mockResolvedValue({
      results: { chapter: { words: [{ url: 'https://res.example.com/1.jpg' }, { url: 'https://res.example.com/2.jpg' }] } },
    });
    const pages = await copymangaAdapter.getPages('frieren/u1', ctx);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.url).toContain('res.example.com');
  });
});

describe('copymangaAdapter.getImageHeaders', () => {
  it('默认附加 copymanga 站点 Referer', () => {
    const ctx = makeCtx();
    const h = copymangaAdapter.getImageHeaders!('https://res.example.com/1.jpg', ctx);
    expect(h.Referer).toContain('copymanga');
  });
});
