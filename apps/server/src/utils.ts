import os from 'node:os';
import type { Logger } from '@multmanga/core';

export const log: Logger = {
  info: (...a) => console.log('[multmanga]', ...a),
  warn: (...a) => console.warn('[multmanga]', ...a),
  error: (...a) => console.error('[multmanga]', ...a),
};

export function getLanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}
