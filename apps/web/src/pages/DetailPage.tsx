import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Badge, Button, Cover, DownloadStateBadge, Modal, Progress, Spinner } from '../components/ui';
import { useUI } from '../stores/ui';
import type { LibraryChapter } from '../api/types';

type ChFilter = 'all' | 'unread' | 'undownloaded';

const PREFS_KEY = 'mm-detail-prefs';

function loadPrefs(): { filter: ChFilter; asc: boolean } {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { filter?: ChFilter; asc?: boolean };
      return { filter: p.filter ?? 'all', asc: p.asc ?? true };
    }
  } catch {
    /* ignore */
  }
  return { filter: 'all', asc: true };
}

function isUnreadCh(c: { pageIndex?: number | null; pageCount?: number | null }): boolean {
  return c.pageIndex == null || c.pageCount == null || c.pageIndex < c.pageCount - 1;
}

export default function DetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [chFilter, setChFilter] = useState<ChFilter>(() => loadPrefs().filter);
  const [chAsc, setChAsc] = useState<boolean>(() => loadPrefs().asc);
  /** 乐观状态：点击下载的瞬间被标记为“下载中”的章节 id（不等服务端刷新） */
  const [optimisticIds, setOptimisticIds] = useState<Set<string>>(new Set());

  const savePrefs = (filter: ChFilter, asc: boolean) => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ filter, asc }));
  };

  const markOptimistic = (ids: string[]) => {
    setOptimisticIds((prev) => {
      const next = new Set(prev);
      for (const i of ids) next.add(i);
      return next;
    });
  };

  const clearOptimistic = (ids: string[]) => {
    setOptimisticIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set(prev);
      for (const i of ids) next.delete(i);
      return next.size === prev.size ? prev : next;
    });
  };

  const { data: detail, isLoading } = useQuery({
    queryKey: ['library', id],
    queryFn: () => api.libraryDetail(id!),
    enabled: !!id,
  });
  const { data: jobs } = useQuery({ queryKey: ['downloads'], queryFn: api.downloads, refetchInterval: 3000 });

  // 服务端任务列表刷新后，凡已有 job 记录的章节都不再需要乐观标记（由真实状态接管）
  useEffect(() => {
    if (!jobs || jobs.length === 0) return;
    setOptimisticIds((prev) => {
      if (prev.size === 0) return prev;
      const withJob = new Set(jobs.map((j) => j.chapterId));
      let changed = false;
      const next = new Set(prev);
      for (const chId of prev) {
        if (withJob.has(chId)) {
          next.delete(chId);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [jobs]);

  const visibleChapters = useMemo(() => {
    let list = detail?.chapters ?? [];
    if (chFilter === 'unread') list = list.filter((c) => isUnreadCh(c));
    if (chFilter === 'undownloaded') list = list.filter((c) => c.downloadState !== 'done');
    // 排序键：优先章节原始顺序号，其次章节号，无编号章节排最后
    const key = (c: LibraryChapter) => c.chapterOrder ?? c.chapterNumber ?? Number.MAX_SAFE_INTEGER;
    return [...list].sort((a, b) => (key(a) - key(b)) * (chAsc ? 1 : -1));
  }, [detail, chFilter, chAsc]);

  const jobByChapter = useMemo(() => {
    const m = new Map<string, { progress: number; state: string; id: string; error?: string | null }>();
    for (const j of jobs ?? []) m.set(j.chapterId, j);
    return m;
  }, [jobs]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['library'] });
    qc.invalidateQueries({ queryKey: ['downloads'] });
  };

  const downloadMut = useMutation({
    mutationFn: (ch: LibraryChapter) => api.downloadChapter(detail!.id, ch.id),
    onMutate: (ch) => markOptimistic([ch.id]),
    onSuccess: () => {
      invalidate();
      toast('success', '已加入下载队列');
    },
    onError: (e, ch) => {
      clearOptimistic([ch.id]);
      toast('error', `下载失败: ${e.message}`);
    },
  });

  const downloadAllMut = useMutation({
    mutationFn: (chs: LibraryChapter[]) => Promise.all(chs.map((c) => api.downloadChapter(detail!.id, c.id))),
    onMutate: (chs) => markOptimistic(chs.map((c) => c.id)),
    onSuccess: () => {
      invalidate();
      toast('success', '全部章节已加入下载队列');
    },
    onError: (e) => {
      clearOptimistic(detail?.chapters.map((c) => c.id) ?? []);
      toast('error', `下载失败: ${e.message}`);
    },
  });

  const refreshMut = useMutation({
    mutationFn: () => api.refreshLibrary(detail!.id),
    onSuccess: () => {
      invalidate();
      toast('success', '章节已刷新');
    },
    onError: (e) => toast('error', `刷新失败: ${e.message}`),
  });

  const deleteChapterMut = useMutation({
    mutationFn: (chapterId: string) => api.deleteChapter(chapterId),
    onSuccess: () => {
      invalidate();
      toast('success', '已删除章节文件');
    },
    onError: (e) => toast('error', `删除失败: ${e.message}`),
  });

  const deleteLibraryMut = useMutation({
    mutationFn: () => api.deleteLibrary(detail!.id),
    onSuccess: () => {
      toast('success', '已从书架移除');
      qc.invalidateQueries({ queryKey: ['library'] });
      window.location.href = '/';
    },
    onError: (e) => toast('error', `删除失败: ${e.message}`),
  });

  if (isLoading) {
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  }
  if (!detail) return <div className="notice error">书架条目不存在</div>;

  const pending = detail.chapters.filter(
    (c) => c.downloadState !== 'done' && c.downloadState !== 'failed' && !optimisticIds.has(c.id),
  );

  return (
    <div className="page">
      <div className="detail-head card">
        <Cover coverUrl={detail.coverUrl} sourceId={detail.sourceId} title={detail.title} className="detail-cover" />
        <div className="detail-info">
          <h2>{detail.title}</h2>
          <div className="manga-meta">
            <Badge color="blue">{detail.sourceName}</Badge>
            {detail.author && <span>{detail.author}</span>}
            {detail.status && <span>{detail.status}</span>}
          </div>
          <div className="manga-meta">
            共 {detail.chapterCount} 章 · 已下载 {detail.downloadedCount} · 未读 {detail.unreadCount}
          </div>
          {detail.description && <p className="detail-desc">{detail.description}</p>}
          <div className="detail-actions">
            <Button
              onClick={() => pending.length > 0 && downloadAllMut.mutate(pending)}
              disabled={pending.length === 0 || downloadAllMut.isPending}
            >
              {downloadAllMut.isPending ? '加入队列中…' : `下载全部（${pending.length}）`}
            </Button>
            <Button variant="secondary" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
              刷新章节
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              移除书架
            </Button>
          </div>
        </div>
      </div>

      <div className="toolbar">
        <h2 className="section-title">章节列表</h2>
        <select
          className="select"
          value={chFilter}
          onChange={(e) => {
            const v = e.target.value as ChFilter;
            setChFilter(v);
            savePrefs(v, chAsc);
          }}
        >
          <option value="all">全部章节</option>
          <option value="unread">仅未读</option>
          <option value="undownloaded">仅未下载</option>
        </select>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setChAsc(!chAsc);
            savePrefs(chFilter, !chAsc);
          }}
          title="切换章节排序方向"
        >
          {chAsc ? '↑ 正序' : '↓ 倒序'}
        </Button>
        <span className="result-count">
          显示 {visibleChapters.length}/{detail.chapterCount} 章
        </span>
      </div>

      <div className="chapter-list">
        {detail.chapters.length === 0 && <div className="notice">该漫画暂无可读章节（可能所选语言下没有翻译）。</div>}
        {visibleChapters.length === 0 && detail.chapters.length > 0 && (
          <div className="notice">没有匹配当前筛选条件的章节。</div>
        )}
        {visibleChapters.map((c) => {
          const job = jobByChapter.get(c.id);
          const active = job && (job.state === 'queued' || job.state === 'running' || job.state === 'paused');
          // 乐观状态：点击瞬间标记为下载中（服务端 job 出现前生效）
          const optimistic = optimisticIds.has(c.id);
          const busy = optimistic || !!active;
          const badgeState = optimistic ? 'downloading' : c.downloadState;
          return (
            <div key={c.id} className="card chapter-row">
              <div className="chapter-main">
                <Link to={`/library/${detail.id}/reader/${c.id}`} className="chapter-title">
                  {c.title}
                </Link>
                <div className="chapter-meta">
                  <DownloadStateBadge state={badgeState} />
                  {c.pageCount ? (
                    <span>
                      已读 {Math.min(c.pageIndex ?? 0, c.pageCount)}/{c.pageCount}
                    </span>
                  ) : c.pageIndex != null ? (
                    <span>已读至第 {c.pageIndex + 1} 页</span>
                  ) : null}
                  {job?.error && <span className="err-text">{job.error}</span>}
                </div>
                {busy && (
                  <div className="chapter-progress">
                    <Progress value={job?.progress ?? 0} />
                  </div>
                )}
              </div>
              <div className="chapter-actions">
                {optimistic ? (
                  // 点击瞬间：仅被点击章节立即变为下载中，其余章节按钮不受影响
                  <Button size="sm" disabled>
                    下载中…
                  </Button>
                ) : c.downloadState === 'done' ? (
                  <>
                    <Link to={`/library/${detail.id}/reader/${c.id}`}>
                      <Button size="sm">阅读</Button>
                    </Link>
                    {job?.error && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => downloadMut.mutate(c)}
                      >
                        补下失败页
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleteChapterMut.isPending}
                      onClick={() => deleteChapterMut.mutate(c.id)}
                    >
                      {deleteChapterMut.isPending ? '删除中…' : '删除文件'}
                    </Button>
                  </>
                ) : c.downloadState === 'failed' ? (
                  <>
                    <Button size="sm" onClick={() => downloadMut.mutate(c)}>
                      重试下载
                    </Button>
                    <Link to={`/library/${detail.id}/reader/${c.id}`}>
                      <Button size="sm" variant="ghost">
                        在线阅读
                      </Button>
                    </Link>
                  </>
                ) : (
                  <>
                    {!active && (
                      <Button size="sm" onClick={() => downloadMut.mutate(c)}>
                        下载
                      </Button>
                    )}
                    <Link to={`/library/${detail.id}/reader/${c.id}`}>
                      <Button size="sm" variant="ghost">
                        在线阅读
                      </Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {confirmDelete && (
        <Modal
          title="移除书架"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                取消
              </Button>
              <Button variant="danger" onClick={() => deleteLibraryMut.mutate()} disabled={deleteLibraryMut.isPending}>
                确认移除（含本地文件）
              </Button>
            </>
          }
        >
          <p>
            确定将「{detail.title}」移出书架？其所有下载的章节文件与阅读进度将被删除。
          </p>
        </Modal>
      )}
    </div>
  );
}
