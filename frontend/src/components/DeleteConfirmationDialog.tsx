import React, { useState } from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import type { FileRecord } from '../models';
import { FileService } from '../services/firestore/fileService';
import { formatBytes } from '../utils/format';
import { FileIcon } from './ui/FileIcon';
import { Button } from './ui/Button';

interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileRecord | null;
  vaultId: string;
  onDeleted?: () => void;
}

export const DeleteConfirmationDialog: React.FC<DeleteConfirmationDialogProps> = ({
  isOpen,
  onClose,
  file,
  vaultId,
  onDeleted,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !file) return null;

  const handleConfirm = async () => {
    setLoading(true);
    setError(null);
    try {
      // Physical Vault & B2 Deletion:
      // Deletes file metadata, decrements source counter, and physically deletes the S3 object in Backblaze B2.
      await FileService.removeFileFromVault(vaultId, file.fileId, file.sourceId, (file as any).b2ObjectKey);
      onDeleted?.();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete file from vault.');
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
        aria-labelledby="delete-dialog-title"
        className="relative w-full max-w-md bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200 dark:border-[#242424] shadow-modal z-10 overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-6 pb-0 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900/60 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h3 id="delete-dialog-title" className="text-base font-semibold text-slate-900 dark:text-[#E6E6E6]">
              Delete File from Vault
            </h3>
            <p className="text-xs text-slate-500 dark:text-[#8A8A8A] mt-1 leading-relaxed">
              Are you sure you want to permanently delete this file?
            </p>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4">
          {/* File Card */}
          <div className="bg-slate-50 dark:bg-[#111111] p-3.5 rounded-lg border border-slate-200/80 dark:border-[#242424] flex items-center gap-3">
            <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-7 h-7 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800 dark:text-[#E6E6E6] truncate">
                {file.originalName}
              </div>
              <div className="text-xs text-slate-500 dark:text-[#8A8A8A] font-mono flex items-center gap-2 mt-0.5">
                <span>{formatBytes(file.size)}</span>
                <span>•</span>
                <span className="truncate">/{file.relativePath}</span>
              </div>
            </div>
          </div>

          {/* Retention & Revocation Explanation */}
          <div className="bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/70 dark:border-rose-900/50 rounded-lg p-3 text-xs text-rose-900 dark:text-rose-300 flex items-start gap-2.5 leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Permanent B2 Deletion:</span> The file record will be removed from your active file explorer, and the underlying storage object in Backblaze B2 will be permanently deleted to free your cloud storage quota.
            </div>
          </div>

          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 rounded-lg text-rose-700 dark:text-rose-300 text-xs">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 dark:border-[#242424] bg-slate-50/70 dark:bg-[#111111] flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            isLoading={loading}
            className="gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Remove from Vault
          </Button>
        </div>
      </div>
    </div>
  );
};
