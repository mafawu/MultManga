import { create } from 'zustand';

export type ShelfSort = 'updated' | 'added' | 'title' | 'recent';
export type ShelfDir = 'asc' | 'desc';

const PREFS_KEY = 'mm-library-prefs';

interface Prefs {
  q: string;
  source: string;
  unreadOnly: boolean;
  undownloadedOnly: boolean;
  sort: ShelfSort;
  dir: ShelfDir;
}

function loadPrefs(): Prefs {
  const def: Prefs = {
    q: '',
    source: 'all',
    unreadOnly: false,
    undownloadedOnly: false,
    sort: 'updated',
    dir: 'desc',
  };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return def;
    return { ...def, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return def;
  }
}

interface LibraryState extends Prefs {
  scrollY: number;
  setQ: (q: string) => void;
  setSource: (s: string) => void;
  setUnreadOnly: (v: boolean) => void;
  setUndownloadedOnly: (v: boolean) => void;
  setSort: (s: ShelfSort) => void;
  setDir: (d: ShelfDir) => void;
  setScrollY: (y: number) => void;
  restoreScrollY: () => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => {
  const prefs = loadPrefs();
  const persist = (patch: Partial<Prefs>) => {
    const next = { ...get(), ...patch };
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        q: next.q,
        source: next.source,
        unreadOnly: next.unreadOnly,
        undownloadedOnly: next.undownloadedOnly,
        sort: next.sort,
        dir: next.dir,
      }),
    );
    set(patch);
  };
  return {
    ...prefs,
    scrollY: 0,
    setQ: (q) => persist({ q }),
    setSource: (source) => persist({ source }),
    setUnreadOnly: (unreadOnly) => persist({ unreadOnly }),
    setUndownloadedOnly: (undownloadedOnly) => persist({ undownloadedOnly }),
    setSort: (sort) => persist({ sort }),
    setDir: (dir) => persist({ dir }),
    setScrollY: (scrollY) => set({ scrollY }),
    restoreScrollY: () => {
      const y = get().scrollY;
      if (y > 0) {
        window.scrollTo(0, y);
        set({ scrollY: 0 });
      }
    },
  };
});
