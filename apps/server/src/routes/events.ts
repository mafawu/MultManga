import type { FastifyInstance } from 'fastify';
import type { EventBus } from '../events.js';

export interface EventsRoutesDeps {
  bus: EventBus;
}

/** SSE：下载进度与任务状态实时推送 */
export function registerEventsRoutes(app: FastifyInstance, deps: EventsRoutesDeps): void {
  const { bus } = deps;

  app.get('/api/events', (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (e: { type: string; data: unknown }) => {
      raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`);
    };
    const unsub = bus.subscribe(send);
    const heartbeat = setInterval(() => raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsub();
    });
  });
}
