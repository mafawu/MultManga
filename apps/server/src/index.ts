import fs from 'node:fs';
import path from 'node:path';
import { registerBuiltinAdapters } from '@multmanga/sources';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { EventBus } from './events.js';
import { DownloadQueue } from './download/queue.js';
import { seedDefaultSources } from './seed.js';
import { buildApp } from './app.js';
import { getLanAddresses, log } from './utils.js';

async function main(): Promise<void> {
  registerBuiltinAdapters();
  const cfg = loadConfig();
  const db = openDb(cfg);
  seedDefaultSources(db);

  const bus = new EventBus();
  const queue = new DownloadQueue(db, bus, cfg, log);
  queue.start();

  const app = buildApp({ db, cfg, bus, queue, log });

  // 生产模式：托管 web 构建产物（apps/web/dist）
  const webDist = path.resolve(import.meta.dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register((await import('@fastify/static')).default, {
      root: webDist,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api')) {
        return reply.code(404).send({ error: 'Not Found' });
      }
      const html = await fs.promises.readFile(path.join(webDist, 'index.html'), 'utf8');
      return reply.type('text/html').send(html);
    });
  }

  try {
    await app.listen({ port: cfg.port, host: cfg.host });
  } catch (err) {
    log.error('服务启动失败:', (err as Error).message);
    process.exit(1);
  }

  const lan = getLanAddresses();
  log.info('┌──────────────────────────────────────────────┐');
  log.info('│  MultManga 已启动                            │');
  log.info(`│  本机:    http://localhost:${cfg.port}                │`);
  for (const ip of lan) {
    log.info(`│  局域网: http://${ip}:${cfg.port}                 │`);
  }
  log.info(`│  数据目录: ${cfg.dataDir}`);
  log.info('└──────────────────────────────────────────────┘');
}

void main();
