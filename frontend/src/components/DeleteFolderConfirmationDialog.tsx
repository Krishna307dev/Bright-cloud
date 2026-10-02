import React, { useState } from 'react';
import { Trash2, AlertTriangle, Folder } from 'lucide-react';
import { FileService } from '../services/firestore/fileService';
import { formatBytes } from '../utils/format';
import { Button } from './ui/Button';

interface DeleteFolderConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  folderPath: string;
  folderName: string;
  fileCount: number;
  totalBytes: number;
  vaultId: string;
  sourceId: string;
  onDeleted?: () => void;
}

export const DeleteFolderConfirmationDialog: React.FC<DeleteFolderConfirmationDialogProps> = ({
  isOpen,
  onClose,
  folderPath,
  folderName,
  fileCount,
  totalBytes,
  vaultId,
  sourceId,
  onDeleted,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      await FileService.deleteFolder(vaultId, sourceId, folderPath);
      onDeleted?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete folder.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-fadeIn">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-folder-dialog-title"
        className="relative w-full max-w-md bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200 dark:border-[#242424] shadow-modal z-10 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-6 pb-0 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h3 id="delete-folder-dialog-title" className="text-base font-semibold text-slate-900 dark:text-[#E6E6E6]">
              Delete Entire Folder
            </h3>
            <p className="text-xs text-slate-500 dark:text-[#8A8A8A] mt-1 leading-relaxed">
              Are you sure you want to permanently delete this folder and all its contents?
            </p>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {/* Folder Card */}
          <div className="bg-amber-50/50 dark:bg-[#111111] p-3.5 rounded-lg border border-amber-200/80 dark:border-[#242424] flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-[#181818] flex items-center justify-center text-amber-600 dark:text-[#1DB954] shrink-0">
              <Folder className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800 dark:text-[#E6E6E6] truncate">
                {folderName}
              </div>
              <div className="text-xs text-slate-500 dark:text-[#8A8A8A] font-mono flex items-center gap-2 mt-0.5">
                <span>{fileCount} file{fileCount === 1 ? '' : 's'}</span>
                <span>•</span>
                <span>{formatBytes(totalBytes)}</span>
                <span>•</span>
                <span className="truncate">/{folderPath}</span>
              </div>
            </div>
          </div>

          {/* Retention & Revocation Explanation */}
          <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/70 dark:border-rose-900/50 rounded-lg p-3 text-xs text-rose-900 dark:text-rose-300 flex items-start gap-2.5 leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Permanent B2 & Firestore Deletion:</span> All {fileCount} file{fileCount === 1 ? '' : 's'} and subdirectories inside <code className="bg-rose-100/80 dark:bg-rose-900/40 px-1 py-0.5 rounded font-mono">/{folderPath}</code> will be removed from your vault metadata and physically deleted from Backblaze B2 storage.
            </div>
          </div>

          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-xs rounded border border-rose-200 dark:border-rose-800/70">
              {error}
            </div>
          )}
        </div>

        {/* Actions Footer */}
        <div className="bg-slate-50 dark:bg-[#111111] border-t border-slate-200/80 dark:border-[#242424] px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={handleConfirm}
            isLoading={loading}
            className="gap-1.5"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete Folder Permanently</span>
          </Button>
        </div>
      </div>
    </div>
  );
};
