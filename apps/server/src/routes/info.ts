import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db.js';
import { APP_NAME, APP_VERSION } from '@multmanga/core';
import { getLanAddresses } from '../utils.js';
import { effectiveStorageDir, getSettings } from '../settings.js';

export interface InfoRoutesDeps {
  db: Db;
  cfg: ServerConfig;
}

export function registerInfoRoutes(app: FastifyInstance, deps: InfoRoutesDeps): void {
  const { db, cfg } = deps;

  app.get('/api/info', async () => {
    const s = getSettings(db);
    return {
      name: APP_NAME,
      version: APP_VERSION,
      port: cfg.port,
      lanAddresses: getLanAddresses(),
      settings: {
        storageDir: effectiveStorageDir(db, cfg),
        concurrency: s.concurrency,
        userAgent: s.userAgent,
        cbz: s.cbz,
        accessTokenEnabled: s.accessToken.length > 0,
      },
    };
  });
}
