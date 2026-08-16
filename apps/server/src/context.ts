import type { Db } from './db.js';
import type { ServerConfig } from './config.js';
import type { Logger, SourceContext } from '@multmanga/core';
import { createHttpClient } from '@multmanga/sources';
import { getSettings } from './settings.js';

export interface SourceRow {
  id: string;
  adapter_id: string;
  name: string;
  base_url: string;
  config_json: string;
  enabled: number;
  created_at: string;
}

export interface LibraryRow {
  id: string;
  source_id: string;
  manga_id: string;
  title: string;
  author: string | null;
  description: string | null;
  cover_url: string | null;
  status: string | null;
  updated_at: string;
  added_at: string;
}

export interface ChapterRow {
  id: string;
  library_id: string;
  chapter_id: string;
  title: string;
  chapter_number: number | null;
  download_state: string;
  local_dir: string | null;
  page_count: number | null;
  created_at: string;
}

export interface JobRow {
  id: string;
  chapter_id: string;
  state: string;
  progress: number;
  error: string | null;
  failed_pages: string | null;
  created_at: string;
  updated_at: string;
}

export function parseConfigJson(row: SourceRow): Record<string, unknown> {
  try {
    return JSON.parse(row.config_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function serializeSource(row: SourceRow) {
  return {
    id: row.id,
    adapterId: row.adapter_id,
    name: row.name,
    baseUrl: row.base_url,
    config: parseConfigJson(row),
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

export function getSourceById(db: Db, id: string): SourceRow | undefined {
  return db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined;
}

/** 用源配置构建适配器运行上下文 */
export function createSourceContext(row: SourceRow, db: Db, cfg: ServerConfig, log: Logger): SourceContext {
  const settings = getSettings(db);
  const http = createHttpClient({ userAgent: settings.userAgent, log });
  return {
    baseUrl: row.base_url,
    config: parseConfigJson(row),
    http,
    log,
  };
}
