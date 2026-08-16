const path = '/scomic/zangsongdefulilian-shantianzhongrenabetukasa/0/0-ekr4/1.jpg';
const variants = [
  `https://s1.bzcdn.net${path}`,
  `http://s1.bzcdn.net${path}`,
  `https://-mha1-nlams.bzcdn.net${path}`,
  `https://static-tw.baozimhcn.com${path}`,
  `https://cn.baozimhcn.com${path}`,
];
const referers = [undefined, 'https://cn.baozimhcn.com/', 'https://cn.dzmanga.com/'];

for (const v of variants) {
  for (const ref of referers) {
    try {
      const r = await fetch(v, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', ...(ref ? { Referer: ref } : {}) },
        signal: AbortSignal.timeout(12000),
      });
      const len = (await r.arrayBuffer()).byteLength;
      console.log(v.slice(0, 70), ref ? `ref=${ref.slice(8, 25)}` : 'no-ref', '->', r.status, len > 0 ? len + 'B' : '');
    } catch (e) {
      console.log(v.slice(0, 70), ref ? `ref=${ref.slice(8, 25)}` : 'no-ref', '-> ERR', e.cause?.code ?? e.message);
    }
  }
}
