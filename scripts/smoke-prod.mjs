(async () => {
  const base = 'http://localhost:3088';
  const root = await fetch(base + '/');
  const html = await root.text();
  console.log('1. / ->', root.status, root.headers.get('content-type'), '| has root div:', html.includes('id="root"'));

  const spa = await fetch(base + '/library/abc-123/reader/xyz');
  const spaHtml = await spa.text();
  console.log('2. SPA fallback /library/... ->', spa.status, spa.headers.get('content-type'), '| has root div:', spaHtml.includes('id="root"'));

  const asset = await fetch(base + '/assets/index-oJcU8jVF.js');
  console.log('3. asset ->', asset.status, asset.headers.get('content-type'));

  const info = await (await fetch(base + '/api/info')).json();
  console.log('4. api/info ->', info.name, info.version, '| lan:', info.lanAddresses.join(','));

  const notFound = await fetch(base + '/api/nope');
  console.log('5. api 404 ->', notFound.status);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
