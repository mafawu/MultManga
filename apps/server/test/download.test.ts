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

// 1x1 有效 PNG（最小文件）
const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

/** 一页正常、一页 404 的源：验证“单页失败不中断 + 失败页记录” */
const failAdapter: MangaSourceAdapter = {
  id: 'fail-source',
  name: '失败源',
  version: '1.0.0',
  defaultBaseUrl: 'https://test.example.com',
  async search() {
    return [];
  },
  async getMangaDetail(mangaId) {
    return {
      mangaId,
      title: '测试漫画',
      chapters: [{ chapterId: 'c1', title: '第 1 话' }],
    };
  },
  async getPages() {
    return [
      { url: 'https://img.example.test/ok.png' },
      { url: 'https://missing.example.test/x.png' },
    ];
  },
};

/** 下载慢、尊重 AbortSignal 的源：验证取消能中断在途请求 */
const slowAdapter: MangaSourceAdapter = {
  id: 'slow-source',
  name: '慢速源',
  version: '1.0.0',
  defaultBaseUrl: 'https://test.example.com',
  async search() {
    return [];
  },
  async getMangaDetail(mangaId) {
    return {
      mangaId,
      title: '慢速漫画',
      chapters: [{ chapterId: 'c1', title: '第 1 话' }],
    };
  },
  async getPages() {
    return [
      { url: 'https://img.example.test/p1.png' },
      { url: 'https://img.example.test/p2.png' },
      { url: 'https://img.example.test/p3.png' },
    ];
  },
};

/** 3 章、每章 1 页的源：验证批量下载 */
const multiAdapter: MangaSourceAdapter = {
  id: 'multi-source',
  name: '批量源',
  version: '1.0.0',
  defaultBaseUrl: 'https://test.example.com',
  async search() {
    return [];
  },
  async getMangaDetail(mangaId) {
    return {
      mangaId,
      title: '批量漫画',
      chapters: [
        { chapterId: 'c1', title: '第 1 话' },
        { chapterId: 'c2', title: '第 2 话' },
        { chapterId: 'c3', title: '第 3 话' },
      ],
    };
  },
  async getPages() {
    return [{ url: 'https://img.example.test/p1.png' }];
  },
};

/** 4 页但内容相同的源：验证占位图（推广海报）检测 */
const placeholderAdapter: MangaSourceAdapter = {
  id: 'placeholder-source',
  name: '占位图源',
  version: '1.0.0',
  defaultBaseUrl: 'https://test.example.com',
  async search() {
    return [];
  },
  async getMangaDetail(mangaId) {
    return {
      mangaId,
      title: '占位漫画',
      chapters: [{ chapterId: 'c1', title: '第 1 话' }],
    };
  },
  async getPages() {
    return [
      { url: 'https://img.example.test/a1.png' },
      { url: 'https://img.example.test/a2.png' },
      { url: 'https://img.example.test/a3.png' },
      { url: 'https://img.example.test/a4.png' },
    ];
  },
};

