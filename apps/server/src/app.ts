import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Db } from './db.js';
import type { ServerConfig } from './config.js';
import type { EventBus } from './events.js';
import type { Logger } from '@multmanga/core';
import type { DownloadQueue } from './download/queue.js';
import { getSettings } from './settings.js';
import { registerAdapterRoutes } from './routes/adapters.js';
import { registerSourceRoutes } from './routes/sources.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerMangaRoutes } from './routes/manga.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerDownloadsRoutes } from './routes/downloads.js';
import { registerProgressRoutes } from './routes/progress.js';
import { registerEventsRoutes } from './routes/events.js';
import { registerFilesRoutes } from './routes/files.js';
import { registerProxyRoutes } from './routes/proxy.js';
import { registerInfoRoutes } from './routes/info.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerPagesRoutes } from './routes/pages.js';

export interface AppDeps {
  db: Db;
  cfg: ServerConfig;
  bus: EventBus;
  queue: DownloadQueue;
  log: Logger;
}

/** 设置了访问令牌时，这些路径豁免（SSE 用 EventSource、图片用 <img> 均无法携带 Header） */
const AUTH_EXEMPT_PREFIXES = ['/api/events', '/api/files', '/api/proxy'];

export function buildApp(deps: AppDeps): FastifyInstance {
  const { db, cfg, bus, queue, log } = deps;
  const app = Fastify({ logger: false });

  // 可选访问令牌鉴权（settings.accessToken 非空时启用）
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api')) return;
    if (AUTH_EXEMPT_PREFIXES.some((p) => url.startsWith(p))) return;
    const settings = getSettings(db);
    if (!settings.accessToken) return;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const queryToken = (req.query as { token?: string })?.token ?? '';
    if (token !== settings.accessToken && queryToken !== settings.accessToken) {
      return reply.code(401).send({ error: '未授权：需要有效的访问令牌' });
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues.map((i) => i.message).join('; ') });
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error('请求出错:', req.method, req.url, message);
    return reply.code(500).send({ error: message });
  });

  registerAdapterRoutes(app);
  registerSourceRoutes(app, { db, cfg, bus, log });
  registerSearchRoutes(app, { db, cfg, log });
  registerMangaRoutes(app, { db, cfg, log });
  registerLibraryRoutes(app, { db, cfg, bus, log });
  registerDownloadsRoutes(app, { db, cfg, bus, queue });
  registerProgressRoutes(app, { db });
  registerEventsRoutes(app, { bus });
  registerFilesRoutes(app, { db, cfg });
  registerProxyRoutes(app, { db, cfg, log });
  registerPagesRoutes(app, { db, cfg, log });
  registerInfoRoutes(app, { db, cfg });
  registerSettingsRoutes(app, { db });

  return app;
}
