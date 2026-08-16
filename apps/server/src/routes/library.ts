import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db.js';
import type { EventBus } from '../events.js';
import type { Logger } from '@multmanga/core';
import {
  libraryAddSchema,
  type ChapterDownloadState,
  type DownloadJobState,
  type LibraryDetail,
  type LibraryItem,
} from '@multmanga/core';
import { getAdapter } from '@multmanga/sources';
import { createSourceContext, getSourceById, type LibraryRow } from '../context.js';
import { effectiveStorageDir } from '../settings.js';
import { rmrf } from '../download/storage.js';

export interface LibraryRoutesDeps {
  db: Db;
  cfg: ServerConfig;
  bus: EventBus;
  log: Logger;
}

interface LibraryListRow extends LibraryRow {
  source_name: string;
  adapter_id: string;
  downloaded_count: number;
  chapter_count: number;
  unread_count: number;
  last_read_at: string | null;
}

const LIST_SQL = `
  SELECT l.*, s.name AS source_name, s.adapter_id,
    (SELECT COUNT(*) FROM chapters c WHERE c.library_id = l.id AND c.download_state = 'done') AS downloaded_count,
    (SELECT COUNT(*) FROM chapters c WHERE c.library_id = l.id) AS chapter_count,
    (SELECT COUNT(*) FROM chapters c LEFT JOIN reading_progress rp ON rp.chapter_id = c.id
       WHERE c.library_id = l.id AND (rp.page_index IS NULL OR c.page_count IS NULL OR rp.page_index < c.page_count - 1)) AS unread_count,
    (SELECT MAX(rp.updated_at) FROM reading_progress rp JOIN chapters c ON c.id = rp.chapter_id
       WHERE c.library_id = l.id) AS last_read_at
  FROM library l JOIN sources s ON s.id = l.source_id
`;

export function registerLibraryRoutes(app: FastifyInstance, deps: LibraryRoutesDeps): void {
  const { db, cfg, bus, log } = deps;

  app.get('/api/library', async () => {
    const rows = db.prepare(`${LIST_SQL} ORDER BY l.updated_at DESC`).all() as unknown as LibraryListRow[];
    return rows.map(toLibraryItem);
  });

  app.post('/api/library', async (req, reply) => {
    const input = libraryAddSchema.parse(req.body);
    const row = getSourceById(db, input.sourceId);
    if (!row) return reply.code(404).send({ error: '源不存在' });
    const adapter = getAdapter(row.adapter_id);
    if (!adapter) return reply.code(400).send({ error: `适配器未注册: ${row.adapter_id}` });

    let detail;
    try {
      const ctx = createSourceContext(row, db, cfg, log);
      detail = await adapter.getMangaDetail(input.mangaId, ctx);
    } catch (e) {
      return reply.code(502).send({ error: `获取详情失败: ${(e as Error).message}` });
    }

    const now = new Date().toISOString();
    const libId = randomUUID();
    db.prepare(
      `INSERT INTO library (id, source_id, manga_id, title, author, description, cover_url, status, updated_at, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, manga_id) DO UPDATE SET
         title = excluded.title, author = excluded.author, description = excluded.description,
         cover_url = excluded.cover_url, status = excluded.status, updated_at = excluded.updated_at`,
    ).run(
      libId,
      row.id,
      detail.mangaId,
      detail.title,
      detail.author ?? null,
      detail.description ?? null,
      detail.coverUrl ?? null,
      detail.status ?? null,
      now,
      now,
    );
    const existing = db
      .prepare('SELECT id FROM library WHERE source_id = ? AND manga_id = ?')
      .get(row.id, detail.mangaId) as { id: string };
    const finalId = existing?.id ?? libId;

    const insChapter = db.prepare(
      `INSERT INTO chapters (id, library_id, chapter_id, title, chapter_number, chapter_order, download_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'none', ?)
       ON CONFLICT(library_id, chapter_id) DO UPDATE SET
         title = excluded.title, chapter_number = excluded.chapter_number, chapter_order = excluded.chapter_order`,
    );
    detail.chapters.forEach((c, i) => {
      insChapter.run(randomUUID(), finalId, c.chapterId, c.title, c.chapterNumber ?? null, i, now);
    });

    bus.emit('library.changed', { id: finalId });
    return getLibraryDetail(db, finalId);
  });

  app.post('/api/library/:id/refresh', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lib = db.prepare('SELECT * FROM library WHERE id = ?').get(id) as LibraryRow | undefined;
    if (!lib) return reply.code(404).send({ error: '书架条目不存在' });
    const src = getSourceById(db, lib.source_id);
    const adapter = src ? getAdapter(src.adapter_id) : undefined;
    if (!src || !adapter) return reply.code(400).send({ error: '源或适配器不可用' });
    let detail;
    try {
      const ctx = createSourceContext(src, db, cfg, log);
      detail = await adapter.getMangaDetail(lib.manga_id, ctx);
    } catch (e) {
      return reply.code(502).send({ error: `刷新失败: ${(e as Error).message}` });
    }
    const now = new Date().toISOString();
    db.prepare(
      'UPDATE library SET title = ?, author = ?, description = ?, cover_url = ?, status = ?, updated_at = ? WHERE id = ?',
    ).run(
      detail.title,
      detail.author ?? null,
      detail.description ?? null,
      detail.coverUrl ?? null,
      detail.status ?? null,
      now,
      id,
    );
    const insChapter = db.prepare(
      `INSERT INTO chapters (id, library_id, chapter_id, title, chapter_number, chapter_order, download_state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'none', ?)
       ON CONFLICT(library_id, chapter_id) DO UPDATE SET
         title = excluded.title, chapter_number = excluded.chapter_number, chapter_order = excluded.chapter_order`,
    );
    detail.chapters.forEach((c, i) => {
      insChapter.run(randomUUID(), id, c.chapterId, c.title, c.chapterNumber ?? null, i, now);
    });
    bus.emit('library.changed', { id });
    return getLibraryDetail(db, id);
  });

  app.get('/api/library/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = getLibraryDetail(db, id);
    if (!item) return reply.code(404).send({ error: '书架条目不存在' });
    return item;
  });

  app.delete('/api/library/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const lib = db.prepare('SELECT * FROM library WHERE id = ?').get(id) as LibraryRow | undefined;
    if (!lib) return reply.code(404).send({ error: '书架条目不存在' });
    const q = req.query as { deleteFiles?: string };
    if (q.deleteFiles !== 'false') {
      await rmrf(effectiveStorageDir(db, cfg), id);
    }
    db.prepare('DELETE FROM library WHERE id = ?').run(id);
    bus.emit('library.changed', { id });
    return { ok: true };
  });
}

