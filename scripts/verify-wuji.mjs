// 最终验证：包子漫画 + 武芊漫画 完整流程（含下载一章）
const base = 'http://localhost:3088';
const j = async (url, opts) => {
  const r = await fetch(base + url, opts);
  const b = await r.json().catch(() => null);
  return { status: r.status, body: b };
};

async function runSource(adapterId, query) {
  console.log(`\n===== ${adapterId} =====`);
  const created = await j('/api/sources', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ adapterId }),
  });
  const srcId = created.body?.id;
  console.log('create:', created.status, created.body?.name);

  const t = await j(`/api/sources/${srcId}/test`, { method: 'POST' });
  console.log('test:', JSON.stringify(t.body));

  const s = await j('/api/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: query, sourceIds: [srcId] }),
  });
  const hit = s.body?.results?.[0];
  console.log('search:', s.body?.count, 'hits | first:', hit ? `${hit.title}` : '无');
  if (!hit) {
    await j(`/api/sources/${srcId}`, { method: 'DELETE' });
    return;
  }

  const add = await j('/api/library', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceId: srcId, mangaId: hit.mangaId }),
  });
  const libId = add.body?.id;
  const ch = add.body?.chapters?.[0];
  console.log('add library:', add.status, '| chapters:', add.body?.chapters?.length, '| 首章:', ch?.title);

  if (ch) {
    const pages = await j(`/api/chapters/${ch.id}/pages`);
    console.log('pages endpoint:', pages.status, pages.body?.mode, '| count:', pages.body?.pages?.length);

    await j(`/api/library/${libId}/chapters/${ch.id}/download`, { method: 'POST' });
    let job;
    for (let i = 0; i < 60; i++) {
      job = (await j('/api/downloads')).body.find((x) => x.chapter_id === ch.id);
      if (job && (job.state === 'done' || job.state === 'failed')) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log('download:', job?.state, '| progress:', job?.progress, '| err:', job?.error ?? '无');
  }

  await j(`/api/sources/${srcId}`, { method: 'DELETE' });
  await j(`/api/library/${libId}`, { method: 'DELETE' });
  console.log('cleaned');
}

await runSource('baozimh', '葬送的芙莉莲');
await runSource('wuqian', '爱神');
