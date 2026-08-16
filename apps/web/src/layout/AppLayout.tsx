import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useUI } from '../stores/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

const NAV = [
  { to: '/', label: '书架', icon: '🏠', end: true },
  { to: '/search', label: '搜索', icon: '🔍' },
  { to: '/downloads', label: '下载', icon: '⬇️' },
  { to: '/sources', label: '源管理', icon: '🌐' },
  { to: '/settings', label: '设置', icon: '⚙️' },
];

function DownloadBadge() {
  const { data } = useQuery({ queryKey: ['downloads'], queryFn: api.downloads, refetchInterval: 5000 });
  const active = (data ?? []).filter((j) => j.state === 'queued' || j.state === 'running').length;
  if (active === 0) return null;
  return <span className="nav-badge">{active}</span>;
}

export default function AppLayout() {
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  const location = useLocation();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-logo">M</span>
          <span>MultManga</span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
              {n.to === '/downloads' && <DownloadBadge />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="theme-toggle" onClick={toggleTheme} title="切换主题">
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))?.label ?? ''}</h1>
          <button className="theme-toggle mobile-only" onClick={toggleTheme} aria-label="切换主题">
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>

      <nav className="bottom-nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>
            <span className="bn-icon">
              {n.icon}
              {n.to === '/downloads' && <DownloadBadge />}
            </span>
            <span className="bn-label">{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
