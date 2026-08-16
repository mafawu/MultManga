import type { Db } from './db.js';
import type { ServerConfig } from './config.js';
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_PAGE_CONCURRENCY,
  DEFAULT_USER_AGENT,
  MAX_PAGE_CONCURRENCY,
} from '@multmanga/core';

export interface AppSettings {
  /** 空字符串 = 使用配置默认 storageDir */
  storageDir: string;
  /** 同时处理的章节任务数（worker 池大小） */
  concurrency: number;
  /** 单个章节内图片下载的并发数（1..MAX_PAGE_CONCURRENCY） */
  pageConcurrency: number;
  userAgent: string;
  /** 下载完成后是否打包 CBZ */
  cbz: boolean;
  /** 可选访问令牌（空 = 不启用） */
  accessToken: string;
}

const DEFAULTS: AppSettings = {
  storageDir: '',
  concurrency: DEFAULT_CONCURRENCY,
  pageConcurrency: DEFAULT_PAGE_CONCURRENCY,
  userAgent: DEFAULT_USER_AGENT,
  cbz: false,
  accessToken: '',
};

export function getSettings(db: Db): AppSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const pageConcurrency =
    Number(map.get('pageConcurrency') ?? DEFAULTS.pageConcurrency) || DEFAULTS.pageConcurrency;
  return {
    storageDir: map.get('storageDir') ?? DEFAULTS.storageDir,
    concurrency: Number(map.get('concurrency') ?? DEFAULTS.concurrency) || DEFAULTS.concurrency,
    pageConcurrency: Math.min(MAX_PAGE_CONCURRENCY, Math.max(1, pageConcurrency)),
    userAgent: map.get('userAgent') ?? DEFAULTS.userAgent,
    cbz: (map.get('cbz') ?? String(DEFAULTS.cbz)) === 'true',
    accessToken: map.get('accessToken') ?? DEFAULTS.accessToken,
  };
}

export function updateSettings(db: Db, patch: Partial<AppSettings>): AppSettings {
  const cur = getSettings(db);
  const next = { ...cur, ...patch };
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  stmt.run('storageDir', next.storageDir);
  stmt.run('concurrency', String(next.concurrency));
  stmt.run('pageConcurrency', String(next.pageConcurrency));
  stmt.run('userAgent', next.userAgent);
  stmt.run('cbz', String(next.cbz));
  stmt.run('accessToken', next.accessToken);
  return next;
}

/** 实际使用的存储根目录：设置项优先，否则用配置默认 */
export function effectiveStorageDir(db: Db, cfg: ServerConfig): string {
  const s = getSettings(db);
  return s.storageDir || cfg.storageDir;
}
