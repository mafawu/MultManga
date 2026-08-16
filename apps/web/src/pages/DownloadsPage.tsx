import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Badge, Button, EmptyState, JOB_TEXT, Progress, Spinner } from '../components/ui';
import { useUI } from '../stores/ui';
import type { DownloadJob } from '../api/types';

const JOB_COLOR: Record<DownloadJob['state'], 'gray' | 'green' | 'red' | 'accent' | 'blue'> = {
  queued: 'blue',
  running: 'accent',
  paused: 'gray',
  canceled: 'gray',
  failed: 'red',
  done: 'green',
};

/** 任务是否带“失败页可补下”状态（done 但存在失败页） */
function hasFailedPages(j: DownloadJob): boolean {
  return j.state === 'done' && !!j.error && (j.failedPages ?? '') !== '';
}

export default function DownloadsPage() {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const { data, isLoading } = useQuery({ queryKey: ['downloads'], queryFn: api.downloads, refetchInterval: 1500 });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['downloads'] });
    qc.invalidateQueries({ queryKey: ['library'] });
  };

  const actionMut = useMutation({
    mutationFn: ({ jobId, action }: { jobId: string; action: 'pause' | 'resume' | 'cancel' | 'retry' }) =>
      api.jobAction(jobId, action),
    onSuccess: () => {
      invalidate();
      toast('success', '操作成功');
    },
    onError: (e) => toast('error', `操作失败: ${e.message}`),
  });

  const deleteMut = useMutation({
    mutationFn: (jobId: string) => api.deleteJob(jobId),
    onSuccess: () => {
      invalidate();
      toast('success', '已删除下载任务');
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

  const jobs = data ?? [];
  const active = jobs.filter((j) => j.state === 'queued' || j.state === 'running').length;

  return (
    <div className="page">
      <div className="toolbar">
        <h2>下载任务</h2>
        {active > 0 && <Badge color="accent">{active} 个进行中</Badge>}
      </div>

      {jobs.length === 0 ? (
        <EmptyState title="暂无下载任务" hint="在漫画详情页点击「下载」即可加入队列" />
      ) : (
        <div className="job-list">
          {jobs.map((j) => (
            <div key={j.id} className="card job-row">
              <div className="job-main">
                <div className="job-title">
                  <Link to={`/library/${j.libraryId}`} className="job-manga">
                    {j.mangaTitle}
                  </Link>
                  <span className="job-sep">·</span>
                  <Link to={`/library/${j.libraryId}/reader/${j.chapterId}`} className="job-chapter">
                    {j.chapterTitle}
                  </Link>
                </div>
                <div className="job-meta">
                  <Badge color={JOB_COLOR[j.state]}>{JOB_TEXT[j.state]}</Badge>
                  {j.state !== 'done' && <span>{j.progress}%</span>}
                  {j.pagesTotal != null && (
                    <span className="job-pages">
                      {j.pagesDone ?? 0}/{j.pagesTotal} 页
                    </span>
                  )}
                </div>
                {j.error && <div className="err-text">{j.error}</div>}
                {(j.state === 'queued' || j.state === 'running' || j.state === 'paused') && (
                  <Progress value={j.progress} />
                )}
              </div>
              <div className="job-actions">
                {j.state === 'queued' || j.state === 'running' ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => actionMut.mutate({ jobId: j.id, action: 'pause' })}>
                      暂停
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => actionMut.mutate({ jobId: j.id, action: 'cancel' })}>
                      取消
                    </Button>
                  </>
                ) : j.state === 'paused' ? (
                  <>
                    <Button size="sm" onClick={() => actionMut.mutate({ jobId: j.id, action: 'resume' })}>
                      继续
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => actionMut.mutate({ jobId: j.id, action: 'cancel' })}>
                      取消
                    </Button>
                  </>
                ) : j.state === 'failed' ? (
                  <Button size="sm" onClick={() => actionMut.mutate({ jobId: j.id, action: 'retry' })}>
                    重试
                  </Button>
                ) : hasFailedPages(j) ? (
                  <Button size="sm" onClick={() => actionMut.mutate({ jobId: j.id, action: 'retry' })}>
                    补下失败页
                  </Button>
                ) : j.state === 'done' ? (
                  <Link to={`/library/${j.libraryId}/reader/${j.chapterId}`}>
                    <Button size="sm">打开阅读</Button>
                  </Link>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deleteMut.isPending}
                  onClick={() => deleteMut.mutate(j.id)}
                >
                  {deleteMut.isPending ? '删除中…' : '删除'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
