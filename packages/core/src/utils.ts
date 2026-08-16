/**
 * 文件名净化：移除 Windows 非法字符与保留名，控制长度。
 */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '') // Windows 不允许尾部点/空格
    .slice(0, 120);
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const final = cleaned || 'untitled';
  return reserved.test(final) ? '_' + final : final;
}

/** 从 URL 猜测图片扩展名（.jpg/.png/.webp/.gif/.avif，未知返回 .img） */
export function extFromUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url;
  }
  const m = pathname.match(/\.([a-z0-9]{2,5})$/i);
  if (m) {
    const ext = m[1]!.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp'].includes(ext)) {
      return ext === 'jpeg' ? '.jpg' : `.${ext}`;
    }
  }
  return '.img';
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
