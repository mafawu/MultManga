import { randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db.js';
import type { EventBus } from '../events.js';
import type { Logger } from '@multmanga/core';
import { sourceCreateSchema, sourceUpdateSchema } from '@multmanga/core';
import { getAdapter } from '@multmanga/sources';
import {
  createSourceContext,
  getSourceById,
  serializeSource,
  type SourceRow,
} from '../context.js';
import { effectiveStorageDir } from '../settings.js';
import { rmrf } from '../download/storage.js';

export interface SourceRoutesDeps {
  db: Db;
  cfg: ServerConfig;
  bus: EventBus;
  log: Logger;
}

export function registerSourceRoutes(app: FastifyInstance, deps: SourceRoutesDeps): void {
  const { db, cfg, bus, log } = deps;

  app.get('/api/sources', async () => {
    const rows = db.prepare('SELECT * FROM sources ORDER BY created_at ASC').all() as unknown as SourceRow[];
    return rows.map(serializeSource);
  });

  app.post('/api/sources', async (req, reply) => {
    const input = sourceCreateSchema.parse(req.body);
    const adapter = getAdapter(input.adapterId);
    if (!adapter) return reply.code(400).send({ error: `未知适配器: ${input.adapterId}` });
    const baseUrl = input.baseUrl ?? adapter.defaultBaseUrl;
    if (!baseUrl) return reply.code(400).send({ error: '必须提供 baseUrl' });
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO sources (id, adapter_id, name, base_url, config_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, adapter.id, input.name ?? adapter.name, baseUrl, JSON.stringify(input.config ?? {}), input.enabled === false ? 0 : 1, now);
    bus.emit('source.changed', { id });
    return serializeSource(getSourceById(db, id)!);
  });

  app.patch('/api/sources/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getSourceById(db, id);
    if (!row) return reply.code(404).send({ error: '源不存在' });
    const input = sourceUpdateSchema.parse(req.body);
    const sets: string[] = [];
    const vals: SQLInputValue[] = [];
    if (input.name !== undefined) {
      sets.push('name = ?');
      vals.push(input.name);
    }
    if (input.baseUrl !== undefined) {
      sets.push('base_url = ?');
      vals.push(input.baseUrl);
    }
    if (input.config !== undefined) {
      sets.push('config_json = ?');
      vals.push(JSON.stringify(input.config));
    }
    if (input.enabled !== undefined) {
      sets.push('enabled = ?');
      vals.push(input.enabled ? 1 : 0);
    }
    if (sets.length > 0) {
      vals.push(id);
      db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      bus.emit('source.changed', { id });
    }
    return serializeSource(getSourceById(db, id)!);
  });

  app.delete('/api/sources/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getSourceById(db, id);
    if (!row) return reply.code(404).send({ error: '源不存在' });
    // 级联删除该源下的书架条目（chapters/jobs/progress 由外键级联）
    const libs = db.prepare('SELECT id FROM library WHERE source_id = ?').all(id) as { id: string }[];
    db.prepare('DELETE FROM sources WHERE id = ?').run(id);
    for (const l of libs) await rmrf(effectiveStorageDir(db, cfg), l.id);
    bus.emit('library.changed', { sourceId: id });
    bus.emit('source.changed', { id });
    return { ok: true };
  });

  app.post('/api/sources/:id/test', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = getSourceById(db, id);
    if (!row) return reply.code(404).send({ error: '源不存在' });
    const adapter = getAdapter(row.adapter_id);
    if (!adapter) return reply.code(400).send({ error: `适配器未注册: ${row.adapter_id}` });
    const ctx = createSourceContext(row, db, cfg, log);
    if (adapter.test) return adapter.test(ctx);
    try {
      await ctx.http.getText(ctx.baseUrl);
      return { ok: true, message: '连接正常' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  });
}
