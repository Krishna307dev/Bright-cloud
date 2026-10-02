import React from 'react';
import {
  X,
  Download,
  Eye,
  Trash2,
  Clock,
  HardDrive,
  Copy,
  Check,
  Shield,
  Folder,
  Layers,
  Lock,
  Sparkles,
} from 'lucide-react';
import type { FileRecord } from '../../models';
import { formatBytes, formatDate } from '../../utils/format';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { FileIcon } from '../../components/ui/FileIcon';
import { useDownload } from '../../hooks/useDownload';
import { useAuth } from '../auth/AuthContext';

interface FileInspectorProps {
  file: FileRecord | null;
  onClose: () => void;
  onManagePermissions?: (file: FileRecord) => void;
  onPreview?: (file: FileRecord) => void;
  onRemove?: (file: FileRecord) => void;
}

export const FileInspector: React.FC<FileInspectorProps> = ({
  file,
  onClose,
  onManagePermissions,
  onPreview,
  onRemove,
}) => {
  const { user, vaultId, isAdmin } = useAuth();
  const { downloadFile, isDownloading } = useDownload();
  const [copiedHash, setCopiedHash] = React.useState(false);

  if (!file) return null;

  const isRestrictedToUser =
    !isAdmin &&
    !file.isPublicToFriends &&
    !file.allowedFriends?.includes(user?.uid || '');

  const handleCopyHash = () => {
    navigator.clipboard.writeText(file.sha256);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const handleDownload = () => {
    if (!vaultId || isRestrictedToUser) return;
    downloadFile(vaultId, file.fileId, file.storedName);
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/30 backdrop-blur-[1px] z-40 md:hidden animate-fadeIn"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out Panel (Desktop: Fixed Right 320px, Mobile: Slide-Up Bottom Sheet) */}
      <aside
        className="fixed md:static inset-x-0 bottom-0 max-h-[85vh] md:max-h-none md:h-full md:w-80 bg-white dark:bg-[#0A0A0A] border-t md:border-t-0 md:border-l border-slate-200 dark:border-[#242424] z-50 md:z-10 flex flex-col shadow-2xl md:shadow-none rounded-t-2xl md:rounded-none overflow-hidden transition-all duration-300"
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-[#242424] flex items-center justify-between bg-slate-50/50 dark:bg-[#111111]">
          <div className="flex items-center gap-2 min-w-0">
            <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-5 h-5 shrink-0" />
            <h3 className="font-semibold text-xs text-slate-800 dark:text-[#E6E6E6] uppercase tracking-wider truncate">
              File Details
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-[#E6E6E6] p-1 rounded-md hover:bg-slate-100 dark:hover:bg-[#181818] transition-colors"
            aria-label="Close inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable File Metadata Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs text-slate-600 dark:text-[#8A8A8A]">
          {/* File Name & Preview Icon */}
          <div className="text-center py-4 bg-slate-50 dark:bg-[#111111] rounded-xl border border-slate-100 dark:border-[#242424]">
            <div className="w-12 h-12 mx-auto rounded-xl bg-white dark:bg-[#181818] border border-slate-200 dark:border-[#242424] shadow-sm flex items-center justify-center mb-2">
              <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-7 h-7" />
            </div>
            <div className="font-semibold text-slate-900 dark:text-[#E6E6E6] text-sm px-3 break-all">
              {file.originalName}
            </div>
            {file.version > 0 && (
              <div className="mt-1">
                <Badge variant="brand" size="sm">
                  Version {file.version}
                </Badge>
              </div>
            )}
          </div>

          {/* Restricted Warning Banner if unshared to friend */}
          {isRestrictedToUser && (
            <div className="p-3 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5 leading-relaxed">
              <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold block text-amber-950 dark:text-amber-100">Restricted File</span>
                You do not have permission to preview or download this file. Contact the vault administrator to request access.
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2">
            <Button
              variant="primary"
              size="md"
              onClick={() => onPreview?.(file)}
              className="w-full gap-2 shadow-sm"
              disabled={isRestrictedToUser}
              title={isRestrictedToUser ? 'Preview disabled: Restricted file' : 'Preview in browser'}
            >
              <Eye className="w-4 h-4" />
              Preview in Browser
            </Button>

            <Button
              variant="secondary"
              size="md"
              onClick={handleDownload}
              isLoading={isDownloading(file.fileId)}
              className="w-full gap-2"
              disabled={isRestrictedToUser}
              title={isRestrictedToUser ? 'Download disabled: Restricted file' : 'Download file'}
            >
              <Download className="w-4 h-4" />
              Download File
            </Button>
          </div>

          {/* Permissions Overview */}
          <div className="p-3 bg-slate-50 dark:bg-[#111111] rounded-lg border border-slate-200/70 dark:border-[#242424] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700 dark:text-[#E6E6E6] flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-brand-500 dark:text-[#1DB954]" />
                Access Policy
              </span>
              {file.customPermissions && (
                <Badge variant="warning" size="sm">
                  Custom Override
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              {file.isPublicToFriends ? (
                <Badge variant="success" size="sm">
                  Public to Friends
                </Badge>
              ) : (file.allowedFriends?.length ?? 0) > 0 ? (
                <Badge variant="brand" size="sm">
                  Shared ({file.allowedFriends?.length} Friends)
                </Badge>
              ) : (
                <Badge variant="neutral" size="sm">
                  Private (Admin Only)
                </Badge>
              )}
            </div>

            {isAdmin && onManagePermissions && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onManagePermissions(file)}
                className="w-full mt-2 text-xs"
              >
                Modify File Sharing
              </Button>
            )}
          </div>

          {/* File Properties Table */}
          <div className="space-y-3 pt-1">
            <h4 className="font-semibold text-slate-800 dark:text-[#E6E6E6] text-[11px] uppercase tracking-wider">
              Properties
            </h4>

            <div className="space-y-2 font-mono text-[11px]">
              <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-[#242424]">
                <span className="text-slate-400 dark:text-[#8A8A8A] font-sans">Size:</span>
                <span className="text-slate-800 dark:text-[#E6E6E6] font-semibold">{formatBytes(file.size)}</span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-[#242424]">
                <span className="text-slate-400 dark:text-[#8A8A8A] font-sans">Folder Path:</span>
                <span className="text-slate-700 dark:text-[#E6E6E6] truncate max-w-[170px]" title={file.relativePath}>
                  <Folder className="w-3 h-3 inline mr-1 text-slate-400 dark:text-[#8A8A8A]" />
                  {file.relativePath || '/ (Root)'}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-[#242424]">
                <span className="text-slate-400 dark:text-[#8A8A8A] font-sans">Uploaded:</span>
                <span className="text-slate-700 dark:text-[#E6E6E6]">
                  <Clock className="w-3 h-3 inline mr-1 text-slate-400 dark:text-[#8A8A8A]" />
                  {formatDate(file.uploadedAt)}
                </span>
              </div>

              <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-[#242424]">
                <span className="text-slate-400 dark:text-[#8A8A8A] font-sans">Source Hardware:</span>
                <span className="text-slate-700 dark:text-[#E6E6E6] font-sans truncate max-w-[170px]">
                  <HardDrive className="w-3 h-3 inline mr-1 text-slate-400 dark:text-[#8A8A8A]" />
                  {file.sourceId}
                </span>
              </div>

              {file.storedName !== file.originalName && (
                <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-[#242424]">
                  <span className="text-slate-400 dark:text-[#8A8A8A] font-sans">Stored Cloud Name:</span>
                  <span className="text-slate-700 dark:text-[#E6E6E6] truncate max-w-[160px]" title={file.storedName}>
                    <Layers className="w-3 h-3 inline mr-1 text-slate-400 dark:text-[#8A8A8A]" />
                    {file.storedName}
                  </span>
                </div>
              )}

              {/* SHA-256 Hash with Copy */}
              <div className="pt-1">
                <div className="flex items-center justify-between text-slate-400 dark:text-[#8A8A8A] font-sans text-[11px] mb-1">
                  <span>SHA-256 Content Hash:</span>
                  <button
                    onClick={handleCopyHash}
                    className="flex items-center gap-1 text-brand-600 dark:text-[#1DB954] hover:text-brand-700 dark:hover:text-[#1AA34A]"
                  >
                    {copiedHash ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600 dark:text-[#1DB954]" />
                        <span className="text-emerald-600 dark:text-[#1DB954]">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="bg-slate-100/80 dark:bg-[#111111] p-2 rounded border border-slate-200/80 dark:border-[#242424] text-[10px] break-all select-all text-slate-600 dark:text-[#E6E6E6]">
                  {file.sha256}
                </div>
              </div>

              {/* CAS Deduplication Status Card */}
              <div className="p-3 bg-slate-50 dark:bg-[#111111] rounded-lg border border-slate-200/80 dark:border-[#242424] text-[11px] text-slate-600 dark:text-[#8A8A8A] space-y-1.5 mt-2">
                <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-[#1DB954]">
                  <Sparkles className="w-3.5 h-3.5 text-brand-500 dark:text-[#1DB954] shrink-0" />
                  <span>Content-Addressed Storage (CAS)</span>
                </div>
                <p className="text-[10px] text-slate-500 dark:text-[#8A8A8A] leading-normal">
                  Identified by byte-level SHA-256. Duplicate uploads of this identical content across any drive are automatically skipped to conserve bandwidth and cloud storage.
                </p>
              </div>
            </div>
          </div>

          {/* Admin Removal Action */}
          {isAdmin && onRemove && (
            <div className="pt-2 border-t border-slate-100 dark:border-[#242424]">
              <Button
                variant="danger"
                size="sm"
                onClick={() => onRemove(file)}
                className="w-full gap-2 text-xs"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Remove from Vault
              </Button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
