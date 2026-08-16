import type { FastifyInstance } from 'fastify';
import type { Db } from '../db.js';
import { z } from 'zod';
import { MAX_PAGE_CONCURRENCY } from '@multmanga/core';
import { getSettings, updateSettings } from '../settings.js';

const settingsUpdateSchema = z.object({
  storageDir: z.string().optional(),
  concurrency: z.number().int().min(1).max(16).optional(),
  pageConcurrency: z.number().int().min(1).max(MAX_PAGE_CONCURRENCY).optional(),
  userAgent: z.string().min(1).max(300).optional(),
  cbz: z.boolean().optional(),
  accessToken: z.string().max(200).optional(),
});

export interface SettingsRoutesDeps {
  db: Db;
}

export function registerSettingsRoutes(app: FastifyInstance, deps: SettingsRoutesDeps): void {
  const { db } = deps;

  app.get('/api/settings', async () => getSettings(db));

  app.patch('/api/settings', async (req) => {
    const input = settingsUpdateSchema.parse(req.body);
    return updateSettings(db, input);
  });
}
