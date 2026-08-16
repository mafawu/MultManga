import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceContext } from '@multmanga/core';
import { wuqianAdapter } from '../src/wuqian/index.js';

function makeCtx(): SourceContext {
  return {
    baseUrl: 'https://comic.mkzcdn.com',
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

describe('wuqianAdapter.search', () => {
  it('映射搜索结果（code 200）', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson).mockResolvedValue({
      code: '200',
      data: {
        list: [
          { comic_id: '214623', title: '爱神APP', cover: 'http://oss.mkzcdn.com/c.jpg', author_title: '极漫文化' },
        ],
      },
    });
    const results = await wuqianAdapter.search('爱神', ctx);
    expect(results[0]).toMatchObject({
      mangaId: '214623',
      title: '爱神APP',
      author: '极漫文化',
      coverUrl: 'http://oss.mkzcdn.com/c.jpg',
    });
  });

  it('code 非 200 返回空', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson).mockResolvedValue({ code: '199', message: '搜索结果为空' });
    expect(await wuqianAdapter.search('x', ctx)).toEqual([]);
  });
});

describe('wuqianAdapter.getMangaDetail', () => {
  it('合并 info 与章节，章节 ID 为复合格式', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson)
      .mockResolvedValueOnce({ code: '200', data: { comic_id: '214623', title: '爱神APP', cover: 'http://oss/c.jpg' } })
      .mockResolvedValueOnce({
        code: '200',
        data: [
          { chapter_id: '827108', number: '1', title: '预告' },
          { chapter_id: '914290', number: '2', title: '第一章' },
        ],
      });
    const detail = await wuqianAdapter.getMangaDetail('214623', ctx);
    expect(detail.title).toBe('爱神APP');
    expect(detail.chapters).toHaveLength(2);
    expect(detail.chapters[0]!.chapterId).toBe('214623/827108');
    expect(detail.chapters[0]!.chapterNumber).toBe(1);
  });
});

describe('wuqianAdapter.getPages', () => {
  it('解析章节图片', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson).mockResolvedValue({
      code: '200',
      data: [{ image: 'http://oss.mkzcdn.com/image/1.jpg' }, { image: 'http://oss.mkzcdn.com/image/2.jpg' }],
    });
    const pages = await wuqianAdapter.getPages('214623/827108', ctx);
    expect(pages).toHaveLength(2);
    expect(pages[0]!.url).toBe('http://oss.mkzcdn.com/image/1.jpg');
    const calledUrl = vi.mocked(ctx.http.getJson).mock.calls[0][0] as string;
    expect(calledUrl).toContain('chapter_id=827108');
    expect(calledUrl).toContain('comic_id=214623');
  });

  it('无效章节 ID 抛错', async () => {
    const ctx = makeCtx();
    await expect(wuqianAdapter.getPages('bad-id', ctx)).rejects.toThrow('无效章节');
  });
});

describe('wuqianAdapter.test', () => {
  it('code 200 视为连接正常', async () => {
    const ctx = makeCtx();
    vi.mocked(ctx.http.getJson).mockResolvedValue({ code: '200', data: { count: '1', list: [] } });
    const r = await wuqianAdapter.test!(ctx);
    expect(r.ok).toBe(true);
  });
});