describe('下载模块：并发 / 失败页记录 / 取消', () => {
  let tmpDir: string;
  let cfg: ReturnType<typeof makeConfig>;
  let db: Db;
  let app: ReturnType<typeof buildApp>;
  let queue: DownloadQueue;
  /** 批量下载用例的书架条目 id（供删除任务用例复用） */
  let batchLibId = '';

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function waitForJob(jobId: string, states: string[], timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await app.inject({ method: 'GET', url: '/api/downloads' });
      const jobs = res.json() as { id: string; state: string }[];
      const job = jobs.find((j) => j.id === jobId);
      if (job && states.includes(job.state)) return job;
      await sleep(50);
    }
    throw new Error(`等待任务状态 ${states.join('/')} 超时`);
  }

  /** 建源、加书架，返回 { libId, chapterId } */
  async function setupLibrary(adapterId: string) {
    const created = await app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: { adapterId, name: adapterId, baseUrl: 'https://test.example.com' },
    });
    const sourceId = (created.json() as { id: string }).id;
    const added = await app.inject({
      method: 'POST',
      url: '/api/library',
      payload: { sourceId, mangaId: 'm1' },
    });
    const item = added.json() as { id: string; chapters: { id: string }[] };
    return { libId: item.id, chapterId: item.chapters[0]!.id };
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multmanga-dl-test-'));
    cfg = makeConfig({ dataDir: tmpDir, storageDir: path.join(tmpDir, 'library'), dbPath: path.join(tmpDir, 'test.db') });
    db = openDb(cfg);
    registerAdapter(failAdapter);
    registerAdapter(slowAdapter);
    registerAdapter(multiAdapter);
    registerAdapter(placeholderAdapter);
    const bus = new EventBus();
    queue = new DownloadQueue(db, bus, cfg, log);
    queue.start();
    app = buildApp({ db, cfg, bus, queue, log });
  });

  afterAll(async () => {
    queue.stop();
    await app.close();
    db.close();
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('单页 404 不中断整章：任务 done、失败页落库、其余文件正常', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).startsWith('https://img.example.test/')) {
          return new Response(new Blob([PNG_BYTES]), { status: 200, headers: { 'content-type': 'image/png' } });
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const { libId, chapterId } = await setupLibrary('fail-source');
    await app.inject({ method: 'POST', url: `/api/library/${libId}/chapters/${chapterId}/download` });

    const downloads = await app.inject({ method: 'GET', url: '/api/downloads' });
    const jobs = downloads.json() as { id: string }[];
    const jobId = jobs.find((j) => true)!.id;

    const done = (await waitForJob(jobId, ['done', 'failed'])) as unknown as {
      state: string;
      error: string | null;
      failedPages: string | null;
    };
    expect(done.state).toBe('done');
    expect(done.error).toContain('1 页');

    const parsed = JSON.parse(done.failedPages ?? '[]') as { index: number; url: string; error: string }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.index).toBe(2);
    expect(parsed[0]?.url).toBe('https://missing.example.test/x.png');

    // 正常页已落盘，404 页无文件
    const detail = await app.inject({ method: 'GET', url: `/api/library/${libId}` });
    const ch = (detail.json() as { chapters: { id: string; chapterId: string }[] }).chapters.find((c) => c.chapterId === 'c1')!;
    const files = await fs.promises.readdir(path.join(cfg.storageDir, libId, ch.id));
    expect(files.sort()).toEqual(['001.png']);
    expect(files.some((f) => f.includes('002'))).toBe(false);

    vi.unstubAllGlobals();
  });

  it('取消任务：状态变 canceled，在途请求被 AbortSignal 中断', async () => {
    const capturedSignals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const signal = init?.signal;
        capturedSignals.push(signal);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(new Response(new Blob([PNG_BYTES]), { status: 200, headers: { 'content-type': 'image/png' } })),
            5000,
          );
          if (signal) {
            if (signal.aborted) {
              clearTimeout(timer);
              reject(new DOMException('aborted', 'AbortError'));
              return;
            }
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('aborted', 'AbortError'));
              },
              { once: true },
            );
          }
        });
      }),
    );

    const { libId, chapterId } = await setupLibrary('slow-source');
    await app.inject({ method: 'POST', url: `/api/library/${libId}/chapters/${chapterId}/download` });

    const downloads = await app.inject({ method: 'GET', url: '/api/downloads' });
    const jobId = (downloads.json() as { id: string }[])[0]!.id;

    // 等到任务真正开始下载（在途请求已发出）
    await waitForJob(jobId, ['running']);
    await sleep(200);
    expect(capturedSignals.length).toBeGreaterThan(0);

    const cancel = await app.inject({ method: 'POST', url: `/api/downloads/${jobId}/cancel` });
    expect(cancel.statusCode).toBe(200);

    const canceled = await waitForJob(jobId, ['canceled'], 5000);
    expect(canceled.state).toBe('canceled');

    // 在途请求收到的组合信号应已被 abort
    expect(capturedSignals.some((s) => s?.aborted)).toBe(true);

    vi.unstubAllGlobals();
  });

  it('设置项与任务接口暴露 pageConcurrency / failedPages', async () => {
    const s = await app.inject({ method: 'GET', url: '/api/settings' });
    const settings = s.json() as { pageConcurrency: number; concurrency: number };
    expect(settings.concurrency).toBeGreaterThan(0);
    expect(settings.pageConcurrency).toBeGreaterThan(0);
    expect(settings.pageConcurrency).toBeLessThanOrEqual(16);

    // 越界值被 API 校验拒绝（400）；合法值可正常保存
    const rejected = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { pageConcurrency: 99 },
    });
    expect(rejected.statusCode).toBe(400);

    const saved = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { pageConcurrency: 8 },
    });
    expect((saved.json() as { pageConcurrency: number }).pageConcurrency).toBe(8);

    // /api/downloads 每行带 failedPages 字段（前面用例已产生任务行）
    const d = await app.inject({ method: 'GET', url: '/api/downloads' });
    const rows = d.json() as ({ failedPages?: string | null } | undefined)[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    expect('failedPages' in rows[0]!).toBe(true);

    // camelCase 字段与页数明细（来自「单页 404」用例的 done 任务：共 2 页、成功 1 页）
    const full = d.json() as {
      chapterId: string;
      libraryId: string;
      mangaTitle: string;
      chapterTitle: string;
      pagesDone: number | null;
      pagesTotal: number | null;
      error: string | null;
    }[];
    const partial = full.find((j) => j.error?.includes('页下载失败'));
    expect(partial).toBeDefined();
    expect(partial!.chapterId).toBeTruthy();
    expect(partial!.libraryId).toBeTruthy();
    expect(partial!.mangaTitle).toBe('测试漫画');
    expect(partial!.chapterTitle).toBe('第 1 话');
    expect(partial!.pagesTotal).toBe(2);
    expect(partial!.pagesDone).toBe(1);
  });

  it('批量下载：/api/library/:id/download-all 加入全部未下载章节', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob([PNG_BYTES]), { status: 200, headers: { 'content-type': 'image/png' } })),
    );

    const created = await app.inject({
      method: 'POST',
      url: '/api/sources',
      payload: { adapterId: 'multi-source', name: 'multi', baseUrl: 'https://test.example.com' },
    });
    const sourceId = (created.json() as { id: string }).id;
    const added = await app.inject({ method: 'POST', url: '/api/library', payload: { sourceId, mangaId: 'm1' } });
    const item = added.json() as { id: string; chapters: { id: string }[] };
    expect(item.chapters).toHaveLength(3);
    batchLibId = item.id;

    const all = await app.inject({ method: 'POST', url: `/api/library/${item.id}/download-all` });
    expect(all.statusCode).toBe(200);
    expect((all.json() as { enqueued: number }).enqueued).toBe(3);

    const d = await app.inject({ method: 'GET', url: '/api/downloads' });
    const jobs = d.json() as {
      id: string;
      chapterId: string;
      libraryId: string;
      mangaTitle: string;
      chapterTitle: string;
      state: string;
    }[];
    const libJobs = jobs.filter((j) => j.libraryId === item.id);
    expect(libJobs).toHaveLength(3);
    expect(libJobs.every((j) => j.mangaTitle === '批量漫画')).toBe(true);
    expect(libJobs.every((j) => j.chapterTitle.startsWith('第'))).toBe(true);
    expect(libJobs.every((j) => j.chapterId)).toBe(true);

    for (const j of libJobs) {
      await waitForJob(j.id, ['done', 'failed']);
    }

    // 再次批量下载：全部已 done → 不再入队
    const again = await app.inject({ method: 'POST', url: `/api/library/${item.id}/download-all` });
    expect((again.json() as { enqueued: number }).enqueued).toBe(0);

    vi.unstubAllGlobals();
  });

  it('占位图检测：整章内容相同（推广海报）时拒绝保存并记入失败页', async () => {
    // 4 个 URL 全部返回同一张图 → 内容哈希相同 → 应被识别为占位图
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob([PNG_BYTES]), { status: 200, headers: { 'content-type': 'image/png' } })),
    );

    const { libId, chapterId } = await setupLibrary('placeholder-source');
    await app.inject({ method: 'POST', url: `/api/library/${libId}/chapters/${chapterId}/download` });

    const downloads = await app.inject({ method: 'GET', url: '/api/downloads' });
    const jobId = (downloads.json() as { id: string }[])[0]!.id;

    const done = (await waitForJob(jobId, ['done', 'failed'])) as unknown as {
      state: string;
      error: string | null;
      failedPages: string | null;
    };
    // 全部页均为占位图 → 章节判为 failed，错误信息明确
    expect(done.state).toBe('failed');
    expect(done.error).toContain('不可用');

    const parsed = JSON.parse(done.failedPages ?? '[]') as { index: number; url: string; error: string }[];
    expect(parsed).toHaveLength(4);
    expect(parsed.every((p) => p.error.includes('占位图'))).toBe(true);

    // 本地不应留下假图文件
    const detail = await app.inject({ method: 'GET', url: `/api/library/${libId}` });
    const ch = (detail.json() as { chapters: { id: string }[] }).chapters.find(() => true)!;
    const dir = path.join(cfg.storageDir, libId, ch.id);
    if (fs.existsSync(dir)) {
      const files = await fs.promises.readdir(dir);
      expect(files).toHaveLength(0);
    }

    vi.unstubAllGlobals();
  });

  it('删除下载任务：任务记录移除、本地文件删除、章节状态复位', async () => {
    const d = await app.inject({ method: 'GET', url: '/api/downloads' });
    const jobs = d.json() as { id: string; chapterId: string; libraryId: string; state: string }[];
    // 选批量下载用例（batchLibId）里已完成的任务，避免误删其他用例的任务
    const job = jobs.find((j) => j.state === 'done' && j.libraryId === batchLibId);
    expect(job).toBeDefined();
    if (!job) return;

    const del = await app.inject({ method: 'DELETE', url: `/api/downloads/${job.id}` });
    expect(del.statusCode).toBe(200);

    // 任务记录已删除
    const after = await app.inject({ method: 'GET', url: '/api/downloads' });
    const ids = (after.json() as { id: string }[]).map((j) => j.id);
    expect(ids.includes(job.id)).toBe(false);

    // 章节状态复位为 none，本地文件目录已删除
    const detail = await app.inject({ method: 'GET', url: `/api/library/${batchLibId}` });
    const ch = (detail.json() as { chapters: { id: string; downloadState: string }[] }).chapters.find(
      (c) => c.id === job.chapterId,
    );
    expect(ch?.downloadState).toBe('none');
    await expect(fs.promises.readdir(path.join(cfg.storageDir, batchLibId, job.chapterId))).rejects.toThrow();
  });
});
