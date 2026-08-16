import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button, Field, Spinner, Switch } from '../components/ui';
import { useUI } from '../stores/ui';
import type { AppSettings } from '../api/types';

export default function SettingsPage() {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const { data: info } = useQuery({ queryKey: ['info'], queryFn: api.info });

  const [form, setForm] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (settings && !form) setForm(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api.updateSettings(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['info'] });
      toast('success', '设置已保存');
    },
    onError: (e) => toast('error', `保存失败: ${e.message}`),
  });

  if (isLoading || !form) {
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  }

  const set = (patch: Partial<AppSettings>) => setForm((f) => (f ? { ...f, ...patch } : f));

  return (
    <div className="page settings-page">
      <div className="card settings-card">
        <h3>下载与存储</h3>
        <Field label="存储目录" hint="漫画文件保存位置；留空使用默认（服务端 data/library）">
          <input
            className="input full"
            value={form.storageDir}
            placeholder="默认目录"
            onChange={(e) => set({ storageDir: e.target.value })}
          />
        </Field>
        <Field label="下载并发数（同时下载的章节数）">
          <input
            className="input full"
            type="number"
            min={1}
            max={16}
            value={form.concurrency}
            onChange={(e) => set({ concurrency: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="每章节图片并发数" hint="单个章节内同时下载的图片数（默认 5，过大易触发源站限流）">
          <input
            className="input full"
            type="number"
            min={1}
            max={16}
            value={form.pageConcurrency}
            onChange={(e) => set({ pageConcurrency: Number(e.target.value) || 1 })}
          />
        </Field>
        <Field label="下载完成后打包 CBZ">
          <Switch checked={form.cbz} onChange={(v) => set({ cbz: v })} />
        </Field>
        <Field label="User-Agent">
          <input className="input full" value={form.userAgent} onChange={(e) => set({ userAgent: e.target.value })} />
        </Field>
        <Field label="访问令牌（可选）" hint="开启后所有 API 请求需携带 Authorization: Bearer <token>；图片与 SSE 接口豁免。仅建议在不可信网络下开启。">
          <input
            className="input full"
            type="password"
            value={form.accessToken}
            placeholder="留空 = 不启用鉴权"
            onChange={(e) => set({ accessToken: e.target.value })}
          />
        </Field>
        <div className="settings-actions">
          <Button onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending}>
            {saveMut.isPending ? '保存中…' : '保存设置'}
          </Button>
        </div>
      </div>

      {info && (
        <div className="card settings-card">
          <h3>关于</h3>
          <div className="manga-meta">
            {info.name} v{info.version} · 端口 {info.port}
          </div>
          <div className="manga-meta">数据目录：<code>{info.settings.storageDir}</code></div>
          <div className="access-list">
            <div>本机：<a href={`http://localhost:${info.port}`}>http://localhost:{info.port}</a></div>
            {info.lanAddresses.map((ip) => (
              <div key={ip}>
                局域网：<a href={`http://${ip}:${info.port}`}>http://{ip}:{info.port}</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
