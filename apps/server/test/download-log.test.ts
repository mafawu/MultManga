import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadLog, initDownloadLog } from '../src/download/log.js';

describe('下载日志模块', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multmanga-log-test-'));
    initDownloadLog(tmpDir);
  });

  afterAll(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  it('写入 JSON Lines 日志并带时间戳与事件名', () => {
    downloadLog({ jobId: 'j1', chapterId: 'c1', manga: '测试', chapter: '第1话', ev: 'job_start' });
    downloadLog({ jobId: 'j1', ev: 'page_fail', page: 3, url: 'https://x/3.jpg', error: 'GET -> 404', errorType: 'not_found' });
    downloadLog({ jobId: 'j1', ev: 'job_done', okPages: 10, failedPages: 1, ms: 1234 });

    const file = path.join(tmpDir, 'logs', 'download.log');
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);

    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed[0]).toMatchObject({ ev: 'job_start', jobId: 'j1', manga: '测试', chapter: '第1话' });
    expect(typeof parsed[0]!.t).toBe('string');
    expect(parsed[1]).toMatchObject({ ev: 'page_fail', page: 3, errorType: 'not_found' });
    expect(parsed[2]).toMatchObject({ ev: 'job_done', okPages: 10, failedPages: 1, ms: 1234 });
  });
});
