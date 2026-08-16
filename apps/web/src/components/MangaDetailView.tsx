import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Badge, Button, Cover, Spinner } from './ui';
import { useUI } from '../stores/ui';

/** 在线漫画详情视图（搜索结果详情侧边栏与独立详情页共用） */
export default function MangaDetailView({
  sourceId,
  mangaId,
  compact = false,
  onOpenFull,
  onClose,
}: {
  sourceId: string;
  mangaId: string;
  compact?: boolean;
  /** 提供时显示「进入详情页」按钮 */
  onOpenFull?: () => void;
  /** 提供时显示关闭/返回按钮 */
  onClose?: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['manga', sourceId, mangaId],
    queryFn: () => api.mangaDetail(sourceId, mangaId),
    enabled: !!sourceId && !!mangaId,
  });

  const { data: library } = useQuery({ queryKey: ['library'], queryFn: api.library });
  const inLibraryItem = useMemo(
    () => (library ?? []).find((i) => i.sourceId === sourceId && i.mangaId === mangaId),
    [library, sourceId, mangaId],
  );

  const addMut = useMutation({
    mutationFn: () => api.addToLibrary(sourceId, mangaId),
    onSuccess: (detail) => {
      qc.invalidateQueries({ queryKey: ['library'] });
      toast('success', '已加入书架');
      navigate(`/library/${detail.id}`);
    },
    onError: (e) => toast('error', `加入失败: ${e.message}`),
  });

  if (isLoading) {
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  }
  if (isError || !data) {
    return <div className="notice error">加载详情失败：{error instanceof Error ? error.message : String(error)}</div>;
  }

  return (
    <div className={`manga-detail-view ${compact ? 'compact' : ''}`}>
      <div className="detail-head card">
        <Cover coverUrl={data.coverUrl} sourceId={data.sourceId} title={data.title} className="detail-cover" />
        <div className="detail-info">
          <h2>{data.title}</h2>
          <div className="manga-meta">
            <Badge color="blue">{data.sourceName}</Badge>
            {data.author && <span>{data.author}</span>}
            {data.status && <span>{data.status}</span>}
          </div>
          <div className="manga-meta">共 {data.chapters.length} 章（在线预览，加入书架后可下载）</div>
          {data.description && <p className="detail-desc">{data.description}</p>}
          <div className="detail-actions">
            {inLibraryItem ? (
              <Button onClick={() => navigate(`/library/${inLibraryItem.id}`)}>前往书架</Button>
            ) : (
              <Button onClick={() => addMut.mutate()} disabled={addMut.isPending}>
                {addMut.isPending ? '加入中…' : '加入书架'}
              </Button>
            )}
            {onOpenFull && (
              <Button variant="secondary" onClick={onOpenFull}>
                进入详情页
              </Button>
            )}
            {onClose && (
              <Button variant="ghost" onClick={onClose}>
                关闭
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="chapter-list">
        {data.chapters.length === 0 && <div className="notice">该漫画暂无可读章节。</div>}
        {data.chapters.map((c, i) => (
          <div key={c.chapterId} className="card chapter-row">
            <div className="chapter-main">
              <span className="chapter-title">
                {c.chapterNumber != null ? `第 ${c.chapterNumber} 话` : `第 ${i + 1} 话`}
                {c.title && c.title !== String(c.chapterNumber) ? ` ${c.title}` : ''}
              </span>
              <div className="chapter-meta">
                <Badge color="gray">在线</Badge>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
