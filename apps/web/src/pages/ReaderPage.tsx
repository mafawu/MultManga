import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button, Spinner } from '../components/ui';
import { useUI } from '../stores/ui';

type FitMode = 'width' | 'height' | 'original';

export default function ReaderPage() {
  const { id: libraryId, chapterId } = useParams<{ id: string; chapterId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useUI((s) => s.toast);
  const mode = useUI((s) => s.readerMode);
  const setMode = useUI((s) => s.setReaderMode);

  const { data: detail } = useQuery({
    queryKey: ['library', libraryId],
    queryFn: () => api.libraryDetail(libraryId!),
    enabled: !!libraryId,
  });
  const { data: pages, isLoading: pagesLoading, refetch: refetchPages } = useQuery({
    queryKey: ['pages', chapterId],
    queryFn: () => api.chapterPages(chapterId!),
    enabled: !!chapterId,
  });

  const chapters = detail?.chapters ?? [];
  const curIdx = chapters.findIndex((c) => c.id === chapterId);
  const chapter = chapters[curIdx];
  const nextChapter = curIdx >= 0 ? chapters[curIdx + 1] : undefined;
  const prevChapter = curIdx > 0 ? chapters[curIdx - 1] : undefined;

  const [page, setPage] = useState(0);
  const [fit, setFit] = useState<FitMode>('width');
  const [zoom, setZoom] = useState(1);
  const [drawer, setDrawer] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  /** 章节边界提示：'next' | 'prev' | null */
  const [navPrompt, setNavPrompt] = useState<'next' | 'prev' | null>(null);
  /** 已加载完成的页码（分页模式滚轮翻页前置条件：imgReadyPage === page，天然免疫 onLoad/重置竞态） */
  const [imgReadyPage, setImgReadyPage] = useState(-1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const pageCount = pages?.pages.length ?? 0;
  const savedRef = useRef(-1);
  const initRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  // 供 window 级滚轮监听使用的实时状态
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const navPromptRef = useRef(navPrompt);
  navPromptRef.current = navPrompt;
  const imgReadyPageRef = useRef(imgReadyPage);
  imgReadyPageRef.current = imgReadyPage;
  const pageRef = useRef(page);
  pageRef.current = page;
  /** 进入新章节后短时间内忽略滚轮（防惯性/残留滚动误翻页翻章） */
  const wheelLockUntilRef = useRef(0);

  const saveMut = useMutation({
    mutationFn: (p: number) => api.saveProgress(chapterId!, p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });

  const scheduleSave = useCallback(
    (p: number) => {
      if (p === savedRef.current) return;
      savedRef.current = p;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => saveMut.mutate(p), 600);
    },
    [saveMut],
  );

  // 切换章节时重置
  useEffect(() => {
    initRef.current = false;
    savedRef.current = -1;
    setPage(0);
    setZoom(1);
    setDrawer(false);
    setNavPrompt(null);
    setImgReadyPage(-1);
    lastScrollTopRef.current = 0;
    // 新章节滚动位置归零（纵向模式）
    scrollRef.current?.scrollTo(0, 0);
  }, [chapterId]);

  // 初始页 = 已保存进度；提示续读
  useEffect(() => {
    if (initRef.current || !pages || !chapter) return;
    initRef.current = true;
    const saved = chapter.pageIndex ?? 0;
    if (saved > 0 && (chapter.pageCount == null || saved < chapter.pageCount - 1)) {
      setPage(saved);
      toast('info', `已读到第 ${saved + 1} 页`, {
        label: '从头开始',
        fn: () => {
          setPage(0);
          savedRef.current = -1;
          scheduleSave(0);
        },
      });
    }
  }, [pages, chapter, toast, scheduleSave]);

  // 纵向模式：滚动位置 → 当前页（同时记录最近一次滚动位置，用于区分「到达边界」与「在边界继续翻页」）
  const lastScrollTopRef = useRef<number | null>(null);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = scrollRef.current;
      if (!el) return;
      lastScrollTopRef.current = el.scrollTop;
      const imgs = el.querySelectorAll<HTMLImageElement>('img.reader-vimg');
      if (imgs.length === 0) return;
      let best = 0;
      let bestDist = Infinity;
      const target = window.innerHeight * 0.35;
      imgs.forEach((img, i) => {
        const d = Math.abs(img.getBoundingClientRect().top - target);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setPage(best);
      scheduleSave(best);
    });
  }, [scheduleSave]);

  const go = useCallback(
    (delta: number) => {
      if (pageCount === 0) return;
      setPage((p) => {
        const next = Math.max(0, Math.min(pageCount - 1, p + delta));
        scheduleSave(next);
        return next;
      });
    },
    [pageCount, scheduleSave],
  );

  const goToChapter = useCallback(
    (cid: string) => {
      // 进入新章节：锁定滚轮一段时间（防惯性/残留滚动误翻页翻章）
      wheelLockUntilRef.current = Date.now() + 600;
      setImgReadyPage(-1);
      navigate(`/library/${libraryId}/reader/${cid}`);
    },
    [navigate, libraryId],
  );

  /** 确认进入提示中的上一章/下一章 */
  const confirmNav = useCallback(() => {
    setNavPrompt((p) => {
      if (p === 'next' && nextChapter) goToChapter(nextChapter.id);
      else if (p === 'prev' && prevChapter) goToChapter(prevChapter.id);
      return null;
    });
  }, [nextChapter, prevChapter, goToChapter]);

  const cancelNav = useCallback(() => setNavPrompt(null), []);

  /** 统一「向后翻页」：边界且有下一章时弹提示；提示中再次翻页 = 确认 */
  const pageForward = useCallback(() => {
    if (navPrompt) return confirmNav();
    if (mode === 'paged' && page >= pageCount - 1) {
      if (nextChapter) setNavPrompt('next');
      return;
    }
    go(1);
  }, [navPrompt, confirmNav, mode, page, pageCount, nextChapter, go]);

  /** 统一「向前翻页」：边界且有上一章时弹提示；提示中再次翻页 = 确认 */
  const pageBackward = useCallback(() => {
    if (navPrompt) return confirmNav();
    if (mode === 'paged' && page <= 0) {
      if (prevChapter) setNavPrompt('prev');
      return;
    }
    go(-1);
  }, [navPrompt, confirmNav, mode, page, prevChapter, go]);

  // 供 window 级 wheel 监听使用（避免每次翻页重建监听）
  const pageForwardRef = useRef(pageForward);
  pageForwardRef.current = pageForward;
  const pageBackwardRef = useRef(pageBackward);
  pageBackwardRef.current = pageBackward;
  const confirmNavRef = useRef(confirmNav);
  confirmNavRef.current = confirmNav;

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }, []);

  // 滚轮：window 级非被动监听（分页模式翻页；提示打开时滚轮也可确认；纵向模式不拦截原生滚动）
  useEffect(() => {
    const handler = (e: WheelEvent) => {
      if (navPromptRef.current) {
        e.preventDefault();
        confirmNavRef.current();
        return;
      }
      if (modeRef.current !== 'paged') return; // 纵向：交给原生滚动 + React onWheel
      e.preventDefault();
      if (Date.now() < wheelLockUntilRef.current) return; // 进新章节后的锁定窗口
      if (imgReadyPageRef.current !== pageRef.current) return; // 当前页图片未加载完成，不响应滚轮
      if (e.deltaY > 0) pageForwardRef.current();
      else if (e.deltaY < 0) pageBackwardRef.current();
    };
    window.addEventListener('wheel', handler, { passive: false });
    return () => window.removeEventListener('wheel', handler);
  }, []);

  // 纵向模式：仅当「上一次滚动已在边界」且本次继续同向滚动（真正越过边界）时才触发章节提示；
  // 到达边界本身不弹提示，下一次翻页动作才检测
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (mode !== 'vertical' || drawer) return;
      if (Date.now() < wheelLockUntilRef.current) return;
      const el = scrollRef.current;
      if (!el) return;
      const sc = el.scrollHeight - el.clientHeight;
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop >= sc - 4;
      const last = lastScrollTopRef.current;
      // 无法滚动（内容不满一屏）时，任何同向滚动都视为「继续翻页」
      const wasAtTop = sc <= 0 ? atTop : last !== null && last <= 0;
      const wasAtBottom = sc <= 0 ? atBottom : last !== null && last >= sc - 4;
      if (e.deltaY > 0 && atBottom && wasAtBottom) {
        if (navPrompt) confirmNav();
        else if (nextChapter) setNavPrompt('next');
      } else if (e.deltaY < 0 && atTop && wasAtTop) {
        if (navPrompt) confirmNav();
        else if (prevChapter) setNavPrompt('prev');
      }
    },
    [mode, drawer, navPrompt, confirmNav, nextChapter, prevChapter],
  );

  // 键盘导航
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (drawer) return;
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        if (mode === 'paged') pageForwardRef.current();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (mode === 'paged') pageBackwardRef.current();
      } else if (e.key === 'm' || e.key === 'M') {
        setMode(mode === 'paged' ? 'vertical' : 'paged');
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, mode, setMode, toggleFullscreen]);

  // 分页模式预取前后页
  useEffect(() => {
    if (mode !== 'paged' || !pages) return;
    for (const i of [page + 1, page - 1]) {
      if (i >= 0 && i < pageCount) {
        const img = new Image();
        img.src = pages.pages[i]!;
      }
    }
  }, [mode, page, pages, pageCount]);

  // 触摸滑动（分页模式）
  const onTouchStart = (e: React.TouchEvent) => {
    touchX.current = e.touches[0]!.clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null || mode !== 'paged') return;
    const dx = e.changedTouches[0]!.clientX - touchX.current;
    if (dx < -50) pageForwardRef.current();
    else if (dx > 50) pageBackwardRef.current();
    touchX.current = null;
  };

  if (pagesLoading) {
    return (
      <div className="reader center">
        <Spinner size={32} />
      </div>
    );
  }

  if (!pages || pages.pages.length === 0) {
    return (
      <div className="reader center">
        <div className="notice error">章节无图片或加载失败</div>
        <Button variant="secondary" onClick={() => refetchPages()}>
          重试
        </Button>
        <Link to={`/library/${libraryId}`} className="reader-back-link">
          返回书架
        </Link>
      </div>
    );
  }

  return (
    <div className="reader" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onWheel={onWheel}>
      {showChrome && (
        <>
          <header className="reader-toolbar">
            <Link to={`/library/${libraryId}`} className="reader-back">
              ← {detail?.title ?? '返回'}
            </Link>
            <span className="reader-title">{chapter?.title ?? ''}</span>
            <div className="reader-actions">
              <Button size="sm" variant="secondary" onClick={() => setDrawer(true)}>
                目录
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMode(mode === 'paged' ? 'vertical' : 'paged')}>
                {mode === 'paged' ? '纵向' : '分页'}
              </Button>
              {mode === 'paged' && (
                <>
                  <select className="select" value={fit} onChange={(e) => setFit(e.target.value as FitMode)}>
                    <option value="width">宽适配</option>
                    <option value="height">高适配</option>
                    <option value="original">原始大小</option>
                  </select>
                  <Button size="sm" variant="secondary" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}>
                    −
                  </Button>
                  <span className="reader-zoom">{Math.round(zoom * 100)}%</span>
                  <Button size="sm" variant="secondary" onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}>
                    +
                  </Button>
                </>
              )}
              <Button size="sm" variant="secondary" onClick={toggleFullscreen}>
                全屏
              </Button>
            </div>
          </header>
          <footer className="reader-bottom">
            <span>
              {page + 1} / {pageCount}
            </span>
            <div className="reader-progress">
              <div className="progress">
                <div className="progress-fill" style={{ width: `${((page + 1) / pageCount) * 100}%` }} />
              </div>
            </div>
            {nextChapter && (
              <Button size="sm" onClick={() => goToChapter(nextChapter.id)}>
                下一章
              </Button>
            )}
          </footer>
        </>
      )}

      <button className="reader-toggle" onClick={() => setShowChrome((v) => !v)} title="显示/隐藏工具栏">
        {showChrome ? '🙈' : '👁'}
      </button>

      {mode === 'vertical' ? (
        <div className="reader-content vertical" ref={scrollRef} onScroll={onScroll}>
          {pages.pages.map((src, i) => (
            <PageImg key={i} src={src} className="reader-vimg" alt={`第 ${i + 1} 页`} />
          ))}
          <div className="reader-end">
            {nextChapter ? (
              <>
                <span>本章完</span>
                <Button onClick={() => goToChapter(nextChapter.id)}>下一章：{nextChapter.title}</Button>
              </>
            ) : (
              <span>已读完最后一章</span>
            )}
          </div>
        </div>
      ) : (
        <div className="reader-content paged">
          <div
            className="reader-pimg-wrap"
            style={
              fit === 'width'
                ? { maxWidth: '100%' }
                : fit === 'height'
                  ? { maxHeight: 'calc(100vh - 140px)' }
                  : { width: 'auto' }
            }
          >
            <PageImg
              key={page}
              src={pages.pages[page]!}
              className="reader-pimg"
              style={{ transform: `scale(${zoom})` }}
              alt={`第 ${page + 1} 页`}
              noLazy
              onLoad={() => setImgReadyPage(page)}
              onError={() => setImgReadyPage(page)}
            />
          </div>
          <button className="reader-zone left" onClick={pageBackward} aria-label="上一页" />
          <button className="reader-zone right" onClick={pageForward} aria-label="下一页" />
        </div>
      )}

      {/* 章节边界提示 */}
      {navPrompt && (
        <div className="reader-nav-overlay">
          <div className="reader-nav-card">
            <div className="reader-nav-title">
              {navPrompt === 'next' ? '已到本章最后一页' : '已到本章第一页'}
            </div>
            <div className="reader-nav-sub">
              {navPrompt === 'next' ? nextChapter?.title : prevChapter?.title}
            </div>
            <div className="reader-nav-actions">
              <Button variant="secondary" size="sm" onClick={cancelNav}>
                取消
              </Button>
              <Button size="sm" onClick={confirmNav}>
                进入{navPrompt === 'next' ? '下一章' : '上一章'}
              </Button>
            </div>
            <div className="reader-nav-hint">再次翻页也可进入</div>
          </div>
        </div>
      )}

      {drawer && (
        <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
          <div className="drawer-panel">
            <div className="drawer-head">
              <h3>目录</h3>
              <button className="modal-close" onClick={() => setDrawer(false)}>
                ✕
              </button>
            </div>
            <div className="drawer-list">
              {chapters.map((c, i) => (
                <button
                  key={c.id}
                  className={`drawer-item ${c.id === chapterId ? 'active' : ''}`}
                  onClick={() => {
                    setDrawer(false);
                    goToChapter(c.id);
                  }}
                >
                  <span className="drawer-no">{i + 1}</span>
                  <span className="drawer-title">{c.title}</span>
                  <span className={`drawer-dot ${c.downloadState === 'done' ? 'done' : ''}`} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PageImg({
  src,
  className,
  alt,
  style,
  onLoad,
  onError,
  noLazy,
}: {
  src: string;
  className?: string;
  alt?: string;
  style?: React.CSSProperties;
  onLoad?: () => void;
  onError?: () => void;
  noLazy?: boolean;
}) {
  const [attempts, setAttempts] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="img-fail">
        <span>图片加载失败</span>
        <button
          onClick={() => {
            setFailed(false);
            setAttempts(0);
          }}
        >
          重试
        </button>
      </div>
    );
  }
  const bust = attempts > 0 ? `${src}${src.includes('?') ? '&' : '?'}_t=${attempts}` : src;
  return (
    <img
      src={bust}
      alt={alt ?? ''}
      className={className}
      style={style}
      loading={noLazy ? undefined : 'lazy'}
      onLoad={onLoad}
      onError={() => {
        onError?.();
        if (attempts >= 1) setFailed(true);
        else setAttempts((a) => a + 1);
      }}
    />
  );
}
