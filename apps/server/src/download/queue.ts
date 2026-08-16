import { randomUUID } from 'node:crypto';
import type { Db } from '../db.js';
import type { ServerConfig } from '../config.js';
import type { EventBus, EventType } from '../events.js';
import type { Logger } from '@multmanga/core';
import { nowIso } from '@multmanga/core';
import { getSettings } from '../settings.js';
import { abortJob } from './cancel.js';
import { Worker } from './worker.js';
import type { JobRow } from '../context.js';

/**
 * 下载队列：任务持久化在 download_jobs，worker 池轮询领取。
 * - 启动时把遗留 running 任务复位为 queued（崩溃恢复）
 * - enqueue 幂等（每章一个任务）
 * - 控制：pause / resume / cancel / retry
 */
export class DownloadQueue {
  private workers: Worker[] = [];
  private started = false;

  constructor(
    private db: Db,
    private bus: EventBus,
    private cfg: ServerConfig,
    private log: Logger,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.db.prepare("UPDATE download_jobs SET state = 'queued', updated_at = ? WHERE state = 'running'").run(nowIso());
    const n = Math.max(1, getSettings(this.db).concurrency || 3);
    for (let i = 0; i < n; i++) {
      const w = new Worker(this.db, this.bus, this.cfg, this.log);
      this.workers.push(w);
      void w.run();
    }
    this.log.info(`下载队列已启动，worker 数=${n}`);
  }

  stop(): void {
    this.started = false;
    for (const w of this.workers) w.stop();
    this.workers = [];
  }

  enqueue(chapterId: string): void {
    const existing = this.db
      .prepare('SELECT id FROM download_jobs WHERE chapter_id = ?')
      .get(chapterId) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare(
          "UPDATE download_jobs SET state = 'queued', progress = 0, error = NULL, failed_pages = NULL, updated_at = ? WHERE id = ?",
        )
        .run(nowIso(), existing.id);
    } else {
      this.db
        .prepare(
          'INSERT INTO download_jobs (id, chapter_id, state, progress, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
        )
        .run(randomUUID(), chapterId, 'queued', nowIso(), nowIso());
    }
    this.db.prepare("UPDATE chapters SET download_state = 'queued' WHERE id = ?").run(chapterId);
    this.bus.emit('download.queued', { chapterId });
  }

  pause(jobId: string): void {
    this.setJobState(jobId, 'paused', 'download.paused');
  }

  resume(jobId: string): void {
    this.setJobState(jobId, 'queued', 'download.resumed');
  }

  cancel(jobId: string): void {
    this.setJobState(jobId, 'canceled', 'download.canceled');
    // 中断 worker 中该任务的在途请求（无在途任务时为 no-op）
    abortJob(jobId);
  }

  retry(jobId: string): void {
    const job = this.db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId) as JobRow | undefined;
    if (!job) return;
    this.db
      .prepare(
        "UPDATE download_jobs SET state = 'queued', progress = 0, error = NULL, failed_pages = NULL, updated_at = ? WHERE id = ?",
      )
      .run(nowIso(), jobId);
    this.db.prepare("UPDATE chapters SET download_state = 'queued' WHERE id = ?").run(job.chapter_id);
    this.bus.emit('download.queued', { chapterId: job.chapter_id });
  }

  /** 删除章节时取消其活跃任务 */
  cancelForChapter(chapterId: string): void {
    const job = this.db
      .prepare('SELECT id FROM download_jobs WHERE chapter_id = ?')
      .get(chapterId) as { id: string } | undefined;
    if (job) this.cancel(job.id);
  }

  private setJobState(jobId: string, state: string, event: EventType): void {
    const job = this.db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId) as JobRow | undefined;
    if (!job) return;
    this.db.prepare('UPDATE download_jobs SET state = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), jobId);
    if (state === 'canceled') {
      this.db.prepare("UPDATE chapters SET download_state = 'none' WHERE id = ?").run(job.chapter_id);
    }
    this.bus.emit(event, { jobId, chapterId: job.chapter_id });
  }
}
