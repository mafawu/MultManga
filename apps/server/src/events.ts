export type EventType =
  | 'download.queued'
  | 'download.progress'
  | 'download.done'
  | 'download.failed'
  | 'download.paused'
  | 'download.resumed'
  | 'download.canceled'
  | 'library.changed'
  | 'source.changed';

export interface AppEvent {
  type: EventType;
  data: unknown;
  time: number;
}

/** 进程内事件总线；SSE 端点订阅后推送给前端 */
export class EventBus {
  private listeners = new Set<(e: AppEvent) => void>();

  subscribe(fn: (e: AppEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(type: EventType, data: unknown): void {
    const e: AppEvent = { type, data, time: Date.now() };
    for (const fn of this.listeners) fn(e);
  }
}
