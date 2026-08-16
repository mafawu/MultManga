import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';

/** 首次启动时若无任何源，则种子内置源 */
export function seedDefaultSources(db: Db): void {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM sources').get() as { c: number };
  if (c > 0) return;
  const now = new Date().toISOString();
  const ins = db.prepare(
    'INSERT INTO sources (id, adapter_id, name, base_url, config_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
  );
  ins.run(randomUUID(), 'mangadex', 'MangaDex', 'https://api.mangadex.org', '{}', now);
  ins.run(randomUUID(), 'copymanga', 'Copymanga', 'https://api.copymanga.tv', '{}', now);
  ins.run(randomUUID(), 'baozimh', '包子漫画', 'https://cn.baozimhcn.com', '{}', now);
  ins.run(randomUUID(), 'wuqian', '武芊漫画', 'https://comic.mkzcdn.com', '{}', now);
}
