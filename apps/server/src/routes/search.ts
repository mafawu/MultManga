import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db.js';
import type { Logger, SearchHit } from '@multmanga/core';
import { searchInputSchema } from '@multmanga/core';
import { getAdapter } from '@multmanga/sources';
import { createSourceContext, getSourceById } from '../context.js';

export interface SearchRoutesDeps {
  db: Db;
  cfg: ServerConfig;
  log: Logger;
}

export function registerSearchRoutes(app: FastifyInstance, deps: SearchRoutesDeps): void {
  const { db, cfg, log } = deps;

  app.get('/api/search', async (req, reply) => {
    const { q, sourceId } = req.query as { q?: string; sourceId?: string };
    if (!q || !q.trim()) return reply.code(400).send({ error: '缺少 q 参数' });
    const ids = sourceId ? [sourceId] : enabledSourceIds(db);
    return runSearch(db, cfg, log, ids, q.trim());
  });

  app.post('/api/search', async (req, reply) => {
    const input = searchInputSchema.parse(req.body);
    const ids = input.sourceIds?.length ? input.sourceIds : enabledSourceIds(db);
    return runSearch(db, cfg, log, ids, input.q);
  });
}

function enabledSourceIds(db: Db): string[] {
  const rows = db.prepare('SELECT id FROM sources WHERE enabled = 1 ORDER BY created_at').all() as { id: string }[];
  return rows.map((r) => r.id);
}

async function runSearch(
  db: Db,
  cfg: ServerConfig,
  log: Logger,
  sourceIds: string[],
  q: string,
): Promise<{ results: SearchHit[]; errors: { sourceId: string; sourceName: string; error: string }[]; count: number }> {
  const results: SearchHit[] = [];
  const errors: { sourceId: string; sourceName: string; error: string }[] = [];
  await Promise.all(
    sourceIds.map(async (sid) => {
      const row = getSourceById(db, sid);
      if (!row) return;
      const adapter = getAdapter(row.adapter_id);
      if (!adapter) return;
      try {
        const ctx = createSourceContext(row, db, cfg, log);
        const hits = await adapter.search(q, ctx);
        for (const h of hits) {
          results.push({ ...h, sourceId: sid, sourceName: row.name });
        }
      } catch (e) {
        errors.push({ sourceId: sid, sourceName: row.name, error: (e as Error).message });
      }
    }),
  );
  return { results, errors, count: results.length };
}
