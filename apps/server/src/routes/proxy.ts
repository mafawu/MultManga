import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db.js';
import type { Logger } from '@multmanga/core';
import { getAdapter } from '@multmanga/sources';
import { createSourceContext, getSourceById } from '../context.js';
import { getSettings } from '../settings.js';

export interface ProxyRoutesDeps {
  db: Db;
  cfg: ServerConfig;
  log: Logger;
}

/**
 * 在线图片代理：服务端按源配置的请求头拉取图片，解决跨域与防盗链。
 * /api/proxy?url=...&sourceId=...&referer=...
 */
export function registerProxyRoutes(app: FastifyInstance, deps: ProxyRoutesDeps): void {
  const { db, cfg, log } = deps;

  app.get('/api/proxy', async (req, reply) => {
    const { url, sourceId, referer } = req.query as { url?: string; sourceId?: string; referer?: string };
    if (!url) return reply.code(400).send({ error: '缺少 url 参数' });
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return reply.code(400).send({ error: '无效 url' });
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return reply.code(400).send({ error: '仅支持 http/https' });
    }

    const settings = getSettings(db);
    const headers: Record<string, string> = {
      'User-Agent': settings.userAgent,
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    };
    if (referer) headers.Referer = referer;
    if (sourceId) {
      const row = getSourceById(db, sourceId);
      const adapter = row ? getAdapter(row.adapter_id) : undefined;
      if (row && adapter) {
        const ctx = createSourceContext(row, db, cfg, log);
        const extra = adapter.getImageHeaders?.(url, ctx);
        if (extra) Object.assign(headers, extra);
      }
    }

    const isNetworkError = (e: unknown) => {
      const err = e as { name?: string; message?: string };
      return err.name === 'TimeoutError' || err.name === 'AbortError' || /fetch failed/i.test(err.message ?? '');
    };

    let targetUrl = url;
    let upstream: Response;
    try {
      upstream = await fetch(targetUrl, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      // HTTPS 网络级失败时回退 HTTP（部分 CDN 在特定网络下 HTTPS 挂起而 HTTP 可用）
      if (targetUrl.startsWith('https://') && isNetworkError(e)) {
        try {
          upstream = await fetch(`http://${targetUrl.slice(8)}`, {
            headers,
            redirect: 'follow',
            signal: AbortSignal.timeout(20_000),
          });
        } catch {
          return reply.code(502).send({ error: (e as Error).message });
        }
      } else {
        return reply.code(502).send({ error: (e as Error).message });
      }
    }
    if (!upstream.ok) return reply.code(upstream.status).send({ error: `上游返回 ${upstream.status}` });
    const ct = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const buf = Buffer.from(await upstream.arrayBuffer());
    reply.header('content-type', ct);
    reply.header('cache-control', 'public, max-age=86400');
    return reply.send(buf);
  });
}
