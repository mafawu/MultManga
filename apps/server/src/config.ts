import path from 'node:path';

export interface ServerConfig {
  port: number;
  host: string;
  /** 数据目录（db 与库文件根） */
  dataDir: string;
  /** 下载的漫画文件根目录 */
  storageDir: string;
  dbPath: string;
}

export function loadConfig(): ServerConfig {
  const dataDir = process.env.MULTMANGA_DATA
    ? path.resolve(process.env.MULTMANGA_DATA)
    : path.resolve(import.meta.dirname, '..', 'data');
  return {
    port: Number(process.env.MULTMANGA_PORT ?? 3088),
    host: process.env.MULTMANGA_HOST ?? '0.0.0.0',
    dataDir,
    storageDir: path.join(dataDir, 'library'),
    dbPath: path.join(dataDir, 'multmanga.db'),
  };
}

/** 测试用：临时目录配置 */
export function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const base = loadConfig();
  return { ...base, ...overrides };
}
