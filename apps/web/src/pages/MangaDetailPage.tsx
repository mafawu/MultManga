import { useNavigate, useParams } from 'react-router-dom';
import MangaDetailView from '../components/MangaDetailView';

/** 在线漫画详情页（搜索结果「进入详情页」跳转；加入书架后可下载） */
export default function MangaDetailPage() {
  const { sourceId, mangaId } = useParams<{ sourceId: string; mangaId: string }>();
  const navigate = useNavigate();
  if (!sourceId || !mangaId) return <div className="notice error">缺少参数</div>;
  return (
    <div className="page">
      <MangaDetailView sourceId={sourceId} mangaId={mangaId} onClose={() => navigate(-1)} />
    </div>
  );
}
