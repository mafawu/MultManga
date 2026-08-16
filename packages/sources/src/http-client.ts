import type { HttpClient, Logger } from '@multmanga/core';
import { DEFAULT_USER_AGENT, HTTP_RETRIES, HTTP_TIMEOUT_MS } from '@multmanga/core';

export class HttpError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface HttpClientOptions {
  userAgent?: string;
  timeoutMs?: number;
  retries?: number;
  log?: Logger;
}

/** 判断是否为网络级错误（超时/连接失败/TLS 失败等），而非 HTTP 状态错误 */
function isNetworkError(err: unknown): boolean {
  if (err instanceof HttpError) return false;
  if (err instanceof DOMException) {
    return err.name === 'TimeoutError' || err.name === 'AbortError';
  }
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return true;
  if (typeof e.message === 'string' && /fetch failed/i.test(e.message)) return true;
  const code = e.cause?.code ?? '';
  return [
    'ECONNRESET',
    'ECONNREFUSED',
    'ENOTFOUND',
    'ETIMEDOUT',
    'EPIPE',
    'EPROTO',
    'CERT_HAS_EXPIRED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ].includes(code);
}

/** 已确认 https 不可用、需走 http 的主机（回退成功后记忆，避免每页都等超时） */
const httpFallbackHosts = new Set<string>();

/**
 * 基于 Node 内置 fetch 的 HTTP 客户端：
 * - 统一 User-Agent
 * - 超时（AbortSignal.timeout）
 * - 网络错误/5xx 自动重试（指数退避）
 * - HTTPS 网络级失败时自动回退 HTTP，并记忆该主机（部分 CDN 在特定网络下 HTTPS 挂起而 HTTP 可用）
 * - 支持调用方传入任意请求头（防盗链等）
 */
export function createHttpClient(opts: HttpClientOptions = {}): HttpClient {
  const userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  const defaultTimeout = opts.timeoutMs ?? HTTP_TIMEOUT_MS;
  const maxRetries = opts.retries ?? HTTP_RETRIES;
  const log = opts.log ?? console;

  async function request(
    url: string,
    headers: Record<string, string> | undefined,
    timeoutMs: number,
    retries: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      /* ignore */
    }

    // 学习到该主机 https 不可用 → 直接走 http
    if (host && httpFallbackHosts.has(host) && url.startsWith('https://')) {
      url = `http://${url.slice(8)}`;
    }

    const fetchOnce = (u: string) =>
      fetch(u, {
        headers: {
          'User-Agent': userAgent,
          Accept: 'application/json, text/plain, */*',
          ...headers,
        },
        redirect: 'follow',
        // 组合超时信号与外部取消信号：任一触发即中断在途请求
        signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
      });

    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchOnce(url);
        if (res.status >= 500 && attempt < retries) {
          throw new HttpError(`HTTP ${res.status} ${res.statusText}`, res.status);
        }
        return res;
      } catch (err) {
        // 外部取消信号已触发 → 立即抛出，不重试也不回退
        if (signal?.aborted) throw err;
        // https 网络级失败 → 立即回退 http 一次（成功则记住该主机，后续直接走 http）
        if (isNetworkError(err) && url.startsWith('https://')) {
          const httpUrl = `http://${url.slice(8)}`;
          try {
            const res = await fetchOnce(httpUrl);
            if (host) httpFallbackHosts.add(host);
            log.warn?.(`https 失败，回退 http 成功: ${httpUrl}`);
            return res;
          } catch {
            // 回退失败：保持原 url，进入正常重试流程
          }
        }
        lastErr = err;
        if (attempt < retries) {
          const delay = 300 * 2 ** attempt;
          log.warn?.(`http 重试 ${attempt + 1}/${retries}: ${url} (${(err as Error).message}), ${delay}ms 后重试`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    if (lastErr instanceof Error) throw lastErr;
    throw new Error(String(lastErr));
  }

  return {
    async getJson<T = unknown>(url: string, headers: Record<string, string> | undefined, timeoutMs = defaultTimeout) {
      const res = await request(url, headers, timeoutMs, maxRetries);
      if (!res.ok) throw new HttpError(`GET ${url} -> ${res.status} ${res.statusText}`, res.status);
      return (await res.json()) as T;
    },
    async getText(url, headers, timeoutMs = defaultTimeout) {
      const res = await request(url, headers, timeoutMs, maxRetries);
      if (!res.ok) throw new HttpError(`GET ${url} -> ${res.status} ${res.statusText}`, res.status);
      return res.text();
    },
    async getBuffer(url, headers, timeoutMs = defaultTimeout, signal) {
      const res = await request(url, headers, timeoutMs, maxRetries, signal);
      if (!res.ok) throw new HttpError(`GET ${url} -> ${res.status} ${res.statusText}`, res.status);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
