import fs from 'node:fs';
import path from 'node:path';

/**
 * 下载日志（JSON Lines，追加写）。
 *
 * 文件：<dataDir>/logs/download.log
 * 每条一行 JSON：{ t: ISO 时间, jobId?, chapterId?, libraryId?, manga?, chapter?, ev: 事件名, ... }
 *
 * 设计目标：下载失败时可离线排查——记录每个任务的阶段切换、
 * 每页的成功/失败/重试（含 URL、错误、耗时）与任务终态。
 * 日志写入失败不影响下载本身（吞掉异常）。
 */

let logFile: string | null = null;

/** 初始化日志文件（幂等）；dataDir 通常来自 ServerConfig */
export function initDownloadLog(dataDir: string): void {
  if (logFile) return;
  try {
    const dir = path.join(dataDir, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logFile = path.join(dir, 'download.log');
  } catch {
    logFile = null;
  }
}

export interface DownloadLogEntry {
  t?: string;
  jobId?: string;
  chapterId?: string;
  libraryId?: string;
  manga?: string;
  chapter?: string;
  ev: string;
  [k: string]: unknown;
}

export function downloadLog(entry: DownloadLogEntry): void {
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    /* 日志失败不影响下载 */
  }
}
