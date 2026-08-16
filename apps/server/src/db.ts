import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { ServerConfig } from './config.js';

export type Db = DatabaseSync;

export function openDb(cfg: ServerConfig): Db {
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const db = new DatabaseSync(cfg.dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      adapter_id TEXT NOT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      config_json TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      manga_id TEXT NOT NULL,
      title TEXT NOT NULL,
      author TEXT,
      description TEXT,
      cover_url TEXT,
      status TEXT,
      updated_at TEXT NOT NULL,
      added_at TEXT NOT NULL,
      UNIQUE(source_id, manga_id)
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      library_id TEXT NOT NULL REFERENCES library(id) ON DELETE CASCADE,
      chapter_id TEXT NOT NULL,
      title TEXT NOT NULL,
      chapter_number REAL,
      chapter_order INTEGER,
      download_state TEXT NOT NULL DEFAULT 'none',
      local_dir TEXT,
      page_count INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(library_id, chapter_id)
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      chapter_id TEXT PRIMARY KEY REFERENCES chapters(id) ON DELETE CASCADE,
      page_index INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS download_jobs (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL UNIQUE REFERENCES chapters(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      failed_pages TEXT,
      pages_done INTEGER,
      pages_total INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_state ON download_jobs(state);
    CREATE INDEX IF NOT EXISTS idx_chapters_library ON chapters(library_id);
    CREATE INDEX IF NOT EXISTS idx_library_source ON library(source_id);
  `);

  // 迁移：旧库补 chapter_order 列（用 rowid 兜底为插入顺序）
  const chapterCols = db.prepare('PRAGMA table_info(chapters)').all() as { name: string }[];
  if (!chapterCols.some((c) => c.name === 'chapter_order')) {
    db.exec('ALTER TABLE chapters ADD COLUMN chapter_order INTEGER');
    db.exec('UPDATE chapters SET chapter_order = rowid WHERE chapter_order IS NULL');
  }

  // 迁移：download_jobs 补 failed_pages 列（单页失败明细）
  const jobCols = db.prepare('PRAGMA table_info(download_jobs)').all() as { name: string }[];
  if (!jobCols.some((c) => c.name === 'failed_pages')) {
    db.exec('ALTER TABLE download_jobs ADD COLUMN failed_pages TEXT');
  }

  // 迁移：download_jobs 补页数进度列（进度明细：已完成页/总页数）
  if (!jobCols.some((c) => c.name === 'pages_done')) {
    db.exec('ALTER TABLE download_jobs ADD COLUMN pages_done INTEGER');
  }
  if (!jobCols.some((c) => c.name === 'pages_total')) {
    db.exec('ALTER TABLE download_jobs ADD COLUMN pages_total INTEGER');
  }
}
