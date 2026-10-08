import React, { useState, useMemo } from 'react';
import {
  Lock,
  Globe,
  Users,
  FolderOpen,
  ArrowUpDown,
  Search,
} from 'lucide-react';
import type { FileRecord } from '../../models';
import { FileService } from '../../services/firestore/fileService';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { FileIcon } from '../../components/ui/FileIcon';
import { useToast } from '../../components/ui/Toast';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/Table';

export interface PrivateFilesViewProps {
  files: FileRecord[];
  vaultId: string;
  sourceId: string;
  onOpenInFolder: (file: FileRecord) => void;
  onFileUpdated: (fileId: string, updates: Partial<FileRecord>) => void;
  onOpenPermissionsDialog: (file: FileRecord) => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export const PrivateFilesView: React.FC<PrivateFilesViewProps> = ({
  files,
  vaultId,
  onOpenInFolder,
  onFileUpdated,
  onOpenPermissionsDialog,
}) => {
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'name' | 'path' | 'size' | 'date'>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);

  // Filter and sort private files
  const displayedFiles = useMemo(() => {
    let result = files;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.originalName.toLowerCase().includes(q) ||
          (f.relativePath || '').toLowerCase().includes(q)
      );
    }

    return [...result].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.originalName.localeCompare(b.originalName);
      } else if (sortField === 'path') {
        comparison = (a.relativePath || '').localeCompare(b.relativePath || '');
      } else if (sortField === 'size') {
        comparison = a.size - b.size;
      } else if (sortField === 'date') {
        comparison = a.uploadedAt.getTime() - b.uploadedAt.getTime();
      }
      return sortAsc ? comparison : -comparison;
    });
  }, [files, searchQuery, sortField, sortAsc]);

  const handleSort = (field: 'name' | 'path' | 'size' | 'date') => {
    if (sortField === field) {
      setSortAsc((prev) => !prev);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const toggleSelectAll = () => {
    if (selectedFileIds.size === displayedFiles.length && displayedFiles.length > 0) {
      setSelectedFileIds(new Set());
    } else {
      setSelectedFileIds(new Set(displayedFiles.map((f) => f.fileId)));
    }
  };

  const toggleSelectFile = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const handleMakePublic = async (file: FileRecord) => {
    try {
      await FileService.updateFilePermissions(vaultId, file.fileId, true, []);
      onFileUpdated(file.fileId, {
        isPublicToFriends: true,
        allowedFriends: [],
        customPermissions: true,
      });
      toast.success(`Made "${file.originalName}" public`);
    } catch (err: any) {
      toast.error(`Failed to update permissions: ${err.message}`);
    }
  };

  const handleBulkMakePublic = async () => {
    if (selectedFileIds.size === 0) return;
    const count = selectedFileIds.size;
    setIsBulkUpdating(true);
    try {
      for (const fileId of selectedFileIds) {
        await FileService.updateFilePermissions(vaultId, fileId, true, []);
        onFileUpdated(fileId, {
          isPublicToFriends: true,
          allowedFriends: [],
          customPermissions: true,
        });
      }
      setSelectedFileIds(new Set());
      toast.success(`Made ${count} file${count === 1 ? '' : 's'} public`);
    } catch (err: any) {
      toast.error(`Bulk update error: ${err.message}`);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  if (files.length === 0) {
    return (
      <div className="bg-white dark:bg-[#0A0A0A] p-12 text-center rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm">
        <p className="text-sm font-medium text-slate-500 dark:text-[#8A8A8A]">
          No private files in this drive.
        </p>
      </div>
    );
  }

  const isAllSelected =
    displayedFiles.length > 0 && selectedFileIds.size === displayedFiles.length;

  return (
    <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm overflow-hidden flex flex-col">
      {/* Header controls: search, bulk actions, sort */}
      <div className="p-3 sm:p-4 border-b border-slate-100 dark:border-[#242424] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search private files by name or folder..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-[#111111] border border-slate-200 dark:border-[#242424] rounded-lg text-slate-900 dark:text-[#E6E6E6] focus:outline-none focus:ring-1 focus:ring-brand-500 dark:focus:ring-[#1DB954]"
            />
          </div>
        </div>

        {selectedFileIds.size > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBulkMakePublic}
              disabled={isBulkUpdating}
              className="text-xs h-8 text-brand-600 dark:text-[#1DB954] border-brand-200 dark:border-[#1DB954]/40 hover:bg-brand-50 dark:hover:bg-[#1DB954]/10"
            >
              <Globe className="w-3.5 h-3.5 mr-1" />
              Make {selectedFileIds.size} public
            </Button>
          </div>
        )}
      </div>

      {/* Mobile Card Listing (stacked, no horizontal scroll, 44px tap targets) */}
      <div className="block sm:hidden divide-y divide-slate-100 dark:divide-[#242424]">
        {displayedFiles.map((file) => {
          const isChecked = selectedFileIds.has(file.fileId);
          return (
            <div
              key={file.fileId}
              className={`p-3 space-y-2.5 transition-colors ${
                isChecked ? 'bg-brand-50/70 dark:bg-[#1DB954]/15' : 'bg-transparent'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleSelectFile(file.fileId)}
                    className="w-5 h-5 rounded border-slate-300 dark:border-[#242424] text-brand-600 dark:text-[#1DB954] focus:ring-brand-500 dark:focus:ring-[#1DB954] cursor-pointer"
                  />
                  <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-4 h-4 shrink-0" />
                  <span className="text-xs font-semibold text-slate-900 dark:text-[#E6E6E6] truncate">
                    {file.originalName}
                  </span>
                </div>
                <Badge variant="warning" size="sm" className="shrink-0 text-[10px]">
                  <Lock className="w-2.5 h-2.5 mr-1" />
                  Private
                </Badge>
              </div>

              <div className="text-[11px] text-slate-500 dark:text-[#8A8A8A] flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>/{file.relativePath || ''}</span>
                <span>{formatBytes(file.size)}</span>
                <span>{formatDate(file.uploadedAt)}</span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => onOpenInFolder(file)}
                  className="min-h-[44px] flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#111111] text-slate-700 dark:text-[#E6E6E6] hover:bg-slate-50 dark:hover:bg-[#181818] transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954]" />
                  Open in folder
                </button>
                <button
                  type="button"
                  onClick={() => handleMakePublic(file)}
                  className="min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#111111] text-slate-700 dark:text-[#E6E6E6] hover:bg-slate-50 dark:hover:bg-[#181818] transition-colors"
                  title="Make public"
                >
                  <Globe className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954]" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpenPermissionsDialog(file)}
                  className="min-h-[44px] px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#111111] text-slate-700 dark:text-[#E6E6E6] hover:bg-slate-50 dark:hover:bg-[#181818] transition-colors"
                  title="Share with collaborators"
                >
                  <Users className="w-3.5 h-3.5 text-slate-500" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden sm:block overflow-x-auto">
        <Table className="w-full">
          <TableHeader>
            <TableRow className="border-b border-slate-200/80 dark:border-[#242424] bg-slate-50/50 dark:bg-[#111111]/50 text-slate-500 dark:text-[#8A8A8A] text-xs">
              <TableHead className="w-10 text-center">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={toggleSelectAll}
                  className="rounded border-slate-300 dark:border-[#242424] text-brand-600 dark:text-[#1DB954] focus:ring-brand-500 dark:focus:ring-[#1DB954] cursor-pointer"
                />
              </TableHead>
              <TableHead className="w-8"></TableHead>
              <TableHead
                className="cursor-pointer hover:text-slate-900 dark:hover:text-[#E6E6E6]"
                onClick={() => handleSort('name')}
              >
                <div className="flex items-center gap-1">
                  <span>Name</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer hover:text-slate-900 dark:hover:text-[#E6E6E6]"
                onClick={() => handleSort('path')}
              >
                <div className="flex items-center gap-1">
                  <span>Folder Path</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </TableHead>
              <TableHead
                className="text-right cursor-pointer hover:text-slate-900 dark:hover:text-[#E6E6E6]"
                onClick={() => handleSort('size')}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Size</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </TableHead>
              <TableHead
                className="cursor-pointer hover:text-slate-900 dark:hover:text-[#E6E6E6]"
                onClick={() => handleSort('date')}
              >
                <div className="flex items-center gap-1">
                  <span>Last Uploaded</span>
                  <ArrowUpDown className="w-3 h-3" />
                </div>
              </TableHead>
              <TableHead className="w-24">Access</TableHead>
              <TableHead className="w-44 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {displayedFiles.map((file) => {
              const isChecked = selectedFileIds.has(file.fileId);
              return (
                <TableRow
                  key={file.fileId}
                  className={`border-b border-slate-100 dark:border-[#242424] hover:bg-slate-50/70 dark:hover:bg-[#181818] transition-colors ${
                    isChecked ? 'bg-brand-50/70 dark:bg-[#1DB954]/15' : 'bg-transparent'
                  }`}
                >
                  <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelectFile(file.fileId)}
                      className="rounded border-slate-300 dark:border-[#242424] text-brand-600 dark:text-[#1DB954] focus:ring-brand-500 dark:focus:ring-[#1DB954] cursor-pointer"
                    />
                  </TableCell>
                  <TableCell className="text-center">
                    <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-4 h-4 mx-auto" />
                  </TableCell>
                  <TableCell className="font-medium text-slate-900 dark:text-[#E6E6E6] text-xs">
                    <span className="truncate max-w-xs block">{file.originalName}</span>
                  </TableCell>
                  <TableCell className="text-xs font-mono text-slate-600 dark:text-[#8A8A8A]">
                    /{file.relativePath || ''}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-600 dark:text-[#8A8A8A] text-right">
                    {formatBytes(file.size)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 dark:text-[#8A8A8A]">
                    {formatDate(file.uploadedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="warning" size="sm" className="font-normal text-[10px]">
                      <Lock className="w-2.5 h-2.5 mr-1" />
                      Private
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenInFolder(file)}
                        className="text-xs text-slate-600 dark:text-[#8A8A8A] hover:text-brand-600 dark:hover:text-[#1DB954] px-2 h-7"
                        title={`Open in folder /${file.relativePath || ''}`}
                      >
                        <FolderOpen className="w-3.5 h-3.5 mr-1" />
                        Open
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleMakePublic(file)}
                        className="text-xs text-brand-600 dark:text-[#1DB954] border-slate-200 dark:border-[#242424] hover:bg-brand-50 dark:hover:bg-[#1DB954]/10 px-2 h-7"
                        title="Make public"
                      >
                        <Globe className="w-3 h-3 mr-1" />
                        Public
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenPermissionsDialog(file)}
                        className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-[#E6E6E6] p-1.5 h-7 w-7"
                        title="Share with collaborators"
                      >
                        <Users className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
