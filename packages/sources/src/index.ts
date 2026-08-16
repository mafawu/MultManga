export * from './registry.js';
export * from './http-client.js';
export { mangadexAdapter } from './mangadex/index.js';
export { copymangaAdapter } from './copymanga/index.js';
export { baozimhAdapter } from './baozimh/index.js';
export { wuqianAdapter } from './wuqian/index.js';

import { baozimhAdapter } from './baozimh/index.js';
import { copymangaAdapter } from './copymanga/index.js';
import { mangadexAdapter } from './mangadex/index.js';
import { registerAdapter } from './registry.js';
import { wuqianAdapter } from './wuqian/index.js';

/** 注册全部内置适配器（服务端启动时调用一次） */
export function registerBuiltinAdapters(): void {
  registerAdapter(mangadexAdapter);
  registerAdapter(copymangaAdapter);
  registerAdapter(baozimhAdapter);
  registerAdapter(wuqianAdapter);
}
