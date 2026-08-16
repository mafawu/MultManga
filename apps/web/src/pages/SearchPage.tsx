import { useEffect, useMemo, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { api } from '../api/client';
import { Button, Cover, EmptyState, Spinner } from '../components/ui';
import MangaDetailView from '../components/MangaDetailView';
import { useUI } from '../stores/ui';
import { useSearchStore } from '../stores/search';
import type { SearchHit } from '../api/types';

const ROW_H = 96;

export default function SearchPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const store = useSearchStore();
  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: api.sources });
  const { data: library } = useQuery({ queryKey: ['library'], queryFn: api.library });

  const enabled = (sources ?? []).filter((s) => s.enabled);

  const addMut = useMutation({
    mutationFn: ({ sourceId, mangaId }: { sourceId: string; mangaId: string }) =>
      api.addToLibrary(sourceId, mangaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['library'] });
      toast('success', '已加入书架');
    },
    onError: (e) => toast('error', `加入失败: ${e.message}`),
  });

  const inLibrary = useMemo(() => {
    const s = new Set<string>();
    for (const i of library ?? []) s.add(`${i.sourceId}:${i.mangaId}`);
    return s;
  }, [library]);

  // 挂载时恢复滚动位置（切路由回来不重载）
  useEffect(() => {
    store.restoreScrollY();
    const onScroll = () => store.setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e?: FormEvent, q = store.q) => {
    e?.preventDefault();
    const keyword = q.trim();
    if (!keyword) return;
    store.setQ(keyword);
    store.setSearching(true);
    api
      .search(keyword, store.selected ? [...store.selected] : undefined)
      .then((r) => {
        store.setResults(r.results, r.errors, keyword);
        store.addHistory(keyword);
      })
      .catch((err) => {
        store.setResults([], [{ sourceId: '', sourceName: '搜索', error: (err as Error).message }], keyword);
      });
    window.scrollTo(0, 0);
  };

  const toggleSource = (id: string) => {
    store.setSelected(
      (() => {
        const cur = store.selected ?? new Set(enabled.map((s) => s.id));
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next.size === enabled.length ? null : next;
      })(),
    );
  };

  return (
    <div className="page">
      <form className="search-bar" onSubmit={submit}>
        <input
          className="input grow"
          placeholder="输入关键词搜索漫画…"
          value={store.q}
          onChange={(e) => store.setQ(e.target.value)}
          autoFocus
        />
        <Button type="submit" disabled={!store.q.trim() || store.searching}>
          {store.searching ? '搜索中…' : '搜索'}
        </Button>
      </form>

      {/* 搜索历史 */}
      {store.history.length > 0 && (
        <div className="history-row">
          <span className="history-label">历史：</span>
          <div className="chips">
            {store.history.map((h) => (
              <span key={h} className="chip history-chip">
                <button className="history-text" onClick={() => submit(undefined, h)}>
                  {h}
                </button>
                <button className="history-x" onClick={() => store.removeHistory(h)} aria-label="删除记录">
                  ✕
                </button>
              </span>
            ))}
            <button className="history-clear" onClick={() => store.clearHistory()}>
              清空
            </button>
          </div>
        </div>
      )}

      <div className="chips">
        <button className={`chip ${store.selected === null ? 'on' : ''}`} onClick={() => store.setSelected(null)}>
          全部源
        </button>
        {enabled.map((s) => (
          <button
            key={s.id}
            className={`chip ${store.selected !== null && store.selected.has(s.id) ? 'on' : ''}`}
            onClick={() => toggleSource(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>

      {store.errors.length > 0 && (
        <div className="notice warn">
          {store.errors.map((e, i) => (
            <div key={i}>
              {e.sourceName}：{e.error}
            </div>
          ))}
        </div>
      )}

      {store.searching ? (
        <div className="center">
          <Spinner />
        </div>
      ) : store.hasSearched ? (
        store.results.length === 0 ? (
          <EmptyState title="没有找到结果" hint="换个关键词或勾选更多源试试" />
        ) : (
          <SearchResultList
            results={store.results}
            inLibrary={inLibrary}
            adding={addMut.isPending}
            onAdd={(hit) => addMut.mutate({ sourceId: hit.sourceId, mangaId: hit.mangaId })}
            onOpen={(hit) => store.setSelectedHit(hit)}
            count={store.results.length}
          />
        )
      ) : (
        <EmptyState title="搜索漫画" hint="输入关键词，从多个网站源聚合搜索" />
      )}

      {/* 右侧详情侧边栏 */}
      {store.selectedHit && (
        <div className="detail-sidebar-overlay" onMouseDown={(e) => e.target === e.currentTarget && store.setSelectedHit(null)}>
          <aside className="detail-sidebar">
            <div className="detail-sidebar-head">
              <span className="detail-sidebar-title">漫画详情</span>
              <div className="detail-sidebar-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    navigate(
                      `/manga/${encodeURIComponent(store.selectedHit!.sourceId)}/${encodeURIComponent(store.selectedHit!.mangaId)}`,
                    )
                  }
                >
                  进入详情页
                </Button>
                <Button size="sm" variant="ghost" onClick={() => store.setSelectedHit(null)}>
                  关闭
                </Button>
              </div>
            </div>
            <div className="detail-sidebar-body">
              <MangaDetailView sourceId={store.selectedHit.sourceId} mangaId={store.selectedHit.mangaId} compact />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}

function SearchResultList({
  results,
  inLibrary,
  adding,
  onAdd,
  onOpen,
  count,
}: {
  results: SearchHit[];
  inLibrary: Set<string>;
  adding: boolean;
  onAdd: (hit: SearchHit) => void;
  onOpen: (hit: SearchHit) => void;
  count: number;
}) {
  const virtualizer = useWindowVirtualizer({
    count: results.length,
    estimateSize: () => ROW_H,
    overscan: 8,
  });

  return (
    <div className="virtual-list">
      <div className="result-count">共 {count} 条结果</div>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const hit = results[vi.index]!;
          const key = `${hit.sourceId}:${hit.mangaId}`;
          return (
            <div
              key={vi.key}
              className="virtual-row"
              style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <SearchRow
                hit={hit}
                inLibrary={inLibrary.has(key)}
                adding={adding}
                onAdd={() => onAdd(hit)}
                onOpen={() => onOpen(hit)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SearchRow({
  hit,
  inLibrary,
  adding,
  onAdd,
  onOpen,
}: {
  hit: SearchHit;
  inLibrary: boolean;
  adding: boolean;
  onAdd: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="card search-row" onClick={onOpen} role="button" tabIndex={0}>
      <Cover coverUrl={hit.coverUrl} sourceId={hit.sourceId} title={hit.title} className="search-row-cover" />
      <div className="search-row-info">
        <div className="manga-title">{hit.title}</div>
        <div className="manga-meta">
          <span className="src-tag">{hit.sourceName}</span>
          {hit.author && <span>{hit.author}</span>}
        </div>
      </div>
      <div className="search-row-actions">
        <Button
          size="sm"
          variant={inLibrary ? 'secondary' : 'primary'}
          disabled={inLibrary || adding}
          onClick={(e) => {
            e.stopPropagation();
            if (!inLibrary) onAdd();
          }}
        >
          {inLibrary ? '已在书架' : adding ? '加入中…' : '加入书架'}
        </Button>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          详情
        </Button>
      </div>
    </div>
  );
}
