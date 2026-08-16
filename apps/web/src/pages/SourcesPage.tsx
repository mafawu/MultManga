import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Badge, Button, Field, Modal, Spinner, Switch } from '../components/ui';
import { useUI } from '../stores/ui';
import type { AdapterInfo, ConfigField, SourceItem } from '../api/types';

interface FormState {
  adapterId: string;
  name: string;
  baseUrl: string;
  config: Record<string, string | number | boolean>;
}

export default function SourcesPage() {
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const { data: sources, isLoading } = useQuery({ queryKey: ['sources'], queryFn: api.sources });
  const { data: adapters } = useQuery({ queryKey: ['adapters'], queryFn: api.adapters });

  const [editing, setEditing] = useState<SourceItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<SourceItem | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['sources'] });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.updateSource(id, { enabled }),
    onSuccess: () => {
      invalidate();
      toast('success', '已更新');
    },
    onError: (e) => toast('error', e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteSource(id),
    onSuccess: () => {
      invalidate();
      toast('success', '源已删除');
      setDeleting(null);
    },
    onError: (e) => toast('error', `删除失败: ${e.message}`),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => api.testSource(id),
    onSuccess: (r) => (r.ok ? toast('success', `连接正常：${r.message}`) : toast('error', `连接失败：${r.message}`)),
    onError: (e) => toast('error', `测试失败: ${e.message}`),
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
        <h2>网站源</h2>
        <Button onClick={() => setCreating(true)}>添加源</Button>
      </div>

      {(sources ?? []).length === 0 ? (
        <div className="notice">还没有任何源，点击「添加源」开始。</div>
      ) : (
        <div className="source-list">
          {(sources ?? []).map((s) => (
            <div key={s.id} className="card source-row">
              <div className="source-main">
                <div className="source-name">
                  {s.name}
                  <Badge color="gray">v{(adapters ?? []).find((a) => a.id === s.adapterId)?.version ?? '?'}</Badge>
                </div>
                <div className="manga-meta">
                  {s.adapterId} · <code>{s.baseUrl}</code>
                </div>
              </div>
              <div className="source-actions">
                <Button size="sm" variant="ghost" onClick={() => testMut.mutate(s.id)} disabled={testMut.isPending}>
                  测试
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                  编辑
                </Button>
                <Button size="sm" variant="danger" onClick={() => setDeleting(s)}>
                  删除
                </Button>
                <Switch checked={s.enabled} onChange={(v) => toggleMut.mutate({ id: s.id, enabled: v })} />
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <SourceFormModal
          adapters={adapters ?? []}
          initial={editing ?? undefined}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            invalidate();
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <Modal
          title="删除源"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                取消
              </Button>
              <Button variant="danger" onClick={() => deleteMut.mutate(deleting.id)} disabled={deleteMut.isPending}>
                确认删除
              </Button>
            </>
          }
        >
          <p>
            确定删除源「{deleting.name}」？其下所有书架条目、下载的章节文件与进度将一并删除（{deleting.baseUrl}）。
          </p>
        </Modal>
      )}
    </div>
  );
}

function SourceFormModal({
  adapters,
  initial,
  onClose,
  onSaved,
}: {
  adapters: AdapterInfo[];
  initial?: SourceItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useUI((s) => s.toast);
  const adapter = useMemo(
    () => adapters.find((a) => a.id === (initial?.adapterId ?? '')) ?? adapters[0],
    [adapters, initial?.adapterId],
  );
  const [form, setForm] = useState<FormState>(() => {
    if (initial) {
      return {
        adapterId: initial.adapterId,
        name: initial.name,
        baseUrl: initial.baseUrl,
        config: initial.config as Record<string, string | number | boolean>,
      };
    }
    return {
      adapterId: adapter?.id ?? '',
      name: adapter?.name ?? '',
      baseUrl: adapter?.defaultBaseUrl ?? '',
      config: defaultsOf(adapter),
    };
  });

  useEffect(() => {
    if (initial) return;
    const a = adapters.find((x) => x.id === form.adapterId) ?? adapters[0];
    if (a) {
      setForm((f) => ({ ...f, name: a.name, baseUrl: a.defaultBaseUrl ?? '', config: defaultsOf(a) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.adapterId]);

  const saveMut = useMutation({
    mutationFn: () =>
      initial
        ? api.updateSource(initial.id, { name: form.name, baseUrl: form.baseUrl, config: form.config })
        : api.createSource({ adapterId: form.adapterId, name: form.name, baseUrl: form.baseUrl, config: form.config }),
    onSuccess: () => {
      toast('success', initial ? '源已更新' : '源已添加');
      onSaved();
    },
    onError: (e) => toast('error', `保存失败: ${e.message}`),
  });

  const testMut = useMutation({
    mutationFn: () => api.testSource(initial?.id ?? '__preview__'),
    onSuccess: () => toast('success', '当前保存的源连接正常'),
    onError: () => {
      /* 预览时忽略 */
    },
  });

  const setConfig = (key: string, value: string | number | boolean) =>
    setForm((f) => ({ ...f, config: { ...f.config, [key]: value } }));

  const schema = adapter?.configSchema ?? [];

  return (
    <Modal
      title={initial ? `编辑源：${initial.name}` : '添加网站源'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant="secondary" onClick={() => testMut.mutate()} disabled={!initial || testMut.isPending}>
            测试连接
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.baseUrl}>
            {saveMut.isPending ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      {!initial && (
        <Field label="适配器">
          <select className="select full" value={form.adapterId} onChange={(e) => setForm((f) => ({ ...f, adapterId: e.target.value }))}>
            {adapters.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}（{a.description ?? a.id}）
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="名称">
        <input className="input full" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="API 地址（baseUrl）">
        <input
          className="input full"
          value={form.baseUrl}
          placeholder={adapter?.defaultBaseUrl}
          onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
        />
      </Field>
      {schema.map((f) => (
        <ConfigFieldInput key={f.key} field={f} value={form.config[f.key]} onChange={(v) => setConfig(f.key, v)} />
      ))}
    </Modal>
  );
}

function ConfigFieldInput({
  field,
  value,
  onChange,
}: {
  field: ConfigField;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  const v = value ?? field.default ?? '';
  return (
    <Field label={field.label} hint={field.help}>
      {field.type === 'boolean' ? (
        <Switch checked={Boolean(v)} onChange={onChange} />
      ) : field.type === 'select' ? (
        <select className="select full" value={String(v)} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input full"
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(v)}
          onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
        />
      )}
    </Field>
  );
}

function defaultsOf(a?: AdapterInfo): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const f of a?.configSchema ?? []) {
    if (f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}
