import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db.js';
import type { Logger } from '@multmanga/core';
import { getAdapter } from '@multmanga/sources';
import { createSourceContext, getSourceById, type ChapterRow, type LibraryRow } from '../context.js';

export interface PagesRoutesDeps {
  db: Db;
  cfg: ServerConfig;
  log: Logger;
}

/**
 * 章节阅读页列表：
 * - 已下载 → 本地文件（/api/files/...）
 * - 未下载 → 经图片代理的在线地址（/api/proxy?url=...&sourceId=...）
 */
export function registerPagesRoutes(app: FastifyInstance, deps: PagesRoutesDeps): void {
  const { db, cfg, log } = deps;

  app.get('/api/chapters/:chapterId/pages', async (req, reply) => {
    const { chapterId } = req.params as { chapterId: string };
    const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(chapterId) as ChapterRow | undefined;
    if (!ch) return reply.code(404).send({ error: '章节不存在' });
    const lib = db.prepare('SELECT * FROM library WHERE id = ?').get(ch.library_id) as LibraryRow | undefined;
    if (!lib) return reply.code(404).send({ error: '书架条目不存在' });
    const src = getSourceById(db, lib.source_id);
    if (!src) return reply.code(404).send({ error: '源不存在' });

    // 已下载：直接列出本地文件
    if (ch.download_state === 'done' && ch.local_dir) {
      try {
        const files = (await fs.promises.readdir(ch.local_dir)).filter((f) => !f.endsWith('.tmp')).sort();
        if (files.length > 0) {
          return {
            mode: 'local' as const,
            pages: files.map(
              (f) => `/api/files/${encodeURIComponent(lib.id)}/${encodeURIComponent(ch.id)}/${encodeURIComponent(f)}`,
            ),
          };
        }
      } catch {
        // 目录不可读则回退在线模式
      }
    }

    const adapter = getAdapter(src.adapter_id);
    if (!adapter) return reply.code(400).send({ error: `适配器未注册: ${src.adapter_id}` });
    try {
      const ctx = createSourceContext(src, db, cfg, log);
      const pages = await adapter.getPages(ch.chapter_id, ctx);
      return {
        mode: 'online' as const,
        pages: pages.map((p) => {
          const q = new URLSearchParams({ url: p.url, sourceId: src.id });
          if (p.headers?.Referer) q.set('referer', p.headers.Referer);
          return `/api/proxy?${q}`;
        }),
      };
    } catch (e) {
      return reply.code(502).send({ error: `获取页列表失败: ${(e as Error).message}` });
    }
  });
}
