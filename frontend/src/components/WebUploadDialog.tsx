import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  X,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  RefreshCw,
  Plus,
  Trash2,
  FileCheck,
  Ban,
} from 'lucide-react';
import { UploadService, type UploadStage, type UploadResult } from '../services/uploadService';
import { formatBytes } from '../utils/format';
import { FileIcon } from './ui/FileIcon';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

export type ItemUploadStatus =
  | 'QUEUED'
  | 'HASHING'
  | 'CHECKING_DEDUP'
  | 'ACQUIRING_LOCK'
  | 'RESERVING_VERSION'
  | 'UPLOADING'
  | 'FINALIZING'
  | 'COMPLETED'
  | 'DUPLICATE_SKIPPED'
  | 'FAILED'
  | 'CANCELLED';

export interface QueuedUploadItem {
  id: string;
  file: File;
  status: ItemUploadStatus;
  stage?: UploadStage;
  progress: number;
  result?: UploadResult;
  error?: string;
}

interface WebUploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  vaultId: string;
  targetRelativePath: string;
  initialFiles?: File[];
  onUploadComplete?: () => void;
}

export const WebUploadDialog: React.FC<WebUploadDialogProps> = ({
  isOpen,
  onClose,
  vaultId,
  targetRelativePath,
  initialFiles,
  onUploadComplete,
}) => {
  const [items, setItems] = useState<QueuedUploadItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isCancelledRef = useRef(false);

  // Sync initialFiles if provided when opening
  useEffect(() => {
    if (isOpen && initialFiles && initialFiles.length > 0) {
      addFiles(initialFiles);
    }
  }, [isOpen, initialFiles]);

  if (!isOpen) return null;

  const addFiles = (filesToAdd: File[] | FileList) => {
    const list = Array.from(filesToAdd);
    if (list.length === 0) return;

    setItems((prev) => {
      const existingKeys = new Set(
        prev.map((it) => `${it.file.name}_${it.file.size}_${it.file.lastModified}`)
      );
      const newItems: QueuedUploadItem[] = list
        .filter((f) => !existingKeys.has(`${f.name}_${f.size}_${f.lastModified}`))
        .map((f, i) => ({
          id: `${f.name}_${f.size}_${f.lastModified}_${Date.now()}_${i}`,
          file: f,
          status: 'QUEUED',
          progress: 0,
        }));
      return [...prev, ...newItems];
    });
  };

  const removeItem = (id: string) => {
    if (isUploading) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const clearAll = () => {
    if (isUploading) return;
    setItems([]);
  };

  const resetState = () => {
    setItems([]);
    setIsUploading(false);
    setIsFinished(false);
    setCurrentIndex(-1);
    isCancelledRef.current = false;
  };

  const handleClose = () => {
    if (isUploading) {
      if (!window.confirm('An upload is currently in progress. Cancel remaining uploads and close?')) {
        return;
      }
      isCancelledRef.current = true;
    }
    resetState();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(e.target.files);
    }
    // Reset input value so same files can be re-selected if removed
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleCancelUpload = () => {
    if (window.confirm('Cancel all remaining queued file uploads?')) {
      isCancelledRef.current = true;
    }
  };

  const handleStartUpload = async () => {
    if (items.length === 0 || isUploading) return;

    setIsUploading(true);
    setIsFinished(false);
    isCancelledRef.current = false;

    let anyCompleted = false;

    for (let i = 0; i < items.length; i++) {
      if (isCancelledRef.current) {
        setItems((prev) =>
          prev.map((item, idx) =>
            idx >= i && item.status === 'QUEUED'
              ? { ...item, status: 'CANCELLED' }
              : item
          )
        );
        break;
      }

      setCurrentIndex(i);
      const currentItem = items[i];

      // Skip already completed/skipped items if re-run
      if (currentItem.status === 'COMPLETED' || currentItem.status === 'DUPLICATE_SKIPPED') {
        continue;
      }

      try {
        const res = await UploadService.uploadFile(
          vaultId,
          targetRelativePath,
          currentItem.file,
          {
            onStage: (stage) => {
              setItems((prev) =>
                prev.map((it, idx) =>
                  idx === i ? { ...it, status: stage, stage } : it
                )
              );
            },
            onProgress: (percent) => {
              setItems((prev) =>
                prev.map((it, idx) =>
                  idx === i ? { ...it, progress: percent } : it
                )
              );
            },
          }
        );

        anyCompleted = true;
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i
              ? {
                  ...it,
                  status: res.status === 'DUPLICATE_SKIPPED' ? 'DUPLICATE_SKIPPED' : 'COMPLETED',
                  result: res,
                  progress: 100,
                }
              : it
          )
        );
      } catch (err: any) {
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i
              ? {
                  ...it,
                  status: 'FAILED',
                  error: err?.message || 'Upload failed',
                }
              : it
          )
        );
      }
    }

    setIsUploading(false);
    setIsFinished(true);

    if (anyCompleted) {
      onUploadComplete?.();
    }
  };

  // Metrics
  const totalFiles = items.length;
  const totalBytes = items.reduce((sum, it) => sum + it.file.size, 0);

  const completedCount = items.filter((it) => it.status === 'COMPLETED').length;
  const skippedCount = items.filter((it) => it.status === 'DUPLICATE_SKIPPED').length;
  const failedCount = items.filter((it) => it.status === 'FAILED').length;
  const cancelledCount = items.filter((it) => it.status === 'CANCELLED').length;
  const processedCount = completedCount + skippedCount + failedCount + cancelledCount;

  const activeItem = currentIndex >= 0 && currentIndex < items.length ? items[currentIndex] : null;
  const activeProgress = activeItem?.progress || 0;

  const overallPercent = totalFiles > 0
    ? Math.min(
        100,
        Math.round(
          ((processedCount + (isUploading && activeItem && (activeItem.status === 'HASHING' || activeItem.status === 'UPLOADING') ? activeProgress / 100 : 0)) /
            totalFiles) *
            100
        )
      )
    : 0;

  const getStageDescription = (status: ItemUploadStatus, progress: number) => {
    switch (status) {
      case 'HASHING':
        return `Computing content hash (SHA-256)... ${progress}%`;
      case 'CHECKING_DEDUP':
        return 'Checking content deduplication in vault...';
      case 'ACQUIRING_LOCK':
        return 'Acquiring logical identity lock...';
      case 'RESERVING_VERSION':
        return 'Checking filename collisions & reserving version...';
      case 'UPLOADING':
        return `Uploading directly to Backblaze B2... ${progress}%`;
      case 'FINALIZING':
        return 'Finalizing metadata and releasing lock...';
      default:
        return 'Processing...';
    }
  };

  const renderItemBadge = (item: QueuedUploadItem) => {
    switch (item.status) {
      case 'QUEUED':
        return <Badge variant="neutral" size="sm">Queued</Badge>;
      case 'HASHING':
        return (
          <Badge variant="brand" size="sm" className="gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Hashing ({item.progress}%)
          </Badge>
        );
      case 'CHECKING_DEDUP':
        return (
          <Badge variant="brand" size="sm" className="gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Checking Dedup
          </Badge>
        );
      case 'ACQUIRING_LOCK':
      case 'RESERVING_VERSION':
        return (
          <Badge variant="brand" size="sm" className="gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Reserving
          </Badge>
        );
      case 'UPLOADING':
        return (
          <Badge variant="brand" size="sm" className="gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Uploading ({item.progress}%)
          </Badge>
        );
      case 'FINALIZING':
        return (
          <Badge variant="brand" size="sm" className="gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Finalizing
          </Badge>
        );
      case 'COMPLETED':
        return (
          <Badge variant="success" size="sm" className="gap-1">
            <CheckCircle className="w-3 h-3" />
            {item.result && item.result.version > 0
              ? `Uploaded (v${item.result.version})`
              : 'Uploaded'}
          </Badge>
        );
      case 'DUPLICATE_SKIPPED':
        return (
          <Badge variant="warning" size="sm" className="gap-1" title="Deduplicated: Content already exists in vault">
            <FileCheck className="w-3 h-3" />
            Skipped (Duplicate)
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge variant="danger" size="sm" className="gap-1" title={item.error}>
            <AlertCircle className="w-3 h-3" />
            Failed
          </Badge>
        );
      case 'CANCELLED':
        return (
          <Badge variant="neutral" size="sm" className="gap-1 text-slate-400">
            <Ban className="w-3 h-3" />
            Cancelled
          </Badge>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-fadeIn">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-dialog-title"
        className="relative w-full max-w-xl bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200 dark:border-[#242424] shadow-modal z-10 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-[#242424] flex items-center justify-between bg-slate-50/70 dark:bg-[#111111]">
          <div>
            <h3 id="upload-dialog-title" className="text-base font-semibold text-slate-900 dark:text-[#E6E6E6]">
              Upload Files to Vault
            </h3>
            <p className="text-xs text-slate-500 dark:text-[#8A8A8A] mt-0.5">
              Target folder:{' '}
              <span className="font-mono text-slate-700 dark:text-[#E6E6E6]">
                /{targetRelativePath || ''}
              </span>
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-[#E6E6E6] rounded-md p-1 hover:bg-slate-100 dark:hover:bg-[#181818] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Phase 1: Pre-Upload File Selection */}
          {!isUploading && !isFinished && (
            <>
              {/* Dropzone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-brand-500 dark:border-[#1DB954] bg-brand-50/40 dark:bg-[#1DB954]/10'
                    : 'border-slate-300 dark:border-[#242424] hover:border-slate-400 dark:hover:border-[#333333] bg-slate-50/50 dark:bg-[#111111]'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                />
                <div className="w-11 h-11 rounded-full bg-brand-50 dark:bg-[#181818] text-brand-600 dark:text-[#1DB954] flex items-center justify-center mx-auto mb-2.5 border border-brand-200/60 dark:border-[#242424] shadow-xs">
                  <Upload className="w-5 h-5" />
                </div>
                <div className="text-sm font-semibold text-slate-800 dark:text-[#E6E6E6]">
                  {items.length === 0
                    ? 'Click to select or drag and drop files'
                    : 'Click to add more files or drag and drop'}
                </div>
                <p className="text-xs text-slate-500 dark:text-[#8A8A8A] mt-1">
                  Upload multiple files directly to vault with chunked streaming SHA-256 and content deduplication
                </p>
              </div>

              {/* Selected Files Queue */}
              {items.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-600 dark:text-[#8A8A8A] px-0.5">
                    <span className="font-semibold text-slate-800 dark:text-[#E6E6E6]">
                      Selected Files ({items.length} · {formatBytes(totalBytes)})
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-brand-600 dark:text-[#1DB954] hover:text-brand-700 dark:hover:text-[#1AA34A] font-medium flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add More
                      </button>
                      <span className="text-slate-300 dark:text-[#242424]">|</span>
                      <button
                        type="button"
                        onClick={clearAll}
                        className="text-slate-500 dark:text-[#8A8A8A] hover:text-rose-600 dark:hover:text-rose-400 font-medium flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear All
                      </button>
                    </div>
                  </div>

                  <div className="max-h-56 overflow-y-auto space-y-1.5 border border-slate-200 dark:border-[#242424] rounded-lg p-2 bg-slate-50/50 dark:bg-[#111111] divide-y divide-slate-100 dark:divide-[#242424]">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between py-1.5 px-2 hover:bg-white dark:hover:bg-[#181818] rounded transition-colors text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <FileIcon fileName={item.file.name} className="w-4 h-4 shrink-0" />
                          <span className="font-medium text-slate-800 dark:text-[#E6E6E6] truncate" title={item.file.name}>
                            {item.file.name}
                          </span>
                          <span className="text-slate-400 dark:text-[#8A8A8A] font-mono text-[11px] shrink-0">
                            {formatBytes(item.file.size)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="text-slate-400 dark:text-[#8A8A8A] hover:text-rose-500 dark:hover:text-rose-400 p-1 rounded hover:bg-slate-100 dark:hover:bg-[#181818] shrink-0"
                          title="Remove file"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Phase 2: Upload in Progress or Finished */}
          {(isUploading || isFinished) && (
            <div className="space-y-4">
              {/* Overall Progress Banner */}
              <div className="bg-slate-50 dark:bg-[#111111] border border-slate-200/80 dark:border-[#242424] rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="font-semibold text-slate-900 dark:text-[#E6E6E6] text-sm">
                    {isUploading ? (
                      <span className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-brand-600 dark:text-[#1DB954]" />
                        Uploading {currentIndex + 1} of {totalFiles} files...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2 text-emerald-700 dark:text-[#1DB954]">
                        <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-[#1DB954]" />
                        Upload Batch Complete
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-bold text-slate-700 dark:text-[#E6E6E6]">{overallPercent}%</span>
                </div>

                {/* Overall Progress Bar */}
                <div className="w-full bg-slate-200/80 dark:bg-[#181818] rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 rounded-full ${
                      isFinished && failedCount > 0 ? 'bg-amber-500' : 'bg-brand-600 dark:bg-[#1DB954]'
                    }`}
                    style={{ width: `${overallPercent}%` }}
                  />
                </div>

                {/* Subtitle / Active Stage Description */}
                {isUploading && activeItem && (
                  <div className="text-xs text-slate-600 dark:text-[#8A8A8A] truncate flex items-center justify-between pt-0.5">
                    <span className="truncate">
                      <span className="font-medium text-slate-800 dark:text-[#E6E6E6]">{activeItem.file.name}</span>: {getStageDescription(activeItem.status, activeProgress)}
                    </span>
                  </div>
                )}

                {/* Stats Summary Pills */}
                <div className="flex items-center gap-2 pt-1 flex-wrap text-xs">
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#181818] text-slate-700 dark:text-[#E6E6E6] font-medium border border-transparent dark:border-[#242424]">
                    Total: {totalFiles}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-[#1DB954]/15 text-emerald-700 dark:text-[#1DB954] border border-emerald-200 dark:border-[#1DB954]/30 font-medium">
                    Uploaded: {completedCount}
                  </span>
                  {skippedCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 font-medium">
                      Skipped (Dedup): {skippedCount}
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 font-medium">
                      Failed: {failedCount}
                    </span>
                  )}
                  {cancelledCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#181818] text-slate-500 dark:text-[#8A8A8A] border border-slate-200 dark:border-[#242424] font-medium">
                      Cancelled: {cancelledCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Items Queue Status List */}
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-slate-700 dark:text-[#E6E6E6] px-0.5">
                  Files Status
                </div>
                <div className="max-h-60 overflow-y-auto space-y-2 border border-slate-200 dark:border-[#242424] rounded-lg p-2.5 bg-slate-50/50 dark:bg-[#0A0A0A]">
                  {items.map((item, idx) => {
                    const isActive = isUploading && idx === currentIndex;
                    return (
                      <div
                        key={item.id}
                        className={`p-2.5 rounded-lg border transition-all ${
                          isActive
                            ? 'bg-white dark:bg-[#181818] border-brand-300 dark:border-[#1DB954] shadow-xs'
                            : 'bg-white/80 dark:bg-[#111111] border-slate-200/70 dark:border-[#242424]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <FileIcon fileName={item.file.name} className="w-4 h-4 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-xs text-slate-800 dark:text-[#E6E6E6] truncate" title={item.file.name}>
                                  {item.file.name}
                                </span>
                                <span className="text-[11px] text-slate-400 dark:text-[#8A8A8A] font-mono shrink-0">
                                  {formatBytes(item.file.size)}
                                </span>
                              </div>
                              {/* Stored name note if versioned */}
                              {item.result && item.result.storedName !== item.file.name && (
                                <div className="text-[11px] text-brand-600 dark:text-[#1DB954] font-mono truncate">
                                  Saved as: {item.result.storedName}
                                </div>
                              )}
                              {/* Error message */}
                              {item.status === 'FAILED' && item.error && (
                                <div className="text-[11px] text-rose-600 dark:text-rose-400 truncate" title={item.error}>
                                  {item.error}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="shrink-0">
                            {renderItemBadge(item)}
                          </div>
                        </div>

                        {/* Individual progress bar when hashing or uploading */}
                        {isActive && (item.status === 'HASHING' || item.status === 'UPLOADING') && (
                          <div className="mt-2 w-full bg-slate-100 dark:bg-[#181818] rounded-full h-1.5 overflow-hidden border border-transparent dark:border-[#242424]">
                            <div
                              className="bg-brand-600 dark:bg-[#1DB954] h-full transition-all duration-150 rounded-full"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 dark:border-[#242424] bg-slate-50/70 dark:bg-[#111111] flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-[#8A8A8A]">
            {!isUploading && !isFinished && items.length > 0 && (
              <span>{items.length} file{items.length === 1 ? '' : 's'} ready to upload</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isUploading && !isFinished && (
              <>
                <Button variant="secondary" size="sm" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleStartUpload}
                  disabled={items.length === 0}
                  className="gap-2"
                >
                  <ArrowRight className="w-4 h-4" />
                  Upload {items.length > 0 ? `${items.length} File${items.length === 1 ? '' : 's'}` : 'Files'}
                </Button>
              </>
            )}

            {isUploading && (
              <Button variant="danger" size="sm" onClick={handleCancelUpload}>
                Cancel Remaining
              </Button>
            )}

            {isFinished && (
              <Button variant="primary" size="sm" onClick={handleClose}>
                Done
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
