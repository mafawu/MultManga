import fs from 'node:fs';
import path from 'node:path';
import { sanitizeFilename } from '@multmanga/core';
import { zipSync } from 'fflate';

/** 章节本地目录：<storageDir>/<libraryId>/<chapterId>/ */
export function chapterDir(storageDir: string, libId: string, chapterId: string): string {
  return path.join(storageDir, sanitizeFilename(libId), sanitizeFilename(chapterId));
}

/** 删除整个书架条目的本地文件 */
export async function rmrf(storageDir: string, libId: string): Promise<void> {
  await fs.promises.rm(path.join(storageDir, sanitizeFilename(libId)), { recursive: true, force: true });
}

/** 删除单个章节的本地文件 */
export async function rmrfChapter(storageDir: string, libId: string, chapterId: string): Promise<void> {
  await fs.promises.rm(chapterDir(storageDir, libId, chapterId), { recursive: true, force: true });
}

/** 先写临时文件再原子改名，避免下载中断留下半截文件 */
export async function writePageAtomically(target: string, data: Uint8Array): Promise<void> {
  const tmp = `${target}.tmp`;
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, target);
}

/** 将章节目录打包为 CBZ（zip） */
export async function packCbz(dir: string, outFile: string): Promise<void> {
  const files = (await fs.promises.readdir(dir)).sort();
  const entries: Record<string, Uint8Array> = {};
  for (const f of files) {
    const full = path.join(dir, f);
    const st = await fs.promises.stat(full);
    if (st.isFile()) entries[f] = new Uint8Array(await fs.promises.readFile(full));
  }
  const zipped = zipSync(entries);
  const tmp = `${outFile}.tmp`;
  await fs.promises.writeFile(tmp, zipped);
  await fs.promises.rename(tmp, outFile);
}

export function contentTypeByExt(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'application/octet-stream';
  }
}
