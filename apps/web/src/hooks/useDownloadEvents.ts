import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const EVENT_TYPES = [
  'download.queued',
  'download.progress',
  'download.done',
  'download.failed',
  'download.paused',
  'download.resumed',
  'download.canceled',
  'library.changed',
  'source.changed',
] as const;

/**
 * SSE 订阅：下载/书架/源变更时自动失效相关查询。
 */
export function useDownloadEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource('/api/events');
    const handler = (type: string) => {
      if (type.startsWith('download.')) {
        qc.invalidateQueries({ queryKey: ['downloads'] });
        qc.invalidateQueries({ queryKey: ['library'] });
      } else if (type === 'library.changed') {
        qc.invalidateQueries({ queryKey: ['library'] });
      } else if (type === 'source.changed') {
        qc.invalidateQueries({ queryKey: ['sources'] });
      }
    };
    for (const t of EVENT_TYPES) es.addEventListener(t, () => handler(t));
    return () => es.close();
  }, [qc]);
}
