// 验证：包子漫画真实下载（https 超时后应回退 http 成功）
const base = 'http://localhost:3088';
const j = async (url, opts) => {
  const r = await fetch(base + url, opts);
  return { status: r.status, body: await r.json().catch(() => null) };
};

const srcs = (await j('/api/sources')).body;
let bz = srcs.find((s) => s.adapterId === 'baozimh');
if (!bz) {
  bz = (await j('/api/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adapterId: 'baozimh' }),
  })).body;
}

const s = await j('/api/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ q: '葬送的芙莉莲', sourceIds: [bz.id] }),
});
const hit = s.body?.results?.[0];
if (!hit) {
  console.log('搜索无结果');
  process.exit(1);
}
const add = await j('/api/library', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sourceId: bz.id, mangaId: hit.mangaId }),
});
const ch = add.body?.chapters?.[0];
console.log('漫画:', add.body?.title, '| 首章:', ch?.title);

const t0 = Date.now();
await j(`/api/library/${add.body.id}/chapters/${ch.id}/download`, { method: 'POST' });
let job;
for (let i = 0; i < 240; i++) {
  job = (await j('/api/downloads')).body.find((x) => x.chapter_id === ch.id);
  if (job && (job.state === 'done' || job.state === 'failed')) break;
  await new Promise((r) => setTimeout(r, 500));
}
console.log('下载:', job?.state, '| progress:', job?.progress, '| 耗时:', Math.round((Date.now() - t0) / 1000) + 's', '| err:', job?.error ?? '无');

// 验证文件落盘
const detail = (await j(`/api/library/${add.body.id}`)).body;
const ch2 = detail.chapters.find((c) => c.id === ch.id);
console.log('章节状态:', ch2?.downloadState, '| pageCount:', ch2?.pageCount, '| localDir:', ch2?.localDir);
if (ch2?.localDir) {
  const files = await (await import('node:fs')).promises.readdir(ch2.localDir);
  console.log('本地文件数:', files.length, '| 前3:', files.slice(0, 3).join(', '));
}

await j(`/api/library/${add.body.id}`, { method: 'DELETE' });
console.log('cleaned');
