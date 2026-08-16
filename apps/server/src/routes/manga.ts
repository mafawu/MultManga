import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db.js';
import type { Logger } from '@multmanga/core';
import { getAdapter } from '@multmanga/sources';
import { createSourceContext, getSourceById } from '../context.js';

export interface MangaRoutesDeps {
  db: Db;
  cfg: ServerConfig;
  log: Logger;
}

export function registerMangaRoutes(app: FastifyInstance, deps: MangaRoutesDeps): void {
  const { db, cfg, log } = deps;

  app.get('/api/manga/:sourceId/:mangaId', async (req, reply) => {
    const { sourceId, mangaId } = req.params as { sourceId: string; mangaId: string };
    const row = getSourceById(db, sourceId);
    if (!row) return reply.code(404).send({ error: '源不存在' });
    const adapter = getAdapter(row.adapter_id);
    if (!adapter) return reply.code(400).send({ error: `适配器未注册: ${row.adapter_id}` });
    try {
      const ctx = createSourceContext(row, db, cfg, log);
      const detail = await adapter.getMangaDetail(mangaId, ctx);
      return { ...detail, sourceId, sourceName: row.name };
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });
}
