import { createHttpClient } from '../packages/sources/src/http-client.js';
import { mangadexAdapter } from '../packages/sources/src/mangadex/index.js';

const http = createHttpClient({ userAgent: 'MultManga/0.1.0' });
const ctx = {
  baseUrl: 'https://api.mangadex.org',
  config: {},
  http,
  log: console,
} as const;

const r = await mangadexAdapter.search('葬送的芙莉莲', ctx);
console.log('search hits:', r.length);
for (const m of r.slice(0, 5)) console.log(' -', m.mangaId, '|', m.title, '|', m.author, '|', m.coverUrl?.slice(0, 60));

let withChapters = 0;
for (const m of r.slice(0, 5)) {
  try {
    const detail = await mangadexAdapter.getMangaDetail(m.mangaId, ctx);
    console.log(`detail(${m.title}): chapters=${detail.chapters.length}`);
    if (detail.chapters.length > 0 && withChapters === 0) {
      withChapters = 1;
      const first = detail.chapters[0]!;
      console.log('  first:', JSON.stringify(first));
      const pages = await mangadexAdapter.getPages(first.chapterId, ctx);
      console.log('  pages:', pages.length, 'first url:', pages[0]?.url);
    }
  } catch (e) {
    console.log(`detail(${m.title}) FAILED:`, (e as Error).message);
  }
}