function toLibraryItem(row: LibraryListRow): LibraryItem {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    adapterId: row.adapter_id,
    mangaId: row.manga_id,
    title: row.title,
    author: row.author,
    description: row.description,
    coverUrl: row.cover_url,
    status: row.status,
    updatedAt: row.updated_at,
    addedAt: row.added_at,
    downloadedCount: row.downloaded_count,
    chapterCount: row.chapter_count,
    unreadCount: row.unread_count,
    lastReadAt: row.last_read_at,
  };
}

function getLibraryDetail(db: Db, id: string): LibraryDetail | undefined {
  const row = db
    .prepare(`${LIST_SQL} WHERE l.id = ?`)
    .get(id) as unknown as LibraryListRow | undefined;
  if (!row) return undefined;
  const chapters = db
    .prepare(
      `SELECT c.*, rp.page_index, j.state AS job_state
       FROM chapters c
       LEFT JOIN reading_progress rp ON rp.chapter_id = c.id
       LEFT JOIN download_jobs j ON j.chapter_id = c.id
       WHERE c.library_id = ?
       ORDER BY c.chapter_order IS NULL ASC, c.chapter_order ASC,
                c.chapter_number IS NULL ASC, c.chapter_number ASC, c.created_at ASC`,
    )
    .all(id) as unknown as ChapterViewRow[];
  return {
    ...toLibraryItem(row),
    chapters: chapters.map((c) => ({
      id: c.id,
      libraryId: c.library_id,
      chapterId: c.chapter_id,
      title: c.title,
      chapterNumber: c.chapter_number,
      chapterOrder: c.chapter_order,
      downloadState: c.download_state as ChapterDownloadState,
      localDir: c.local_dir,
      pageCount: c.page_count,
      createdAt: c.created_at,
      pageIndex: c.page_index ?? null,
      jobState: c.job_state as DownloadJobState | null,
    })),
  };
}

interface ChapterViewRow {
  id: string;
  library_id: string;
  chapter_id: string;
  title: string;
  chapter_number: number | null;
  chapter_order: number | null;
  download_state: string;
  local_dir: string | null;
  page_count: number | null;
  created_at: string;
  page_index: number | null;
  job_state: string | null;
}
