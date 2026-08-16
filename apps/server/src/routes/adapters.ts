import type { FastifyInstance } from 'fastify';
import { listAdapters } from '@multmanga/sources';

export function registerAdapterRoutes(app: FastifyInstance): void {
  app.get('/api/adapters', async () => listAdapters());
}
