import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { api } from '../api/client';
import { Button, Cover, EmptyState, Progress, Spinner } from '../components/ui';
import { useLibraryStore, type ShelfSort } from '../stores/library';
import { useUI } from '../stores/ui';
import type { LibraryItem } from '../api/types';

const CARD_W = 150;
const GAP = 14;
const ROW_H = 308;

export default function LibraryPage() {
  const store = useLibraryStore();
  const { q, source, unreadOnly, undownloadedOnly, sort, dir } = store;

  const { data, isLoading, refetch } = useQuery({ queryKey: ['library'], queryFn: api.library });

  const [width, setWidth] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  // callback ref：网格元素挂载时（无论何时出现）建立宽度观察，
  // 避免首次进入时 useEffect 已跑过而网格尚未渲染的问题
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (el) {
      setWidth(el.offsetWidth);
      const ro = new ResizeObserver(() => setWidth(el.offsetWidth));
      ro.observe(el);
      roRef.current = ro;
    }
  }, []);

  useEffect(() => () => roRef.current?.disconnect(), []);

  // 滚动位置保持
  useEffect(() => {
    store.restoreScrollY();
    const onScroll = () => store.setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sources = useMemo(() => [...new Set((data ?? []).map((i) => i.sourceName))], [data]);

  const items = useMemo(() => {
    let list = data ?? [];
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      list = list.filter((i) => i.title.toLowerCase().includes(t));
    }
    if (source !== 'all') list = list.filter((i) => i.sourceName === source);
    if (unreadOnly) list = list.filter((i) => i.unreadCount > 0);
    if (undownloadedOnly) list = list.filter((i) => i.downloadedCount < i.chapterCount);
    list = [...list];
    const sign = dir === 'asc' ? 1 : -1;
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'zh') * sign);
    else if (sort === 'added') list.sort((a, b) => a.addedAt.localeCompare(b.addedAt) * sign);
    else if (sort === 'recent') {
      // 最近阅读：按 lastReadAt 排序，无阅读记录的永远排最后
      list.sort((a, b) => {
        const ta = a.lastReadAt ?? '';
        const tb = b.lastReadAt ?? '';
        if (!ta && !tb) return 0;
        if (!ta) return 1;
        if (!tb) return -1;
        return ta.localeCompare(tb) * sign;
      });
    } else {
      list.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) * sign);
    }
    return list;
  }, [data, q, source, unreadOnly, undownloadedOnly, sort, dir]);

  const cols = Math.max(2, Math.floor((width + GAP) / (CARD_W + GAP)));
  const rows = useMemo(() => {
    const out: LibraryItem[][] = [];
    for (let i = 0; i < items.length; i += cols) out.push(items.slice(i, i + cols));
    return out;
  }, [items, cols]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_H,
    overscan: 4,
  });

  if (isLoading) {
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="toolbar">
        <input className="input grow" placeholder="搜索书架…" value={q} onChange={(e) => store.setQ(e.target.value)} />
        <select className="select" value={source} onChange={(e) => store.setSource(e.target.value)}>
          <option value="all">全部来源</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => store.setUnreadOnly(e.target.checked)} /> 仅未读
        </label>
        <label className="check">
          <input type="checkbox" checked={undownloadedOnly} onChange={(e) => store.setUndownloadedOnly(e.target.checked)} /> 仅未下载
        </label>
        <select className="select" value={sort} onChange={(e) => store.setSort(e.target.value as ShelfSort)}>
          <option value="updated">最近更新</option>
          <option value="added">最近添加</option>
          <option value="recent">最近阅读</option>
          <option value="title">标题</option>
        </select>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => store.setDir(dir === 'asc' ? 'desc' : 'asc')}
          title="切换排序方向"
        >
          {dir === 'asc' ? '↑ 正序' : '↓ 倒序'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => refetch()}>
          刷新
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={(data?.length ?? 0) > 0 ? '没有匹配的漫画' : '书架还是空的'}
          hint="去搜索页搜索并加入漫画吧"
          action={
            <Link to="/search">
              <Button>去搜索</Button>
            </Link>
          }
        />
      ) : (
        <div ref={gridRef} className="virtual-grid" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index]!;
            return (
              <div
                key={vi.key}
                className="grid-row"
                style={{
                  transform: `translateY(${vi.start}px)`,
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                }}
              >
                {row.map((i) => (
                  <MangaCard key={i.id} item={i} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MangaCard({ item }: { item: LibraryItem }) {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const downloadAllMut = useMutation({
    mutationFn: () => api.downloadAll(item.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['library'] });
      qc.invalidateQueries({ queryKey: ['downloads'] });
      toast('success', `已加入 ${r.enqueued} 个章节到下载队列`);
    },
    onError: (e) => toast('error', `批量下载失败: ${e.message}`),
  });

  const pending = item.chapterCount - item.downloadedCount;

  return (
    <Link to={`/library/${item.id}`} className="card manga-card">
      <Cover coverUrl={item.coverUrl} sourceId={item.sourceId} title={item.title} className="manga-cover" />
      <div className="manga-title">{item.title}</div>
      <div className="manga-meta">
        {item.sourceName}
        {item.chapterCount > 0 && ` · ${item.downloadedCount}/${item.chapterCount}`}
      </div>
      {item.chapterCount > 0 && (
        <div className="manga-progress">
          <Progress value={item.downloadedCount} max={item.chapterCount} />
        </div>
      )}
      {item.unreadCount > 0 && <span className="unread-badge">{item.unreadCount}</span>}
      {pending > 0 && (
        <button
          className="btn btn-primary btn-sm manga-download-all"
          disabled={downloadAllMut.isPending}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            downloadAllMut.mutate();
          }}
          title={`批量下载全部 ${pending} 个未下载章节`}
        >
          {downloadAllMut.isPending ? '加入中…' : `下载全部 ${pending}`}
        </button>
      )}
    </Link>
  );
}
