import { create } from 'zustand';
import type { SearchHit } from '../api/types';

const HISTORY_KEY = 'mm-search-history';
const HISTORY_MAX = 10;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return arr.filter((s) => typeof s === 'string' && s.trim()).slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

export interface SearchErrorItem {
  sourceId: string;
  sourceName: string;
  error: string;
}

interface SearchState {
  /** 关键词 */
  q: string;
  /** 已勾选源（null = 全部启用源） */
  selected: Set<string> | null;
  /** 最近一次提交的关键词 */
  submittedQ: string;
  /** 搜索结果 */
  results: SearchHit[];
  /** 各源错误 */
  errors: SearchErrorItem[];
  /** 是否已执行过搜索 */
  hasSearched: boolean;
  /** 搜索中 */
  searching: boolean;
  /** 页面滚动位置（返回时恢复） */
  scrollY: number;
  /** 搜索历史 */
  history: string[];
  /** 右侧详情侧边栏选中的结果（null = 未打开） */
  selectedHit: SearchHit | null;
  setQ: (q: string) => void;
  setSelected: (s: Set<string> | null) => void;
  setSearching: (v: boolean) => void;
  setResults: (results: SearchHit[], errors: SearchErrorItem[], q: string) => void;
  setScrollY: (y: number) => void;
  restoreScrollY: () => void;
  addHistory: (q: string) => void;
  removeHistory: (q: string) => void;
  clearHistory: () => void;
  setSelectedHit: (hit: SearchHit | null) => void;
  reset: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  q: '',
  selected: null,
  submittedQ: '',
  results: [],
  errors: [],
  hasSearched: false,
  searching: false,
  scrollY: 0,
  history: loadHistory(),
  selectedHit: null,

  setQ: (q) => set({ q }),
  setSelected: (selected) => set({ selected }),
  setSearching: (searching) => set({ searching }),

  setResults: (results, errors, q) =>
    set({ results, errors, submittedQ: q, hasSearched: true, searching: false, scrollY: 0 }),

  setScrollY: (scrollY) => set({ scrollY }),

  restoreScrollY: () => {
    const y = get().scrollY;
    if (y > 0) {
      window.scrollTo(0, y);
      set({ scrollY: 0 });
    }
  },

  addHistory: (q) => {
    const next = [q, ...get().history.filter((h) => h !== q)].slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    set({ history: next });
  },

  removeHistory: (q) => {
    const next = get().history.filter((h) => h !== q);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    set({ history: next });
  },

  clearHistory: () => {
    localStorage.removeItem(HISTORY_KEY);
    set({ history: [] });
  },

  setSelectedHit: (selectedHit) => set({ selectedHit }),

  reset: () =>
    set({
      q: '',
      selected: null,
      results: [],
      errors: [],
      hasSearched: false,
      searching: false,
      submittedQ: '',
      scrollY: 0,
      selectedHit: null,
    }),
}));
