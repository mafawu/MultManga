import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MangaSourceAdapter } from '@multmanga/core';
import { registerAdapter } from '@multmanga/sources';
import { buildApp } from '../src/app.js';
import { makeConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db.js';
import { EventBus } from '../src/events.js';
import { DownloadQueue } from '../src/download/queue.js';
import { log } from '../src/utils.js';

const fakeAdapter: MangaSourceAdapter = {
  id: 'test-source',
  name: '测试源',
  version: '1.0.0',
  defaultBaseUrl: 'https://test.example.com',
  async search(query) {
    return [{ mangaId: 'm1', title: `测试漫画 ${query}`, author: '作者甲' }];
  },
  async getMangaDetail(mangaId) {
    return {
      mangaId,
      title: '测试漫画',
      author: '作者甲',
      description: '简介',
      coverUrl: 'https://img.example.test/cover.jpg',
      chapters: [
        { chapterId: 'c1', title: '第 1 话', chapterNumber: 1 },
        { chapterId: 'c2', title: '第 2 话', chapterNumber: 2 },
      ],
    };
  },
  async getPages() {
    return [
      { url: 'https://img.example.test/p1.png' },
      { url: 'https://img.example.test/p2.png' },
    ];
  },
};

// 1x1 有效 PNG（最小文件）
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

describe('服务端 API 集成', () => {
  let tmpDir: string;
  let cfg: ReturnType<typeof makeConfig>;
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  let queue: DownloadQueue;
  let sourceId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multmanga-test-'));
    cfg = makeConfig({ dataDir: tmpDir, storageDir: path.join(tmpDir, 'library'), dbPath: path.join(tmpDir, 'test.db') });
    db = openDb(cfg);
    registerAdapter(fakeAdapter);
    const bus = new EventBus();
    queue = new DownloadQueue(db, bus, cfg, log);
    queue.start();
    app = buildApp({ db, cfg, bus, queue, log });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('https://img.example.test/')) {
          return new Response(new Blob([PNG_BYTES]), { status: 200, headers: { 'content-type': 'image/png' } });
        }
        return new Response('not found', { status: 404 });
      }),
    );
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    queue.stop();
    await app.close();
    db.close();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function waitForJobDone(jobId: string, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await app.inject({ method: 'GET', url: '/api/downloads' });
      const jobs = res.json() as { id: string; state: string }[];
      const job = jobs.find((j) => j.id === jobId);
      if (job && (job.state === 'done' || job.state === 'failed')) return job;
      await sleep(100);
    }
    throw new Error('等待下载任务完成超时');
  }

  it('/api/adapters 列出已注册适配器', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/adapters' });
    expect(res.statusCode).toBe(200);
    const adapters = res.json() as { id: string }[];
    expect(adapters.some((a) => a.id === 'test-source')).toBe(true);
  });

  it('/api/sources 增删改查', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: { adapterId: 'test-source', name: '测试源', baseUrl: 'https://test.example.com' },
    });
    expect(created.statusCode).toBe(200);
    sourceId = (created.json() as { id: string }).id;

    const list = await app.inject({ method: 'GET', url: '/api/sources' });
    const rows = list.json() as { id: string; adapterId: string }[];
    expect(rows.some((r) => r.id === sourceId && r.adapterId === 'test-source')).toBe(true);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/sources/${sourceId}`,
      payload: { name: '测试源改名' },
    });
    expect((patched.json() as { name: string }).name).toBe('测试源改名');

    const tested = await app.inject({ method: 'POST', url: `/api/sources/${sourceId}/test` });
    expect(tested.statusCode).toBe(200);
  });

  it('搜索并加入书架', async () => {
    const search = await app.inject({ method: 'GET', url: `/api/search?q=测试&sourceId=${sourceId}` });
    expect(search.statusCode).toBe(200);
    const s = search.json() as { results: { mangaId: string; sourceName: string }[] };
    expect(s.results[0]?.mangaId).toBe('m1');
    expect(s.results[0]?.sourceName).toBe('测试源改名');

    const added = await app.inject({
      method: 'POST',
      url: '/api/library',
      payload: { sourceId, mangaId: 'm1' },
    });
    expect(added.statusCode).toBe(200);
    const item = added.json() as { id: string; chapters: { chapterId: string; downloadState: string }[] };
    expect(item.chapters).toHaveLength(2);
    expect(item.chapters[0]?.downloadState).toBe('none');

    // 重复加入幂等
    const again = await app.inject({
      method: 'POST',
      url: '/api/library',
      payload: { sourceId, mangaId: 'm1' },
    });
    expect(again.statusCode).toBe(200);

    const lib = await app.inject({ method: 'GET', url: '/api/library' });
    expect((lib.json() as unknown[]).length).toBe(1);
  });

  it('下载章节：任务完成、文件落盘、状态更新', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/library' });
    const libId = (list.json() as { id: string }[])[0]!.id;
    const detail = await app.inject({ method: 'GET', url: `/api/library/${libId}` });
    const ch = (detail.json() as { chapters: { id: string; chapterId: string }[] }).chapters.find(
      (c) => c.chapterId === 'c1',
    )!;

    const enq = await app.inject({
      method: 'POST',
      url: `/api/library/${libId}/chapters/${ch.id}/download`,
    });
    expect(enq.statusCode).toBe(200);

    const downloads = await app.inject({ method: 'GET', url: '/api/downloads' });
    const jobs = downloads.json() as { id: string; state: string }[];
    expect(jobs.length).toBeGreaterThan(0);

    const done = await waitForJobDone(jobs[0]!.id);
    expect(done.state).toBe('done');

    const files = await fs.promises.readdir(path.join(cfg.storageDir, libId, ch.id));
    expect(files.sort()).toEqual(['001.png', '002.png']);

    const detail2 = await app.inject({ method: 'GET', url: `/api/library/${libId}` });
    const ch2 = (detail2.json() as { chapters: { chapterId: string; downloadState: string }[] }).chapters.find(
      (c) => c.chapterId === 'c1',
    );
    expect(ch2?.downloadState).toBe('done');

    // 本地文件可经 /api/files 访问
    const fileRes = await app.inject({ method: 'GET', url: `/api/files/${libId}/${ch.id}/001.png` });
    expect(fileRes.statusCode).toBe(200);
    expect(fileRes.headers['content-type']).toBe('image/png');

    // 阅读页列表（已下载 → 本地模式）
    const pagesRes = await app.inject({ method: 'GET', url: `/api/chapters/${ch.id}/pages` });
    expect(pagesRes.statusCode).toBe(200);
    const pagesBody = pagesRes.json() as { mode: string; pages: string[] };
    expect(pagesBody.mode).toBe('local');
    expect(pagesBody.pages).toHaveLength(2);
    expect(pagesBody.pages[0]).toContain('/api/files/');
  });

  it('阅读进度保存与续读', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/library' });
    const libId = (list.json() as { id: string }[])[0]!.id;
    const detail = await app.inject({ method: 'GET', url: `/api/library/${libId}` });
    const ch = (detail.json() as { chapters: { id: string; chapterId: string }[] }).chapters.find(
      (c) => c.chapterId === 'c1',
    )!;

    // 未读计数：两章均未读
    const list2 = await app.inject({ method: 'GET', url: '/api/library' });
    expect((list2.json() as { unreadCount: number }[])[0]!.unreadCount).toBe(2);

    const put = await app.inject({
      method: 'PUT',
      url: `/api/reading-progress/${ch.id}`,
      payload: { pageIndex: 1 },
    });
    expect(put.statusCode).toBe(200);

    const cont = await app.inject({ method: 'GET', url: `/api/library/${libId}/continue` });
    const c = cont.json() as { chapterId: string; pageIndex: number };
    expect(c.chapterId).toBe(ch.id);
    expect(c.pageIndex).toBe(1);
  });

  it('删除章节文件并复位状态', async () => {
    const list = await app.inject({ method: 'GET', url: '/api/library' });
    const libId = (list.json() as { id: string }[])[0]!.id;
    const detail = await app.inject({ method: 'GET', url: `/api/library/${libId}` });
    const ch = (detail.json() as { chapters: { id: string; chapterId: string }[] }).chapters.find(
      (c) => c.chapterId === 'c1',
    )!;

    const del = await app.inject({ method: 'DELETE', url: `/api/chapters/${ch.id}` });
    expect(del.statusCode).toBe(200);

    const detail2 = await app.inject({ method: 'GET', url: `/api/library/${libId}` });
    const ch2 = (detail2.json() as { chapters: { id: string; downloadState: string; pageCount: number | null }[] }).chapters.find(
      (c) => c.id === ch.id,
    );
    expect(ch2?.downloadState).toBe('none');
    expect(ch2?.pageCount).toBeNull();
    await expect(fs.promises.readdir(path.join(cfg.storageDir, libId, ch.id))).rejects.toThrow();
  });

  it('删除书架条目（含本地文件）', async () => {
    const detail = await app.inject({ method: 'GET', url: '/api/library' });
    const items = detail.json() as { id: string }[];
    const libId = items[0]!.id;

    const del = await app.inject({ method: 'DELETE', url: `/api/library/${libId}` });
    expect(del.statusCode).toBe(200);

    const lib = await app.inject({ method: 'GET', url: '/api/library' });
    expect((lib.json() as unknown[]).length).toBe(0);
    await expect(fs.promises.readdir(path.join(cfg.storageDir, libId))).rejects.toThrow();
  });

  it('/api/info 返回服务信息', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/info' });
    expect(res.statusCode).toBe(200);
    const info = res.json() as { name: string; port: number; settings: { concurrency: number } };
    expect(info.name).toBe('MultManga');
    expect(info.settings.concurrency).toBeGreaterThan(0);
  });
});
