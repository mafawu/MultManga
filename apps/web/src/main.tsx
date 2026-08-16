import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './design/tokens.css';
import './design/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/reader.css';

// 主题初始化（避免闪烁）
const saved = localStorage.getItem('mm-theme');
if (saved === 'light' || saved === 'dark') {
  document.documentElement.dataset.theme = saved;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
