import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db.js';
import type { EventBus } from '../events.js';
import type { DownloadJobView } from '@multmanga/core';
import { effectiveStorageDir } from '../settings.js';
import { rmrfChapter } from '../download/storage.js';
import type { DownloadQueue } from '../download/queue.js';
import type { ChapterRow } from '../context.js';

export interface DownloadsRoutesDeps {
  db: Db;
  cfg: ServerConfig;
  bus: EventBus;
  queue: DownloadQueue;
}

export function registerDownloadsRoutes(app: FastifyInstance, deps: DownloadsRoutesDeps): void {
  const { db, cfg, bus, queue } = deps;

  app.post('/api/library/:id/chapters/:chapterId/download', async (req, reply) => {
    const { id, chapterId } = req.params as { id: string; chapterId: string };
    const ch = db
      .prepare('SELECT * FROM chapters WHERE id = ? AND library_id = ?')
      .get(chapterId, id) as ChapterRow | undefined;
    if (!ch) return reply.code(404).send({ error: '章节不存在' });
    queue.enqueue(chapterId);
    return { ok: true };
  });

  /** 批量下载：把该书架条目下所有未完成的章节加入队列（已下载的跳过，失败的重新入队=补下） */
  app.post('/api/library/:id/download-all', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lib = db.prepare('SELECT id FROM library WHERE id = ?').get(id) as { id: string } | undefined;
    if (!lib) return reply.code(404).send({ error: '书架条目不存在' });
    const rows = db
      .prepare("SELECT id FROM chapters WHERE library_id = ? AND download_state != 'done' ORDER BY created_at ASC")
      .all(id) as { id: string }[];
    for (const r of rows) queue.enqueue(r.id);
    return { ok: true, enqueued: rows.length };
  });

  app.get('/api/downloads', async () => {
    const rows = db
      .prepare(
        `SELECT j.id, j.chapter_id AS chapterId, j.state, j.progress, j.error,
                j.failed_pages AS failedPages, j.pages_done AS pagesDone, j.pages_total AS pagesTotal,
                j.created_at AS createdAt, j.updated_at AS updatedAt,
                c.title AS chapterTitle, c.chapter_number AS chapterNumber,
                l.id AS libraryId, l.title AS mangaTitle, s.name AS sourceName
         FROM download_jobs j
         JOIN chapters c ON c.id = j.chapter_id
         JOIN library l ON l.id = c.library_id
         JOIN sources s ON s.id = l.source_id
         ORDER BY j.updated_at DESC LIMIT 200`,
      )
      .all() as unknown as DownloadJobView[];
    return rows;
  });

  app.post('/api/downloads/:jobId/:action', async (req, reply) => {
    const { jobId, action } = req.params as { jobId: string; action: string };
    const job = db.prepare('SELECT id FROM download_jobs WHERE id = ?').get(jobId) as { id: string } | undefined;
    if (!job) return reply.code(404).send({ error: '任务不存在' });
    switch (action) {
      case 'pause':
        queue.pause(jobId);
        break;
      case 'resume':
        queue.resume(jobId);
        break;
      case 'cancel':
        queue.cancel(jobId);
        break;
      case 'retry':
        queue.retry(jobId);
        break;
      default:
        return reply.code(400).send({ error: `未知操作: ${action}` });
    }
    return { ok: true };
  });

  /** 删除下载任务：取消在途任务 → 删除本地文件 → 删除任务记录 → 复位章节状态 */
  app.delete('/api/downloads/:jobId', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    const job = db.prepare('SELECT * FROM download_jobs WHERE id = ?').get(jobId) as
      | { id: string; chapter_id: string }
      | undefined;
    if (!job) return reply.code(404).send({ error: '任务不存在' });
    const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(job.chapter_id) as ChapterRow | undefined;
    queue.cancelForChapter(job.chapter_id);
    if (ch) {
      await rmrfChapter(effectiveStorageDir(db, cfg), ch.library_id, ch.id);
      db.prepare('UPDATE chapters SET download_state = ?, local_dir = NULL, page_count = NULL WHERE id = ?').run(
        'none',
        ch.id,
      );
    }
    db.prepare('DELETE FROM download_jobs WHERE id = ?').run(jobId);
    if (ch) bus.emit('library.changed', { id: ch.library_id });
    return { ok: true };
  });

  app.delete('/api/chapters/:chapterId', async (req, reply) => {
    const { chapterId } = req.params as { chapterId: string };
    const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as ChapterRow | undefined;
    if (!ch) return reply.code(404).send({ error: '章节不存在' });
    queue.cancelForChapter(chapterId);
    await rmrfChapter(effectiveStorageDir(db, cfg), ch.library_id, chapterId);
    db.prepare('DELETE FROM reading_progress WHERE chapter_id = ?').run(chapterId);
    db.prepare('UPDATE chapters SET download_state = ?, local_dir = NULL, page_count = NULL WHERE id = ?').run(
      'none',
      chapterId,
    );
    bus.emit('library.changed', { id: ch.library_id });
    return { ok: true };
  });
}
