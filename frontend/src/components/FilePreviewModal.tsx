import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Download, AlertCircle, RefreshCw, ZoomIn, ZoomOut, Maximize2, Minimize2 } from 'lucide-react';
import type { FileRecord } from '../models';
import { B2AuthorizerClient } from '../services/b2Authorizer';
import { getFileCategory, isTextual, type FileCategory } from '../utils/fileType';
import { formatBytes, formatDate } from '../utils/format';
import { FileIcon } from './ui/FileIcon';
import { Button } from './ui/Button';

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileRecord | null;
  vaultId: string;
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  isOpen,
  onClose,
  file,
  vaultId,
}) => {
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [naturalDims, setNaturalDims] = useState<{ width: number; height: number } | null>(null);
  const [fitDims, setFitDims] = useState<{ width: number; height: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isMouseDownRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const scrollStartRef = useRef({ left: 0, top: 0 });
  const didDragRef = useRef(false);
  const lastTapTimeRef = useRef(0);
  const lastTapPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!isOpen || !file) {
      setPreviewUrl(null);
      setError(null);
      setPlaybackError(false);
      setTextContent(null);
      setZoom(1);
      setNaturalDims(null);
      setFitDims(null);
      setIsDragging(false);
      setIsFullscreen(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);
    setPlaybackError(false);
    setTextContent(null);

    const loadPreview = async () => {
      try {
        const authData = await B2AuthorizerClient.requestDownloadAuthorization(vaultId, file.fileId);
        if (!isMounted) return;
        setPreviewUrl(authData.downloadUrl);

        const category = getFileCategory(file.storedName || file.originalName, file.mimeType);
        if (isTextual(category, file.originalName)) {
          if (file.size <= 1048576) {
            try {
              const res = await fetch(authData.downloadUrl);
              if (res.ok) {
                const text = await res.text();
                if (isMounted) setTextContent(text);
              } else {
                if (isMounted) setError(`Could not fetch text content: HTTP ${res.status}`);
              }
            } catch {
              if (isMounted) setError('Network error reading file text content.');
            }
          }
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Failed to authorize preview link.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadPreview();

    return () => {
      isMounted = false;
    };
  }, [isOpen, file, vaultId]);

  const updateFitDims = useCallback((nw: number, nh: number) => {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth || window.innerWidth;
    const ch = containerRef.current.clientHeight || Math.round(window.innerHeight * 0.68);
    const pad = 16;
    const availW = Math.max(cw - pad, 50);
    const availH = Math.max(ch - pad, 50);
    const ratio = Math.min(availW / nw, availH / nh, 1);
    setFitDims({
      width: Math.round(nw * ratio),
      height: Math.round(nh * ratio),
    });
  }, []);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const nw = img.naturalWidth || 800;
    const nh = img.naturalHeight || 600;
    setNaturalDims({ width: nw, height: nh });
    updateFitDims(nw, nh);
  };

  useEffect(() => {
    if (naturalDims) {
      updateFitDims(naturalDims.width, naturalDims.height);
    }
  }, [isFullscreen, naturalDims, updateFitDims]);

  useEffect(() => {
    const handleResize = () => {
      if (naturalDims) {
        updateFitDims(naturalDims.width, naturalDims.height);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [naturalDims, updateFitDims]);

  const applyZoomAtPoint = useCallback((newZoomRaw: number, clientX?: number, clientY?: number) => {
    const newZoom = Math.min(5, Math.max(1, Math.round(newZoomRaw * 100) / 100));
    const container = containerRef.current;
    if (!container || !fitDims) {
      setZoom(newZoom);
      return;
    }

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const rect = container.getBoundingClientRect();

    const vx = clientX !== undefined ? clientX - rect.left : cw / 2;
    const vy = clientY !== undefined ? clientY - rect.top : ch / 2;

    const currentW = fitDims.width * zoom;
    const currentH = fitDims.height * zoom;

    const currentImgLeft = currentW < cw ? (cw - currentW) / 2 : 0;
    const currentImgTop = currentH < ch ? (ch - currentH) / 2 : 0;

    const imgX = container.scrollLeft + vx - currentImgLeft;
    const imgY = container.scrollTop + vy - currentImgTop;
    const fx = currentW > 0 ? Math.max(0, Math.min(1, imgX / currentW)) : 0.5;
    const fy = currentH > 0 ? Math.max(0, Math.min(1, imgY / currentH)) : 0.5;

    const newW = fitDims.width * newZoom;
    const newH = fitDims.height * newZoom;
    const newImgLeft = newW < cw ? (cw - newW) / 2 : 0;
    const newImgTop = newH < ch ? (ch - newH) / 2 : 0;

    setZoom(newZoom);

    if (newZoom > 1) {
      const targetScrollLeft = newImgLeft + fx * newW - vx;
      const targetScrollTop = newImgTop + fy * newH - vy;
      requestAnimationFrame(() => {
        if (container) {
          container.scrollLeft = Math.max(0, targetScrollLeft);
          container.scrollTop = Math.max(0, targetScrollTop);
        }
      });
    } else {
      requestAnimationFrame(() => {
        if (container) {
          container.scrollLeft = 0;
          container.scrollTop = 0;
        }
      });
    }
  }, [fitDims, zoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const step = e.deltaY < 0 ? 0.25 : -0.25;
        applyZoomAtPoint(zoom + step, e.clientX, e.clientY);
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, [applyZoomAtPoint, zoom]);

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;

    isMouseDownRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    scrollStartRef.current = { left: container.scrollLeft, top: container.scrollTop };
    didDragRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isMouseDownRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    if (!didDragRef.current && Math.hypot(dx, dy) > 4) {
      didDragRef.current = true;
      if (zoom > 1) {
        setIsDragging(true);
      }
    }

    if (didDragRef.current && zoom > 1) {
      container.scrollLeft = scrollStartRef.current.left - dx;
      container.scrollTop = scrollStartRef.current.top - dy;
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isMouseDownRef.current) return;
    isMouseDownRef.current = false;
    setIsDragging(false);

    if (!didDragRef.current) {
      const nextZoom = zoom < 2 ? 2 : (zoom < 3 ? 3 : 1);
      applyZoomAtPoint(nextZoom, e.clientX, e.clientY);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.changedTouches.length === 1) {
      const touch = e.changedTouches[0];
      const now = Date.now();
      const dt = now - lastTapTimeRef.current;
      const dist = Math.hypot(
        touch.clientX - lastTapPosRef.current.x,
        touch.clientY - lastTapPosRef.current.y
      );

      if (dt < 300 && dist < 25) {
        e.preventDefault();
        const nextZoom = zoom < 2 ? 2 : (zoom < 3 ? 3 : 1);
        applyZoomAtPoint(nextZoom, touch.clientX, touch.clientY);
        lastTapTimeRef.current = 0;
      } else {
        lastTapTimeRef.current = now;
        lastTapPosRef.current = { x: touch.clientX, y: touch.clientY };
      }
    }
  };

  const handleZoomIn = () => {
    applyZoomAtPoint(zoom + 0.5);
  };

  const handleZoomOut = () => {
    applyZoomAtPoint(zoom - 0.5);
  };

  const handleZoomToggle = () => {
    if (zoom > 1) {
      applyZoomAtPoint(1);
    } else {
      applyZoomAtPoint(2);
    }
  };

  if (!isOpen || !file) return null;

  const category: FileCategory = getFileCategory(file.storedName || file.originalName, file.mimeType);
  const isText = isTextual(category, file.originalName);

  const handleDownload = async () => {
    try {
      setDownloading(true);
      await B2AuthorizerClient.triggerDownload(
        vaultId,
        file.fileId,
        file.storedName || file.originalName
      );
    } catch (err: any) {
      setError(err?.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    setPlaybackError(false);
    try {
      const authData = await B2AuthorizerClient.requestDownloadAuthorization(vaultId, file.fileId);
      setPreviewUrl(authData.downloadUrl);
    } catch (err: any) {
      setError(err?.message || 'Failed to refresh preview link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex ${
        isFullscreen ? 'items-center justify-center p-0' : 'items-end sm:items-center justify-center p-0 sm:p-6'
      } animate-fadeIn`}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
        className={`relative w-full bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#242424] shadow-modal z-10 overflow-hidden flex flex-col transition-all duration-150 ${
          isFullscreen
            ? 'w-screen h-screen supports-[height:100dvh]:h-dvh max-w-none max-h-none rounded-none border-0'
            : 'max-w-4xl rounded-t-2xl sm:rounded-xl max-h-[92dvh] sm:max-h-[92vh] h-full sm:h-auto'
        }`}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-[#242424] flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-[#111111]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-white dark:bg-[#181818] rounded-lg border border-slate-200/80 dark:border-[#242424] shadow-xs shrink-0">
              <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 id="preview-title" className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] truncate">
                {file.originalName}
              </h3>
              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-[#8A8A8A] font-mono">
                <span>{formatBytes(file.size)}</span>
                <span>•</span>
                <span className="uppercase text-slate-600 dark:text-[#8A8A8A] font-medium">{category}</span>
                {file.version > 0 && (
                  <>
                    <span>•</span>
                    <span className="text-brand-600 dark:text-[#1DB954] font-semibold">v{file.version}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {category === 'image' && previewUrl && (
              <div className="flex items-center gap-0.5">
                <button
                  onClick={handleZoomOut}
                  disabled={zoom <= 1}
                  className="hidden sm:inline-flex p-1.5 text-slate-500 dark:text-[#8A8A8A] hover:text-slate-700 dark:hover:text-[#E6E6E6] hover:bg-slate-200/60 dark:hover:bg-[#181818] rounded-md disabled:opacity-30 transition-colors"
                  title="Zoom Out"
                  aria-label="Zoom Out"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>
                <button
                  onClick={handleZoomToggle}
                  className="p-1.5 text-slate-500 dark:text-[#8A8A8A] hover:text-slate-700 dark:hover:text-[#E6E6E6] hover:bg-slate-200/60 dark:hover:bg-[#181818] rounded-md transition-colors"
                  title={zoom > 1 ? 'Fit to Screen' : 'Zoom In'}
                  aria-label={zoom > 1 ? 'Fit to Screen' : 'Zoom In'}
                >
                  {zoom > 1 ? (
                    <ZoomOut className="w-4 h-4 sm:hidden" />
                  ) : (
                    <ZoomIn className="w-4 h-4 sm:hidden" />
                  )}
                  <span className="hidden sm:inline text-xs font-mono font-medium">
                    {Math.round(zoom * 100)}%
                  </span>
                </button>
                <button
                  onClick={handleZoomIn}
                  disabled={zoom >= 5}
                  className="hidden sm:inline-flex p-1.5 text-slate-500 dark:text-[#8A8A8A] hover:text-slate-700 dark:hover:text-[#E6E6E6] hover:bg-slate-200/60 dark:hover:bg-[#181818] rounded-md disabled:opacity-30 transition-colors"
                  title="Zoom In"
                  aria-label="Zoom In"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>
              </div>
            )}
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="p-1.5 text-slate-500 dark:text-[#8A8A8A] hover:text-slate-700 dark:hover:text-[#E6E6E6] hover:bg-slate-200/60 dark:hover:bg-[#181818] rounded-md transition-colors"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownload}
              isLoading={downloading}
              className="gap-1.5 text-xs hidden sm:flex"
            >
              <Download className="w-3.5 h-3.5" />
              Download
            </Button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-[#E6E6E6] rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-[#181818] transition-colors"
              aria-label="Close preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div
          className={`flex-1 overflow-auto ${
            category === 'image' && previewUrl && !loading && !error ? 'p-0' : 'p-4 sm:p-6'
          } flex items-center justify-center bg-slate-900/5 dark:bg-black ${
            isFullscreen ? 'h-full max-h-none' : 'min-h-[300px]'
          }`}
        >
          {loading ? (
            <div className="flex flex-col items-center gap-3 text-slate-500 dark:text-[#8A8A8A] py-12">
              <RefreshCw className="w-7 h-7 animate-spin text-brand-600 dark:text-[#1DB954]" />
              <p className="text-xs font-medium">Authorizing secure preview stream...</p>
            </div>
          ) : error ? (
            <div className="text-center max-w-md p-6 bg-white dark:bg-[#0A0A0A] rounded-xl border border-rose-200 dark:border-rose-900/60 shadow-sm space-y-3">
              <AlertCircle className="w-8 h-8 text-rose-500 mx-auto" />
              <div className="text-sm font-semibold text-slate-800 dark:text-[#E6E6E6]">Preview Unavailable</div>
              <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
              <div className="flex justify-center gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={handleRefresh}>
                  Retry Authorization
                </Button>
                <Button variant="primary" size="sm" onClick={handleDownload}>
                  Download File
                </Button>
              </div>
            </div>
          ) : previewUrl ? (
            <>
              {/* PDF Preview */}
              {category === 'pdf' && (
                <div
                  className={`w-full ${
                    isFullscreen ? 'h-full flex-1 max-h-none' : 'h-[68vh]'
                  } rounded-lg overflow-hidden border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#0A0A0A]`}
                >
                  <iframe
                    src={`${previewUrl}#toolbar=1&navpanes=0`}
                    title={file.originalName}
                    className="w-full h-full border-0"
                  />
                </div>
              )}

              {/* Image Preview */}
              {category === 'image' && (
                <div
                  ref={containerRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onTouchEnd={handleTouchEnd}
                  className={`w-full h-full overflow-auto overscroll-contain flex p-4 select-none [touch-action:pan-x_pan-y_pinch-zoom] ${
                    zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
                  }`}
                >
                  <img
                    ref={imgRef}
                    src={previewUrl}
                    alt={file.originalName}
                    onLoad={handleImageLoad}
                    style={
                      fitDims
                        ? {
                            width: `${Math.round(fitDims.width * zoom)}px`,
                            height: `${Math.round(fitDims.height * zoom)}px`,
                          }
                        : undefined
                    }
                    className={`m-auto block shrink-0 select-none rounded-lg ${
                      zoom === 1
                        ? isFullscreen
                          ? 'max-h-[calc(100vh-100px)] max-w-full object-contain shadow-md'
                          : 'max-h-[68vh] max-w-full object-contain shadow-md'
                        : ''
                    }`}
                    draggable={false}
                  />
                </div>
              )}

              {/* Video Preview */}
              {category === 'video' && !playbackError && (
                <div
                  className={`w-full ${
                    isFullscreen ? 'h-full max-h-[calc(100vh-100px)]' : 'max-h-[68vh]'
                  } flex items-center justify-center bg-black rounded-lg overflow-hidden`}
                >
                  <video
                    controls
                    autoPlay={false}
                    src={previewUrl}
                    className={`${isFullscreen ? 'max-h-[calc(100vh-100px)]' : 'max-h-[68vh]'} w-full`}
                    onError={() => setPlaybackError(true)}
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
              )}

              {/* Audio Preview */}
              {category === 'audio' && !playbackError && (
                <div className="w-full max-w-md p-8 bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200 dark:border-[#242424] shadow-sm text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto border border-amber-200 dark:border-amber-800/60">
                    <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800 dark:text-[#E6E6E6]">{file.originalName}</h4>
                    <p className="text-xs text-slate-500 dark:text-[#8A8A8A] mt-1">{formatBytes(file.size)}</p>
                  </div>
                  <audio
                    controls
                    src={previewUrl}
                    className="w-full"
                    onError={() => setPlaybackError(true)}
                  >
                    Your browser does not support the audio element.
                  </audio>
                </div>
              )}

              {/* Text / Code Preview */}
              {isText && (
                <div
                  className={`w-full ${
                    isFullscreen ? 'h-full flex-1 max-h-none' : 'max-h-[68vh]'
                  } flex flex-col bg-slate-900 dark:bg-[#0A0A0A] rounded-lg overflow-hidden border border-slate-800 dark:border-[#242424] shadow-inner`}
                >
                  {file.size > 1048576 ? (
                    <div className="p-8 text-center text-slate-300 dark:text-[#8A8A8A] space-y-3">
                      <p className="text-xs text-slate-400 dark:text-[#8A8A8A]">
                        File exceeds 1 MB limit for inline text preview ({formatBytes(file.size)}).
                      </p>
                      <Button variant="primary" size="sm" onClick={handleDownload}>
                        Download to View
                      </Button>
                    </div>
                  ) : textContent !== null ? (
                    <pre
                      className={`p-4 overflow-auto text-xs font-mono text-slate-200 dark:text-[#E6E6E6] leading-relaxed ${
                        isFullscreen ? 'flex-1 max-h-none' : 'max-h-[68vh]'
                      } select-text`}
                    >
                      <code>{textContent}</code>
                    </pre>
                  ) : (
                    <div className="p-8 text-center text-slate-400 dark:text-[#8A8A8A] text-xs">
                      Loading text preview...
                    </div>
                  )}
                </div>
              )}

              {/* Unsupported or Playback Error Card */}
              {(playbackError || (!['pdf', 'image'].includes(category) && !isText && (category !== 'video' && category !== 'audio' || playbackError))) && (
                <div className="max-w-md w-full p-6 bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200 dark:border-[#242424] shadow-sm text-center space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-[#181818] flex items-center justify-center mx-auto border border-slate-200/70 dark:border-[#242424]">
                    <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-8 h-8" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6]">{file.originalName}</h4>
                    <p className="text-xs text-slate-500 dark:text-[#8A8A8A]">
                      {playbackError
                        ? 'Your browser cannot decode or stream this media codec inline.'
                        : `Inline preview is not supported for this file format (${category.toUpperCase()}).`}
                    </p>
                  </div>
                  <div className="bg-slate-50 dark:bg-[#111111] p-3 rounded-lg border border-slate-200/60 dark:border-[#242424] text-left text-xs text-slate-600 dark:text-[#E6E6E6] space-y-1 font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-400 dark:text-[#8A8A8A]">Size:</span>
                      <span>{formatBytes(file.size)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400 dark:text-[#8A8A8A]">Modified:</span>
                      <span>{formatDate(file.lastModified)}</span>
                    </div>
                    <div className="flex justify-between truncate">
                      <span className="text-slate-400 dark:text-[#8A8A8A]">SHA-256:</span>
                      <span className="truncate max-w-[200px]" title={file.sha256}>{file.sha256}</span>
                    </div>
                  </div>
                  <Button variant="primary" className="w-full justify-center gap-2" onClick={handleDownload} isLoading={downloading}>
                    <Download className="w-4 h-4" />
                    Download File
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer (mobile-only download button) */}
        <div className="p-3 border-t border-slate-100 dark:border-[#242424] bg-white dark:bg-[#111111] sm:hidden flex justify-end">
          <Button variant="primary" size="sm" onClick={handleDownload} isLoading={downloading} className="w-full justify-center gap-2">
            <Download className="w-4 h-4" />
            Download File
          </Button>
        </div>
      </div>
    </div>
  );
};
