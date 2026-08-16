/**
 * 任务级取消信号（借鉴 Breeze 的 DownloadCancelSignal 设计，落地为 AbortController）。
 *
 * worker 处理任务时通过 getJobAbortSignal 取得该任务的信号并传入 HTTP 请求；
 * queue.cancel() 调用 abortJob 触发 abort，在途请求立即中断（AbortError），
 * worker 据此识别为“任务取消”而非下载失败，不会回写 failed 状态。
 */
const controllers = new Map<string, AbortController>();

/** 取任务的取消信号（首次调用时创建；处理任务期间保持有效） */
export function getJobAbortSignal(jobId: string): AbortSignal {
  let c = controllers.get(jobId);
  if (!c) {
    c = new AbortController();
    controllers.set(jobId, c);
  }
  return c.signal;
}

/** 触发任务取消；返回是否真的有在途任务被中断 */
export function abortJob(jobId: string): boolean {
  const c = controllers.get(jobId);
  if (!c) return false;
  c.abort();
  return true;
}

/** 任务处理结束（无论成功/失败/取消）时释放信号，避免 Map 泄漏 */
export function releaseJobAbort(jobId: string): void {
  controllers.delete(jobId);
}
