import React, { useState, useEffect, useMemo } from 'react';
import {
  Share2,
  Search,
  Download,
  Eye,
  Folder,
  RefreshCw,
  ArrowUpDown,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { FileService } from '../../services/firestore/fileService';
import type { FileRecord } from '../../models';
import { formatBytes, formatDate } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { FileIcon } from '../../components/ui/FileIcon';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../components/ui/Table';
import { LoadingState } from '../../components/feedback/LoadingState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { EmptyState } from '../../components/feedback/EmptyState';
import { FileInspector } from '../files/FileInspector';
import { FilePreviewModal } from '../../components/FilePreviewModal';
import { useDownload } from '../../hooks/useDownload';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useToast } from '../../components/ui/Toast';

export const SharedPage: React.FC = () => {
  usePageTitle('Shared');
  const { vaultId, isAdmin, user } = useAuth();
  const { downloadFile, isDownloading } = useDownload();
  const toast = useToast();

  const [files, setFiles] = useState<FileRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'name' | 'size' | 'date'>('date');
  const [sortAsc, setSortAsc] = useState(false);

  const handleManualRefresh = async () => {
    if (!vaultId) return;
    try {
      setIsRefreshing(true);
      await loadSharedFiles();
      toast.success('Shared files refreshed');
    } catch (err: any) {
      toast.error(`Refresh failed: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadSharedFiles = async () => {
    if (!vaultId) return;

    try {
      setIsLoading(true);
      setError(null);

      let fetched: FileRecord[] = [];
      if (isAdmin) {
        fetched = await FileService.listAdminRecentFiles(vaultId, 100);
      } else if (user?.uid) {
        fetched = await FileService.fetchFriendRecentFiles(vaultId, user.uid, 100);
      }

      setFiles(fetched);
    } catch (err: any) {
      setError(`Failed to retrieve shared files: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSharedFiles();
  }, [vaultId, isAdmin, user?.uid]);

  const displayedFiles = useMemo(() => {
    let result = files;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.originalName.toLowerCase().includes(q) ||
          f.relativePath.toLowerCase().includes(q) ||
          f.sourceId.toLowerCase().includes(q)
      );
    }

    return [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'name') {
        cmp = a.originalName.localeCompare(b.originalName);
      } else if (sortField === 'size') {
        cmp = a.size - b.size;
      } else if (sortField === 'date') {
        cmp = a.uploadedAt.getTime() - b.uploadedAt.getTime();
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [files, searchQuery, sortField, sortAsc]);

  return (
    <div className="flex h-full gap-6 relative">
      <div className="flex-1 flex flex-col min-w-0 space-y-4">
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#0A0A0A] p-4 rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-50 dark:bg-[#111111] border border-brand-200/60 dark:border-[#242424] flex items-center justify-center text-brand-600 dark:text-[#1DB954]">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
                Shared Files Stream
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#8A8A8A]">
                {isAdmin
                  ? 'All files with active sharing or public access in this vault'
                  : 'Files and folders made accessible to your Google Account'}
              </p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isLoading || isRefreshing}
            className="p-2 self-end sm:self-auto text-slate-500 hover:text-slate-700 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6]"
            title="Refresh shared files"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing || isLoading ? 'animate-spin text-brand-600 dark:text-[#1DB954]' : ''}`} />
          </Button>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <Input
              placeholder="Search shared files or folders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSortAsc(!sortAsc)}
            className="gap-1 text-xs text-slate-600 dark:text-[#E6E6E6] hover:bg-slate-100 dark:hover:bg-[#181818]"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>{sortAsc ? 'Ascending' : 'Descending'}</span>
          </Button>
        </div>

        {/* Content Table / States */}
        {isLoading ? (
          <LoadingState message="Loading shared files stream..." />
        ) : error ? (
          <ErrorState message={error} onRetry={loadSharedFiles} />
        ) : displayedFiles.length === 0 ? (
          <EmptyState
            icon={<Share2 className="w-6 h-6 text-brand-500 dark:text-[#1DB954]" />}
            title="No shared files yet"
            description={
              isAdmin
                ? 'No files have been granted public or collaborator permissions in this vault.'
                : 'No files have been shared with your account yet. Check back later or ask the administrator.'
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">Type</TableHead>
                <TableHead
                  className="cursor-pointer hover:text-slate-700 dark:hover:text-[#E6E6E6]"
                  onClick={() => {
                    setSortField('name');
                    setSortAsc(!sortAsc);
                  }}
                >
                  File Name & Path
                </TableHead>
                <TableHead
                  className="w-28 cursor-pointer hover:text-slate-700 dark:hover:text-[#E6E6E6]"
                  onClick={() => {
                    setSortField('size');
                    setSortAsc(!sortAsc);
                  }}
                >
                  Size
                </TableHead>
                <TableHead
                  className="w-40 cursor-pointer hover:text-slate-700 dark:hover:text-[#E6E6E6]"
                  onClick={() => {
                    setSortField('date');
                    setSortAsc(!sortAsc);
                  }}
                >
                  Uploaded
                </TableHead>
                <TableHead className="w-32">Permission</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {displayedFiles.map((file) => {
                const isSelected = selectedFile?.fileId === file.fileId;
                return (
                  <TableRow
                    key={file.fileId}
                    onClick={() => setSelectedFile(file)}
                    onDoubleClick={() => setPreviewFile(file)}
                    className={`cursor-pointer ${isSelected ? 'bg-brand-50/60 dark:bg-[#1DB954]/10' : undefined}`}
                  >
                    <TableCell className="text-center">
                      <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-4 h-4 mx-auto" />
                    </TableCell>

                    <TableCell className="font-medium text-slate-900 dark:text-[#E6E6E6] text-xs">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="truncate max-w-xs">{file.originalName}</span>
                          {file.version > 0 && (
                            <Badge variant="brand" size="sm">
                              v{file.version}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-[#8A8A8A] font-mono mt-0.5">
                          <Folder className="w-3 h-3 text-slate-400 dark:text-[#8A8A8A]" />
                          <span className="truncate max-w-sm">
                            {file.relativePath ? `${file.relativePath}` : '/'}
                          </span>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="font-mono text-xs text-slate-600 dark:text-[#8A8A8A]">
                      {formatBytes(file.size)}
                    </TableCell>

                    <TableCell className="text-xs text-slate-500 dark:text-[#8A8A8A]">
                      {formatDate(file.uploadedAt)}
                    </TableCell>

                    <TableCell>
                      {file.isPublicToFriends ? (
                        <Badge variant="success" size="sm">
                          Public
                        </Badge>
                      ) : (
                        <Badge variant="brand" size="sm">
                          Direct Share
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-1 text-slate-400 hover:text-brand-600 dark:text-[#8A8A8A] dark:hover:text-[#1DB954]"
                          title="Preview in browser"
                          onClick={() => setPreviewFile(file)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-1 text-slate-400 hover:text-brand-600 dark:text-[#8A8A8A] dark:hover:text-[#1DB954]"
                          title="Download file"
                          isLoading={isDownloading(file.fileId)}
                          onClick={() => {
                            if (vaultId) downloadFile(vaultId, file.fileId, file.storedName);
                          }}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Tri-Pane Right Inspector */}
      {selectedFile && (
        <FileInspector
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
          onPreview={(f) => setPreviewFile(f)}
        />
      )}

      {/* File Preview Modal */}
      {vaultId && (
        <FilePreviewModal
          isOpen={!!previewFile}
          onClose={() => setPreviewFile(null)}
          file={previewFile}
          vaultId={vaultId}
        />
      )}
    </div>
  );
};
