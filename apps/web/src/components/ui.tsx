import { useEffect, type ReactNode } from 'react';
import { useUI } from '../stores/ui';
import type { ChapterDownloadState, DownloadJobState } from '../api/types';

/* ---------- Button ---------- */
export function Button({
  variant = 'primary',
  size = 'md',
  disabled,
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}) {
  return (
    <button
      className={`btn btn-${variant} btn-${size} ${className}`}
      disabled={disabled}
      {...rest}
    />
  );
}

/* ---------- Badge ---------- */
export function Badge({
  color = 'gray',
  children,
}: {
  color?: 'gray' | 'green' | 'red' | 'accent' | 'blue';
  children: ReactNode;
}) {
  return <span className={`badge badge-${color}`}>{children}</span>;
}

const DOWNLOAD_BADGE: Record<ChapterDownloadState, { color: 'gray' | 'green' | 'red' | 'accent' | 'blue'; text: string }> = {
  none: { color: 'gray', text: '未下载' },
  queued: { color: 'blue', text: '排队中' },
  downloading: { color: 'accent', text: '下载中' },
  done: { color: 'green', text: '已下载' },
  failed: { color: 'red', text: '失败' },
};

export function DownloadStateBadge({ state }: { state: ChapterDownloadState }) {
  const b = DOWNLOAD_BADGE[state] ?? DOWNLOAD_BADGE.none;
  return <Badge color={b.color}>{b.text}</Badge>;
}

export const JOB_TEXT: Record<DownloadJobState, string> = {
  queued: '排队中',
  running: '下载中',
  paused: '已暂停',
  canceled: '已取消',
  failed: '失败',
  done: '完成',
};

/* ---------- Switch ---------- */
export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`switch ${checked ? 'on' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" />
    </button>
  );
}

/* ---------- Progress ---------- */
export function Progress({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  return (
    <div className="progress">
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---------- Spinner ---------- */
export function Spinner({ size = 22 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

/* ---------- EmptyState ---------- */
export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">📚</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

/* ---------- Modal ---------- */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Toaster ---------- */
export function Toaster() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="toaster">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-text" onClick={() => dismiss(t.id)}>
            {t.text}
          </span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.fn();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- Cover ---------- */
export function Cover({
  coverUrl,
  sourceId,
  title,
  className = '',
}: {
  coverUrl?: string | null;
  sourceId?: string;
  title: string;
  className?: string;
}) {
  const src = coverUrl ? (sourceId ? `/api/proxy?url=${encodeURIComponent(coverUrl)}&sourceId=${sourceId}` : coverUrl) : undefined;
  return (
    <div className={`cover ${className}`}>
      {src ? (
        <img src={src} alt={title} loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      ) : null}
      {!src && <span className="cover-fallback">{title.slice(0, 1)}</span>}
    </div>
  );
}

/* ---------- 表单字段 ---------- */
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
