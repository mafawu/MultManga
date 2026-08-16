import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db.js';
import { effectiveStorageDir } from '../settings.js';
import { contentTypeByExt } from '../download/storage.js';

export interface FilesRoutesDeps {
  db: Db;
  cfg: ServerConfig;
}

/** 已下载章节的本地图片服务（/api/files/<libraryId>/<chapterId>/001.jpg） */
export function registerFilesRoutes(app: FastifyInstance, deps: FilesRoutesDeps): void {
  const { db, cfg } = deps;

  app.get('/api/files/*', async (req, reply) => {
    const rel = (req.params as { '*': string })['*'] ?? '';
    const storageDir = path.resolve(effectiveStorageDir(db, cfg));
    const full = path.resolve(storageDir, rel);
    if (full !== storageDir && !full.startsWith(storageDir + path.sep)) {
      return reply.code(400).send({ error: '非法路径' });
    }
    try {
      const stat = await fs.promises.stat(full);
      if (!stat.isFile()) return reply.code(404).send({ error: '文件不存在' });
      reply.header('content-type', contentTypeByExt(full));
      reply.header('cache-control', 'public, max-age=86400');
      return reply.send(fs.createReadStream(full));
    } catch {
      return reply.code(404).send({ error: '文件不存在' });
    }
  });
}
