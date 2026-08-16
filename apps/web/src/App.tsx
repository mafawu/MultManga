import { Route, Routes } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import LibraryPage from './pages/LibraryPage';
import SearchPage from './pages/SearchPage';
import SourcesPage from './pages/SourcesPage';
import DetailPage from './pages/DetailPage';
import DownloadsPage from './pages/DownloadsPage';
import SettingsPage from './pages/SettingsPage';
import MangaDetailPage from './pages/MangaDetailPage';
import ReaderPage from './pages/ReaderPage';
import { Toaster } from './components/ui';
import { useDownloadEvents } from './hooks/useDownloadEvents';

export default function App() {
  useDownloadEvents();
  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/downloads" element={<DownloadsPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/library/:id" element={<DetailPage />} />
          <Route path="/manga/:sourceId/:mangaId" element={<MangaDetailPage />} />
        </Route>
        <Route path="/library/:id/reader/:chapterId" element={<ReaderPage />} />
      </Routes>
      <Toaster />
    </>
  );
}
