import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpClient } from '../src/http-client.js';

afterEach(() => vi.restoreAllMocks());

describe('http-client HTTPS→HTTP 回退', () => {
  it('https 网络级失败（超时）时自动改用 http 重试，并记住该主机', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://')) {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createHttpClient({ retries: 0 });
    const buf = await client.getBuffer('https://img1.example.com/a.jpg');
    expect([...buf]).toEqual([1, 2, 3]);
    expect(fetchMock.mock.calls.map((c) => c[0] as string)).toEqual([
      'https://img1.example.com/a.jpg',
      'http://img1.example.com/a.jpg',
    ]);

    // 第二次请求同一主机：直接走 http（记忆生效）
    fetchMock.mockClear();
    await client.getBuffer('https://img1.example.com/b.jpg');
    expect(fetchMock.mock.calls.map((c) => c[0] as string)).toEqual(['http://img1.example.com/b.jpg']);
  });

  it('http 状态错误（404）不触发 https→http 回退', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createHttpClient({ retries: 0 });
    await expect(client.getBuffer('https://img2.example.com/a.jpg')).rejects.toThrow();
    expect(fetchMock.mock.calls.map((c) => c[0] as string)).toEqual(['https://img2.example.com/a.jpg']);
  });

  it('http 回退失败时抛出原始错误', async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createHttpClient({ retries: 0 });
    await expect(client.getBuffer('https://img3.example.com/a.jpg')).rejects.toThrow();
  });
});
