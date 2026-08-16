import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { progressSchema } from '@multmanga/core';
import type { ChapterRow } from '../context.js';

export interface ProgressRoutesDeps {
  db: Db;
}

export function registerProgressRoutes(app: FastifyInstance, deps: ProgressRoutesDeps): void {
  const { db } = deps;

  app.put('/api/reading-progress/:chapterId', async (req, reply) => {
    const { chapterId } = req.params as { chapterId: string };
    const input = progressSchema.parse(req.body);
    const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as ChapterRow | undefined;
    if (!ch) return reply.code(404).send({ error: '章节不存在' });
    db.prepare(
      `INSERT INTO reading_progress (chapter_id, page_index, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(chapter_id) DO UPDATE SET page_index = excluded.page_index, updated_at = excluded.updated_at`,
    ).run(chapterId, input.pageIndex, new Date().toISOString());
    return { ok: true };
  });

  app.get('/api/library/:id/continue', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = db
      .prepare(
        `SELECT c.id AS chapterId, c.title, rp.page_index AS pageIndex, c.page_count AS pageCount
         FROM reading_progress rp JOIN chapters c ON c.id = rp.chapter_id
         WHERE c.library_id = ? ORDER BY rp.updated_at DESC LIMIT 1`,
      )
      .get(id);
    return row ?? null;
  });
}
