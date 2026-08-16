import type { MangaSourceAdapter, SourceAdapterDescriptor } from '@multmanga/core';

const registry = new Map<string, MangaSourceAdapter>();

/** 注册一个适配器（id 冲突时后者覆盖） */
export function registerAdapter(adapter: MangaSourceAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getAdapter(id: string): MangaSourceAdapter | undefined {
  return registry.get(id);
}

export function listAdapters(): SourceAdapterDescriptor[] {
  return [...registry.values()].map((a) => ({
    id: a.id,
    name: a.name,
    version: a.version,
    description: a.description,
    defaultBaseUrl: a.defaultBaseUrl,
    configSchema: a.configSchema,
  }));
}
