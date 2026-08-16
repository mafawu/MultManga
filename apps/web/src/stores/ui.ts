import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';
export interface ToastItem {
  id: number;
  type: ToastType;
  text: string;
  action?: { label: string; fn: () => void };
}

export type ReaderMode = 'vertical' | 'paged';

interface UIState {
  theme: 'dark' | 'light';
  toasts: ToastItem[];
  readerMode: ReaderMode;
  toggleTheme: () => void;
  setTheme: (t: 'dark' | 'light') => void;
  toast: (type: ToastType, text: string, action?: { label: string; fn: () => void }) => void;
  dismissToast: (id: number) => void;
  setReaderMode: (m: ReaderMode) => void;
}

let toastId = 0;

function applyTheme(t: 'dark' | 'light') {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('mm-theme', t);
}

export const useUI = create<UIState>((set, get) => ({
  theme: (localStorage.getItem('mm-theme') as 'dark' | 'light') || 'dark',
  toasts: [],
  readerMode: (localStorage.getItem('mm-reader-mode') as ReaderMode) || 'vertical',
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    set({ theme: next });
  },
  setTheme: (t) => {
    applyTheme(t);
    set({ theme: t });
  },
  toast: (type, text, action) => {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, type, text, action }] });
    setTimeout(() => get().dismissToast(id), 5000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  setReaderMode: (m) => {
    localStorage.setItem('mm-reader-mode', m);
    set({ readerMode: m });
  },
}));
