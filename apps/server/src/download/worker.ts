import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Db } from '../db.js';
import type { ServerConfig } from '../config.js';
import type { EventBus } from '../events.js';
import type {
  FailedPageRecord,
  Logger,
  MangaSourceAdapter,
  Page,
  SourceContext,
} from '@multmanga/core';
import { MAX_PAGE_CONCURRENCY, extFromUrl, nowIso, sleep } from '@multmanga/core';
import { getAdapter, HttpError } from '@multmanga/sources';
import {
  createSourceContext,
  getSourceById,
  type ChapterRow,
  type JobRow,
  type LibraryRow,
} from '../context.js';
import { effectiveStorageDir, getSettings } from '../settings.js';
import { getJobAbortSignal, releaseJobAbort } from './cancel.js';
import { downloadLog, initDownloadLog } from './log.js';
import { chapterDir, packCbz, writePageAtomically } from './storage.js';

/** 单任务 worker：循环领取 queued 任务并处理 */
export class Worker {
  private stopped = false;

  constructor(
    private db: Db,
    private bus: EventBus,
    private cfg: ServerConfig,
    private log: Logger,
  ) {
    initDownloadLog(cfg.dataDir);
  }

  stop(): void {
    this.stopped = true;
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      const job = this.claimNext();
      if (!job) {
        await sleep(1000);
        continue;
      }
      await this.process(job);
    }
  }

  private claimNext(): JobRow | null {
    const row = this.db
      .prepare("SELECT id FROM download_jobs WHERE state = 'queued' ORDER BY created_at ASC LIMIT 1")
      .get() as { id: string } | undefined;
    if (!row) return null;
    const res = this.db
      .prepare("UPDATE download_jobs SET state = 'running', updated_at = ? WHERE id = ? AND state = 'queued'")
      .run(nowIso(), row.id);
    if (res.changes === 0) return null;
    const job = this.db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(row.id) as unknown as JobRow;
    this.db.prepare("UPDATE chapters SET download_state = 'downloading' WHERE id = ?").run(job.chapter_id);
    return job;
  }

  private async process(job: JobRow): Promise<void> {
    const { db, bus, cfg, log } = this;
    const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(job.chapter_id) as ChapterRow | undefined;
    if (!ch) return this.fail(job, '章节不存在');
    const lib = db.prepare('SELECT * FROM library WHERE id = ?').get(ch.library_id) as LibraryRow | undefined;
    if (!lib) return this.fail(job, '书架条目不存在');
    const src = getSourceById(db, lib.source_id);
    const adapter = src ? getAdapter(src.adapter_id) : undefined;
    if (!src || !adapter) return this.fail(job, '源或适配器不可用');

    const jobStart = Date.now();
    const base = { jobId: job.id, chapterId: ch.id, libraryId: lib.id, manga: lib.title, chapter: ch.title };
    downloadLog({ ...base, ev: 'job_start', source: src.adapter_id });

    const cancelSignal = getJobAbortSignal(job.id);
    const ctx = createSourceContext(src, db, cfg, log);
    const storageDir = effectiveStorageDir(db, cfg);
    const dir = chapterDir(storageDir, lib.id, ch.id);

    try {
      // 阶段 1：获取页列表
      this.emitProgress(job, ch, lib, { progress: 0, phase: 'fetching_pages' });
      let pages: Page[];
      try {
        pages = await adapter.getPages(ch.chapter_id, ctx);
      } catch (e) {
        downloadLog({ ...base, ev: 'pages_fetch_fail', error: (e as Error).message });
        return this.fail(job, `获取页列表失败: ${(e as Error).message}`);
      }
      if (pages.length === 0) {
        downloadLog({ ...base, ev: 'pages_fetch_fail', error: '章节无图片' });
        return this.fail(job, '章节无图片');
      }
      if (cancelSignal.aborted || this.jobState(job.id) !== 'running') {
        downloadLog({ ...base, ev: 'job_aborted_before_download', reason: 'paused/canceled' });
        return;
      }
      downloadLog({ ...base, ev: 'pages_fetch_ok', pages: pages.length });

      db.prepare('UPDATE chapters SET page_count = ? WHERE id = ?').run(pages.length, ch.id);
      db.prepare('UPDATE download_jobs SET pages_total = ? WHERE id = ?').run(pages.length, job.id);
      await fs.promises.mkdir(dir, { recursive: true });

      // 阶段 2：并发下载页面（单页失败不中断，记录到 failed_pages）
      const failed = await this.downloadPages(ctx, adapter, job, pages, dir, cancelSignal, base);
      if (cancelSignal.aborted || this.jobState(job.id) !== 'running') {
        downloadLog({ ...base, ev: 'job_aborted', phase: 'after_download', ms: Date.now() - jobStart });
        return; // 已暂停/取消：不回写完成状态
      }

      // 全部页面均为占位图（源站数据损坏，如已下架章节返回 APP 推广海报）→ 直接判失败，
      // 而不是“已下载但有失败页”，避免用户得到一整章假图或困惑的“部分成功”状态。
      if (failed.length >= pages.length) {
        const errMsg = `源站该章节图片不可用（${failed.length} 页全部为占位图/推广图，疑似已下架）`;
        db.prepare(
          "UPDATE download_jobs SET state = 'failed', error = ?, failed_pages = ?, pages_done = 0, updated_at = ? WHERE id = ?",
        ).run(errMsg, JSON.stringify(failed), nowIso(), job.id);
        db.prepare("UPDATE chapters SET download_state = 'failed' WHERE id = ?").run(ch.id);
        bus.emit('download.failed', {
          jobId: job.id,
          chapterId: ch.id,
          libraryId: lib.id,
          error: errMsg,
        });
        downloadLog({ ...base, ev: 'job_failed_all_placeholder', pages: failed.length, ms: Date.now() - jobStart });
        return;
      }

      // 阶段 3：CBZ 打包
      if (getCbzFlag(db)) {
        this.emitProgress(job, ch, lib, { progress: 100, phase: 'packing' });
        try {
          await packCbz(dir, path.join(path.dirname(dir), `${ch.id}.cbz`));
        } catch (e) {
          log.warn('CBZ 打包失败（不影响图片下载）:', (e as Error).message);
        }
      }

      db.prepare("UPDATE chapters SET download_state = 'done', local_dir = ? WHERE id = ?").run(dir, ch.id);
      if (failed.length > 0) {
        const errMsg = `${failed.length} 页下载失败（已跳过，重试可补下）`;
        db.prepare(
          "UPDATE download_jobs SET state = 'done', progress = 100, error = ?, failed_pages = ?, pages_done = ?, updated_at = ? WHERE id = ?",
        ).run(errMsg, JSON.stringify(failed), pages.length - failed.length, nowIso(), job.id);
        bus.emit('download.done', {
          jobId: job.id,
          chapterId: ch.id,
          libraryId: lib.id,
          failedPages: failed.length,
        });
        downloadLog({
          ...base,
          ev: 'job_done_partial',
          okPages: pages.length - failed.length,
          failedPages: failed.length,
          ms: Date.now() - jobStart,
        });
      } else {
        db.prepare(
          "UPDATE download_jobs SET state = 'done', progress = 100, error = NULL, failed_pages = NULL, pages_done = ?, updated_at = ? WHERE id = ?",
        ).run(pages.length, nowIso(), job.id);
        bus.emit('download.done', { jobId: job.id, chapterId: ch.id, libraryId: lib.id });
        downloadLog({ ...base, ev: 'job_done', okPages: pages.length, ms: Date.now() - jobStart });
      }
    } finally {
      releaseJobAbort(job.id);
    }
  }

  /**
   * 章内页级并发下载（有界并发，默认 5）。
   * - 已存在文件跳过（断点续传，重试只补缺页）
   * - 单页失败不中断整章：404 直接跳过；其余错误任务层重试一次，仍失败记入失败清单
   * - 进度按完成页数计算，仅百分比变化时上报（节流）
   */
  private async downloadPages(
    ctx: SourceContext,
    adapter: MangaSourceAdapter,
    job: JobRow,
    pages: Page[],
    dir: string,
    cancelSignal: AbortSignal,
    base: Record<string, unknown>,
  ): Promise<FailedPageRecord[]> {
    const { db, bus, log } = this;
    const concurrency = Math.min(MAX_PAGE_CONCURRENCY, Math.max(1, getSettings(db).pageConcurrency));
    const failed: FailedPageRecord[] = [];
    /** 本章已下载图片的内容哈希分组（用于识别源站返回的重复占位图） */
    const hashGroups = new Map<string, { pageNo: number; target: string; url: string }[]>();
    const total = pages.length;
    let next = 0;
    let done = 0;
    let lastPct = -1;

    const report = (page: number, pct: number): void => {
      if (pct === lastPct) return;
      lastPct = pct;
      db.prepare('UPDATE download_jobs SET progress = ?, pages_done = ?, updated_at = ? WHERE id = ?').run(
        pct,
        page,
        nowIso(),
        job.id,
      );
      bus.emit('download.progress', {
        jobId: job.id,
        chapterId: job.chapter_id,
        page,
        total,
        progress: pct,
        phase: 'downloading',
      });
    };

    const recordFail = (index: number, url: string, error: string): void => {
      failed.push({ index, url, error });
      downloadLog({
        ...base,
        ev: 'page_fail',
        page: index,
        url,
        error,
        errorType: classifyError(error),
        retried: true,
      });
    };

    /** 记录一页下载成功的内容哈希（供占位图去重检测） */
    const trackHash = (pageNo: number, target: string, url: string, buf: Uint8Array): void => {
      const md5 = createHash('md5').update(buf).digest('hex');
      const group = hashGroups.get(md5);
      if (group) group.push({ pageNo, target, url });
      else hashGroups.set(md5, [{ pageNo, target, url }]);
    };

    const downloadOne = async (idx: number): Promise<boolean> => {
      const page = pages[idx]!;
      const pageNo = idx + 1;
      const target = path.join(dir, `${String(pageNo).padStart(3, '0')}${extFromUrl(page.url)}`);
      if (fs.existsSync(target)) {
        downloadLog({ ...base, ev: 'page_skip_existing', page: pageNo, url: page.url });
        return true; // 已存在 → 跳过
      }
      const headers = adapter.getImageHeaders?.(page.url, ctx);
      const pageStart = Date.now();
      try {
        const buf = await this.downloadPage(ctx, headers, page, target, cancelSignal);
        trackHash(pageNo, target, page.url, buf);
        downloadLog({ ...base, ev: 'page_ok', page: pageNo, url: page.url, ms: Date.now() - pageStart });
        return true;
      } catch (e) {
        if (cancelSignal.aborted) return false; // 取消中断：不计入完成数
        const first = e as Error;
        const notFound = first instanceof HttpError && first.status === 404;
        if (!notFound) {
          // 网络/5xx/超时：任务层重试一次
          downloadLog({
            ...base,
            ev: 'page_retry',
            page: pageNo,
            url: page.url,
            error: first.message,
            errorType: classifyError(first.message),
            ms: Date.now() - pageStart,
          });
          try {
            await sleep(500);
            const buf = await this.downloadPage(ctx, headers, page, target, cancelSignal);
            trackHash(pageNo, target, page.url, buf);
            downloadLog({ ...base, ev: 'page_ok_after_retry', page: pageNo, url: page.url, ms: Date.now() - pageStart });
            return true;
          } catch (e2) {
            if (cancelSignal.aborted) return false;
            recordFail(pageNo, page.url, (e2 as Error).message);
            log.warn(`第 ${pageNo} 页下载失败（重试后）: ${page.url}: ${(e2 as Error).message}`);
            return true;
          }
        }
        recordFail(pageNo, page.url, first.message);
        log.warn(`第 ${pageNo} 页资源不存在（404），跳过: ${page.url}`);
        return true;
      }
    };

    const worker = async (): Promise<void> => {
      while (true) {
        if (cancelSignal.aborted) return;
        if (this.jobState(job.id) !== 'running') return; // paused/canceled：不再领取新页
        const idx = next++;
        if (idx >= total) return;
        const ok = await downloadOne(idx);
        if (!ok) return; // 下载被取消中断
        done++;
        report(done, Math.round((done / total) * 100));
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

    // 占位图检测：同一内容哈希出现在 ≥3 页且占本章一半以上 → 源站返回的重复占位图（如
    // 包子漫画对失效/下架图片返回的 APP 推广海报）。删除这些假页并记入失败清单。
    const placeholderThreshold = Math.max(3, Math.ceil(total / 2));
    for (const group of hashGroups.values()) {
      if (group.length < placeholderThreshold) continue;
      for (const { pageNo, target, url } of group) {
        try {
          await fs.promises.rm(target, { force: true });
        } catch {
          /* 删除失败不影响判定 */
        }
        recordFail(pageNo, url, `疑似源站占位图（与本章 ${group.length} 页内容相同，已拒绝保存）`);
        log.warn(`第 ${pageNo} 页疑似占位图（重复 ${group.length} 次），已删除: ${url}`);
      }
    }

    return failed;
  }

  private jobState(jobId: string): string {
    const row = this.db.prepare('SELECT state FROM download_jobs WHERE id = ?').get(jobId) as { state: string };
    return row?.state ?? 'gone';
  }

  private emitProgress(
    job: JobRow,
    ch: ChapterRow,
    lib: LibraryRow,
    data: { progress: number; phase: 'fetching_pages' | 'downloading' | 'packing' },
  ): void {
    this.db.prepare('UPDATE download_jobs SET progress = ?, updated_at = ? WHERE id = ?').run(data.progress, nowIso(), job.id);
    this.bus.emit('download.progress', {
      jobId: job.id,
      chapterId: ch.id,
      libraryId: lib.id,
      progress: data.progress,
      phase: data.phase,
    });
  }

  private async downloadPage(
    ctx: SourceContext,
    imageHeaders: Record<string, string> | undefined,
    page: Page,
    target: string,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    // https 挂起时会在默认超时后回退 http，故图片下载保持默认超时；
    // signal 用于任务取消时中断在途请求
    const buf = await ctx.http.getBuffer(
      page.url,
      { ...(imageHeaders ?? {}), ...(page.headers ?? {}) },
      undefined,
      signal,
    );
    await writePageAtomically(target, buf);
    return buf;
  }

  private fail(job: JobRow, message: string): void {
    this.db
      .prepare("UPDATE download_jobs SET state = 'failed', error = ?, updated_at = ? WHERE id = ?")
      .run(message, nowIso(), job.id);
    this.db.prepare("UPDATE chapters SET download_state = 'failed' WHERE id = ?").run(job.chapter_id);
    const ch = this.db.prepare('SELECT library_id FROM chapters WHERE id = ?').get(job.chapter_id) as
      | { library_id: string }
      | undefined;
    downloadLog({
      jobId: job.id,
      chapterId: job.chapter_id,
      libraryId: ch?.library_id,
      ev: 'job_failed',
      error: message,
    });
    this.bus.emit('download.failed', {
      jobId: job.id,
      chapterId: job.chapter_id,
      libraryId: ch?.library_id,
      error: message,
    });
  }
}

/** 按错误信息粗略分类，便于日志聚合统计 */
function classifyError(message: string): string {
  if (/404|Not Found|资源不存在/i.test(message)) return 'not_found';
  if (/timeout|TimedOut|ETIMEDOUT/i.test(message)) return 'timeout';
  if (/fetch failed|ECONN|EPIPE|ENOTFOUND|EPROTO|CERT_|self.signed|UNABLE_TO_VERIFY/i.test(message)) return 'network';
  if (/(^|\s)\d{3}\s/.test(message)) return 'http';
  return 'other';
}

function getCbzFlag(db: Db): boolean {
  return getSettings(db).cbz;
}
