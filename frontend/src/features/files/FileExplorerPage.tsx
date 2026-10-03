import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Folder,
  Search,
  HardDrive,
  ChevronRight,
  Shield,
  Download,
  Eye,
  EyeOff,
  AlertTriangle,
  Trash2,
  Upload,
  ArrowUpDown,
  RefreshCw,
  FolderPlus,
  Scissors,
  Copy,
  Clipboard,
  Archive,
  RotateCcw,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { SourceService } from '../../services/firestore/sourceService';
import { FileService, extractSubdirectories, isSystemFileOrFolder, type FolderItem } from '../../services/firestore/fileService';
import { ZipService } from '../../services/zipService';
import { UploadService } from '../../services/uploadService';
import type { FileRecord, SourceEntity } from '../../models';
import { canonicalizePath, getParentPath } from '../../utils/path';
import { formatBytes, formatDate } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Dialog } from '../../components/ui/Dialog';
import { FileIcon } from '../../components/ui/FileIcon';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../components/ui/Table';
import { LoadingState } from '../../components/feedback/LoadingState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { EmptyState } from '../../components/feedback/EmptyState';
import { FileInspector } from './FileInspector';
import { FilePreviewModal } from '../../components/FilePreviewModal';
import { WebUploadDialog } from '../../components/WebUploadDialog';
import { DeleteConfirmationDialog } from '../../components/DeleteConfirmationDialog';
import { DeleteFolderConfirmationDialog } from '../../components/DeleteFolderConfirmationDialog';
import { ManagePermissionsDialog } from '../permissions/ManagePermissionsDialog';
import { CreateFolderModal } from '../../components/CreateFolderModal';
import { useDownload } from '../../hooks/useDownload';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useToast } from '../../components/ui/Toast';

export const FileExplorerPage: React.FC = () => {
  usePageTitle('Files');
  const { vaultId, isAdmin, user } = useAuth();
  const { sourceId: routeSourceId, '*': splatPath } = useParams<{ sourceId?: string; '*'?: string }>();
  const navigate = useNavigate();
  const { downloadFile, isDownloading, errorModal, closeErrorModal } = useDownload();
  const toast = useToast();

  // State
  const [sources, setSources] = useState<SourceEntity[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [currentPath, setCurrentPath] = useState<string>('');
  const [allSourceFiles, setAllSourceFiles] = useState<FileRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'name' | 'size' | 'date'>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Multi-select & Clipboard
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [clipboard, setClipboard] = useState<{
    action: 'cut' | 'copy';
    fileIds: string[];
    sourceId: string;
    sourcePath: string;
  } | null>(null);

  // Inspector & Dialogs
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [deletingFile, setDeletingFile] = useState<FileRecord | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<FolderItem | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [isPageDragging, setIsPageDragging] = useState(false);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [managingFile, setManagingFile] = useState<FileRecord | null>(null);
  const [isFolderPermOpen, setIsFolderPermOpen] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ active: boolean; percent: number; status: string } | null>(null);

  // Storage wipe & fresh project reset
  const [isWipingStorage, setIsWipingStorage] = useState(false);
  const [isWipeModalOpen, setIsWipeModalOpen] = useState(false);
  const [wipeStatusMessage, setWipeStatusMessage] = useState<string | null>(null);

  // Loading & Error
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleWipeAllTestData = useCallback(async () => {
    if (!vaultId || !isAdmin) return;
    try {
      setIsWipingStorage(true);
      setWipeStatusMessage('Purging Backblaze B2 files and clearing Firestore test metadata...');
      const res = await FileService.wipeAllStorage(vaultId);
      setWipeStatusMessage(
        `Wipe complete! Purged ${res.b2PurgedCount} B2 versions, deleted ${res.filesDeleted} file records, and reset ${res.sourcesDeleted} drives.`
      );
      setSources([]);
      setSelectedSourceId('');
      setAllSourceFiles([]);
      setSelectedFileIds(new Set());
      setSelectedFile(null);
      setPreviewFile(null);
      setTimeout(() => {
        setIsWipeModalOpen(false);
        setIsWipingStorage(false);
        setWipeStatusMessage(null);
        navigate('/files');
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      console.error('Failed to wipe storage:', err);
      setWipeStatusMessage(`Error wiping storage: ${err?.message || 'Unknown error'}`);
      setIsWipingStorage(false);
    }
  }, [vaultId, isAdmin, navigate]);

  // Support URL trigger ?clean=true for automated reset
  useEffect(() => {
    if (window.location.search.includes('clean=true') && vaultId && isAdmin && !isWipingStorage) {
      handleWipeAllTestData();
    }
  }, [vaultId, isAdmin, isWipingStorage, handleWipeAllTestData]);

  // Load Sources on Mount
  useEffect(() => {
    if (!vaultId) return;
    let isMounted = true;

    SourceService.listSourcesWithAuthoritativeCount(vaultId, isAdmin)
      .then((srcList) => {
        if (!isMounted) return;
        setSources(srcList);
        if (routeSourceId) {
          setSelectedSourceId(routeSourceId);
        } else if (srcList.length > 0) {
          setSelectedSourceId(srcList[0].sourceId);
        } else {
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(`Failed to load USB sources: ${err.message}`);
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [vaultId, routeSourceId, isAdmin]);

  // Synchronize path from URL
  useEffect(() => {
    const raw = splatPath || '';
    setCurrentPath(canonicalizePath(raw));
    setSelectedFileIds(new Set());
  }, [splatPath]);

  // Fetch all source files for hierarchy and folder calculations
  const loadFiles = useCallback(async () => {
    if (!vaultId || !selectedSourceId) return;

    try {
      setIsLoading(true);
      setError(null);
      const files = await FileService.listAllSourceFiles(vaultId, selectedSourceId, user?.uid, isAdmin);
      setAllSourceFiles(files);
    } catch (err: any) {
      setError(`Failed to retrieve files: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [vaultId, selectedSourceId, user?.uid, isAdmin]);

  const handleManualRefresh = async () => {
    if (!vaultId) return;
    try {
      setIsRefreshing(true);
      await Promise.all([
        loadFiles(),
        SourceService.listSourcesWithAuthoritativeCount(vaultId, isAdmin).then(setSources),
      ]);
      toast.success('Directory refreshed');
    } catch (err: any) {
      toast.error(`Refresh failed: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Trigger load on source change
  useEffect(() => {
    if (selectedSourceId) {
      loadFiles();
      setSelectedFileIds(new Set());
    }
  }, [selectedSourceId]);

  // Handle Source Selection
  const handleSourceChange = (newSourceId: string) => {
    setSelectedSourceId(newSourceId);
    navigate(`/files/${newSourceId}`);
  };

  const navigateUp = () => {
    const parent = getParentPath(currentPath);
    if (parent) {
      navigate(`/files/${selectedSourceId}/${parent}`);
    } else {
      navigate(`/files/${selectedSourceId}`);
    }
  };

  // Subfolders in current directory
  const subfolders = useMemo<FolderItem[]>(() => {
    return extractSubdirectories(allSourceFiles, currentPath, showHiddenFiles);
  }, [allSourceFiles, currentPath, showHiddenFiles]);

  // Files in current directory (excluding internal .keep placeholder and system files when hidden)
  const currentFolderFiles = useMemo(() => {
    const canonicalCurrent = canonicalizePath(currentPath);
    return allSourceFiles.filter((f) => {
      if (canonicalizePath(f.relativePath) !== canonicalCurrent || f.originalName === '.keep') {
        return false;
      }
      if (!showHiddenFiles && (isSystemFileOrFolder(f.originalName) || isSystemFileOrFolder(f.storedName))) {
        return false;
      }
      return true;
    });
  }, [allSourceFiles, currentPath, showHiddenFiles]);

  // Total drive stats (for header summary)
  const totalDriveStats = useMemo(() => {
    const nonKeep = allSourceFiles.filter((f) => f.originalName !== '.keep');
    const bytes = nonKeep.reduce((sum, f) => sum + (f.size || 0), 0);
    return { count: nonKeep.length, bytes };
  }, [allSourceFiles]);

  // Filtered & Sorted Files in current folder
  const displayedFiles = useMemo(() => {
    let result = currentFolderFiles;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((f) => f.originalName.toLowerCase().includes(q));
    }

    return [...result].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'name') {
        comparison = a.originalName.localeCompare(b.originalName);
      } else if (sortField === 'size') {
        comparison = a.size - b.size;
      } else if (sortField === 'date') {
        comparison = a.uploadedAt.getTime() - b.uploadedAt.getTime();
      }
      return sortAsc ? comparison : -comparison;
    });
  }, [currentFolderFiles, searchQuery, sortField, sortAsc]);

  // Multi-select toggle
  const isAllSelected = displayedFiles.length > 0 && displayedFiles.every((f) => selectedFileIds.has(f.fileId));

  const toggleSelectAll = () => {
    if (isAllSelected) {
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

  // Clipboard operations (Cut / Copy / Paste)
  const handleCut = () => {
    if (selectedFileIds.size === 0) return;
    setClipboard({
      action: 'cut',
      fileIds: Array.from(selectedFileIds),
      sourceId: selectedSourceId,
      sourcePath: currentPath,
    });
    setSelectedFileIds(new Set());
  };

  const handleCopy = () => {
    if (selectedFileIds.size === 0) return;
    setClipboard({
      action: 'copy',
      fileIds: Array.from(selectedFileIds),
      sourceId: selectedSourceId,
      sourcePath: currentPath,
    });
    setSelectedFileIds(new Set());
  };

  const handlePaste = async () => {
    if (!clipboard || !vaultId) return;
    try {
      setIsLoading(true);
      if (clipboard.action === 'cut') {
        await FileService.moveFiles(vaultId, clipboard.fileIds, currentPath);
      } else if (clipboard.action === 'copy') {
        const filesToCopy = allSourceFiles.filter((f) => clipboard.fileIds.includes(f.fileId));
        await FileService.copyFiles(vaultId, filesToCopy, currentPath, selectedSourceId);
      }
      setClipboard(null);
      await loadFiles();
      await SourceService.listSourcesWithAuthoritativeCount(vaultId, isAdmin).then(setSources);
    } catch (err: any) {
      alert(`Paste failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkDeleteConfirm = async () => {
    if (selectedFileIds.size === 0 || !vaultId) return;
    try {
      setIsBulkDeleting(true);
      const filesToDelete = allSourceFiles.filter((f) => selectedFileIds.has(f.fileId));
      await FileService.deleteFiles(vaultId, filesToDelete);
      setSelectedFileIds(new Set());
      setIsBulkDeleteModalOpen(false);
      await loadFiles();
      await SourceService.listSourcesWithAuthoritativeCount(vaultId, isAdmin).then(setSources);
    } catch (err: any) {
      alert(`Bulk delete failed: ${err.message}`);
    } finally {
      setIsBulkDeleting(false);
    }
  };

  // ZIP Download with STORE (0 compression, zero server CPU load)
  const handleDownloadZip = async () => {
    if (selectedFileIds.size === 0 || !vaultId) return;

    // Filter files and exclude restricted files for friends
    const accessibleFiles = displayedFiles.filter((f) => {
      if (!selectedFileIds.has(f.fileId)) return false;
      const isRestricted = !isAdmin && !f.isPublicToFriends && !f.allowedFriends?.includes(user?.uid || '');
      return !isRestricted;
    });

    if (accessibleFiles.length === 0) {
      alert('Selected files cannot be downloaded due to sharing restrictions.');
      return;
    }

    try {
      setZipProgress({ active: true, percent: 0, status: 'Preparing zero-compression archive...' });
      const filesToZip = accessibleFiles.map((f) => ({
        name: f.originalName,
        vaultId,
        fileId: f.fileId,
      }));

      await ZipService.downloadAsZip(
        filesToZip,
        `export_${selectedSourceId}_${Date.now()}.zip`,
        (percent, status) => {
          setZipProgress({ active: true, percent, status });
        }
      );
    } catch (err: any) {
      alert(`ZIP export failed: ${err.message}`);
    } finally {
      setZipProgress(null);
      setSelectedFileIds(new Set());
    }
  };

  // Admin: Archive selected files into a ZIP directly in current folder in Vault
  const handleArchiveToVault = async () => {
    if (selectedFileIds.size === 0 || !vaultId) return;

    const accessibleFiles = displayedFiles.filter((f) => selectedFileIds.has(f.fileId));
    if (accessibleFiles.length === 0) return;

    try {
      setZipProgress({ active: true, percent: 0, status: 'Generating 0-compression archive...' });
      const filesToZip = accessibleFiles.map((f) => ({
        name: f.originalName,
        vaultId,
        fileId: f.fileId,
      }));

      const zipBlob = await ZipService.createZeroCompressionZip(filesToZip, (percent, status) => {
        setZipProgress({ active: true, percent: Math.round(percent * 0.7), status });
      });

      const archiveFileName = `archive_${Date.now()}.zip`;
      const archiveFile = new File([zipBlob], archiveFileName, { type: 'application/zip' });

      setZipProgress({ active: true, percent: 75, status: 'Uploading archive to vault...' });
      await UploadService.uploadFile(vaultId, currentPath, archiveFile, {
        onStage: (stage) => setZipProgress({ active: true, percent: 85, status: `Saving: ${stage}` }),
        onProgress: (p) =>
          setZipProgress({ active: true, percent: 75 + Math.round(p * 0.25), status: 'Writing to vault...' }),
      });

      await loadFiles();
      await SourceService.listSourcesWithAuthoritativeCount(vaultId, isAdmin).then(setSources);
    } catch (err: any) {
      alert(`Failed to save archive to vault: ${err.message}`);
    } finally {
      setZipProgress(null);
      setSelectedFileIds(new Set());
    }
  };

  // Breadcrumbs segments
  const pathSegments = useMemo(() => {
    if (!currentPath) return [];
    return currentPath.split('/').filter(Boolean);
  }, [currentPath]);

  // Drag and drop multiple files directly onto explorer page
  const handlePageDragOver = (e: React.DragEvent) => {
    if (!isAdmin) return;
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault();
      setIsPageDragging(true);
    }
  };

  const handlePageDragLeave = (e: React.DragEvent) => {
    if (!isAdmin) return;
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsPageDragging(false);
  };

  const handlePageDrop = (e: React.DragEvent) => {
    if (!isAdmin) return;
    e.preventDefault();
    setIsPageDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setDroppedFiles(Array.from(e.dataTransfer.files));
      setIsUploadOpen(true);
    }
  };

  return (
    <div
      className="flex h-full gap-6 relative"
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {/* Drag & Drop Overlay */}
      {isPageDragging && (
        <div className="absolute inset-0 z-40 bg-brand-500/10 dark:bg-[#1DB954]/10 border-2 border-dashed border-brand-500 dark:border-[#1DB954] rounded-xl backdrop-blur-2xs flex flex-col items-center justify-center pointer-events-none transition-all animate-fadeIn">
          <div className="w-16 h-16 rounded-full bg-white dark:bg-[#111111] text-brand-600 dark:text-[#1DB954] shadow-md flex items-center justify-center mb-3 border border-transparent dark:border-[#242424]">
            <Upload className="w-8 h-8" />
          </div>
          <div className="text-base font-bold text-brand-900 dark:text-[#E6E6E6]">
            Drop files here to upload to /{currentPath}
          </div>
          <p className="text-xs text-brand-700 dark:text-[#8A8A8A] mt-1">
            Multiple files will be queued for direct upload
          </p>
        </div>
      )}
      <div className="flex-1 flex flex-col min-w-0 space-y-4">
        {/* Top Control Bar */}
        <div className="bg-white dark:bg-[#0A0A0A] p-4 rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm space-y-3">
          {/* Row 1: Source Selector & Path Breadcrumbs */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-[#242424]">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <div className="flex items-center gap-1.5 shrink-0 bg-slate-50 dark:bg-[#111111] border border-slate-200/90 dark:border-[#242424] rounded-lg px-2.5 py-1.5 shadow-2xs">
                <HardDrive className="w-4 h-4 text-brand-500 dark:text-[#1DB954]" />
                <span className="text-[11px] font-semibold text-slate-400 dark:text-[#8A8A8A] uppercase tracking-wider">Drive</span>
                <select
                  value={selectedSourceId}
                  onChange={(e) => handleSourceChange(e.target.value)}
                  className="text-xs font-semibold text-slate-800 dark:text-[#E6E6E6] bg-transparent border-0 p-0 focus:outline-none focus:ring-0 cursor-pointer"
                >
                  {sources.map((s) => (
                    <option key={s.sourceId} value={s.sourceId} className="bg-white dark:bg-[#111111] text-slate-800 dark:text-[#E6E6E6]">
                      {s.displayName || s.sourceId} ({s.totalFilesBackedUp || 0})
                    </option>
                  ))}
                </select>
              </div>

              <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-[#8A8A8A] shrink-0" />

              {/* Breadcrumb Trail */}
              <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-xs">
                <Link
                  to={`/files/${selectedSourceId}`}
                  className="font-medium text-slate-600 dark:text-[#8A8A8A] hover:text-brand-600 dark:hover:text-[#1DB954] transition-colors px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-[#181818]"
                >
                  root
                </Link>
                {pathSegments.map((segment, idx) => {
                  const stepPath = pathSegments.slice(0, idx + 1).join('/') + '/';
                  const isLast = idx === pathSegments.length - 1;
                  return (
                    <React.Fragment key={stepPath}>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 dark:text-[#8A8A8A] shrink-0" />
                      {isLast ? (
                        <span className="font-semibold text-slate-900 dark:text-[#E6E6E6] bg-slate-100 dark:bg-[#181818] border border-transparent dark:border-[#242424] px-2 py-0.5 rounded">
                          {segment}
                        </span>
                      ) : (
                        <Link
                          to={`/files/${selectedSourceId}/${stepPath}`}
                          className="font-medium text-slate-600 dark:text-[#8A8A8A] hover:text-brand-600 dark:hover:text-[#1DB954] transition-colors px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-[#181818]"
                        >
                          {segment}
                        </Link>
                      )}
                    </React.Fragment>
                  );
                })}
              </nav>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleManualRefresh}
                disabled={isLoading || isRefreshing}
                className="p-1.5 h-8 w-8 text-slate-500 hover:text-slate-700 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6]"
                title="Refresh directory"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing || isLoading ? 'animate-spin text-brand-600 dark:text-[#1DB954]' : ''}`} />
              </Button>
            </div>
          </div>

          {/* Row 2: Action Buttons & Management Tools */}
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && (
                <>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setIsUploadOpen(true)}
                    className="gap-1.5"
                    title="Upload file directly to vault"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload
                  </Button>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsCreateFolderOpen(true)}
                    className="gap-1.5"
                    title="Create a new folder in this directory"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-brand-600" />
                    New Folder
                  </Button>
                </>
              )}

              {isAdmin && selectedSourceId && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsFolderPermOpen(true)}
                  className="gap-1.5"
                  title="Manage folder permissions for this directory"
                >
                  <Shield className="w-3.5 h-3.5 text-brand-500" />
                  Folder Rules
                </Button>
              )}

              {isAdmin && selectedSourceId && currentPath && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const segs = currentPath.split('/').filter(Boolean);
                    const folderName = segs[segs.length - 1] || 'current';
                    setDeletingFolder({
                      name: folderName,
                      relativePath: currentPath,
                      fileCount: displayedFiles.length,
                      totalBytes: displayedFiles.reduce((acc, f) => acc + (f.size || 0), 0),
                    });
                  }}
                  className="gap-1.5 text-xs text-rose-600 hover:text-rose-700 hover:border-rose-300 dark:text-rose-400 dark:hover:text-rose-300 dark:hover:border-rose-700"
                  title="Permanently delete this entire folder and all its contents"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Delete Folder</span>
                </Button>
              )}
            </div>

            {/* Clean Slate / Reset Test Data Button (Admin Only) */}
            {isAdmin && (
              <div className="flex items-center gap-2 ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsWipeModalOpen(true)}
                  className="gap-1.5 text-xs text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:text-[#8A8A8A] dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors"
                  title="Reset storage & wipe all test files/drives metadata (fresh empty project)"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Test Data</span>
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Clipboard Banner if Cut/Copy active */}
        {clipboard && (
          <div className="bg-brand-50 dark:bg-[#111111] border border-brand-200/90 dark:border-[#242424] rounded-xl p-3 flex items-center justify-between gap-3 text-xs text-brand-900 dark:text-[#E6E6E6] shadow-sm animate-in fade-in">
            <div className="flex items-center gap-2">
              <Clipboard className="w-4 h-4 text-brand-600 dark:text-[#1DB954] shrink-0" />
              <span>
                <strong>{clipboard.fileIds.length}</strong> file{clipboard.fileIds.length === 1 ? '' : 's'} ready to{' '}
                <strong className="uppercase">{clipboard.action}</strong> into this directory.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handlePaste}
                className="gap-1.5 text-xs py-1"
              >
                Paste Here (/{currentPath || 'root'})
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setClipboard(null)}
                className="text-xs py-1 text-slate-500 hover:text-slate-700 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6]"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Search, Folder Summary & Sort Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 dark:text-[#8A8A8A] absolute left-3 top-2.5" />
              <Input
                placeholder="Search files in folder..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>

            {/* Folder & Drive Statistics Badge */}
            <div className="text-xs text-slate-500 dark:text-[#8A8A8A] hidden md:block">
              <span className="font-semibold text-slate-700 dark:text-[#E6E6E6]">
                {displayedFiles.length} file{displayedFiles.length === 1 ? '' : 's'}
              </span>
              {subfolders.length > 0 && (
                <span>, <span className="font-semibold text-slate-700 dark:text-[#E6E6E6]">{subfolders.length} folder{subfolders.length === 1 ? '' : 's'}</span></span>
              )}
              <span className="text-slate-400 dark:text-[#8A8A8A]"> in this folder</span>{' '}
              <span className="text-slate-400 dark:text-[#8A8A8A] font-medium">
                ({totalDriveStats.count} total files in drive)
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <Button
              variant={showHiddenFiles ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowHiddenFiles(!showHiddenFiles)}
              className={`gap-1.5 text-xs h-8 ${showHiddenFiles ? 'bg-slate-200 dark:bg-[#181818] text-slate-800 dark:text-[#E6E6E6] font-semibold border border-transparent dark:border-[#242424]' : 'text-slate-500 hover:text-slate-700 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6]'}`}
              title="Toggle display of Android system files (.database_uuid, .thumbnails, LOST.DIR)"
            >
              {showHiddenFiles ? <Eye className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954]" /> : <EyeOff className="w-3.5 h-3.5 text-slate-400 dark:text-[#8A8A8A]" />}
              <span>{showHiddenFiles ? 'Hide system files' : 'Show hidden files'}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSortAsc(!sortAsc);
              }}
              className="gap-1 text-slate-600 dark:text-[#E6E6E6] hover:text-slate-800 dark:hover:text-white h-8"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              <span>{sortAsc ? 'Ascending' : 'Descending'}</span>
            </Button>
          </div>
        </div>

        {/* Content Table / States */}
        {isLoading ? (
          <LoadingState message="Loading directory contents..." />
        ) : error ? (
          <ErrorState message={error} onRetry={() => loadFiles()} />
        ) : displayedFiles.length === 0 && subfolders.length === 0 ? (
          <EmptyState
            title="No files or folders found"
            description={
              !selectedSourceId
                ? 'No USB sources registered in this vault yet.'
                : currentPath
                ? 'This folder is empty. Create a folder or upload files to begin.'
                : 'No files have been backed up from this USB source yet.'
            }
            action={
              isAdmin ? (
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setIsUploadOpen(true)}
                    className="gap-1.5"
                  >
                    <Upload className="w-4 h-4" />
                    Upload File
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsCreateFolderOpen(true)}
                    className="gap-1.5"
                  >
                    <FolderPlus className="w-4 h-4 text-brand-600" />
                    New Folder
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          <div className="flex-1 flex flex-col space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                      title="Select all files in folder"
                    />
                  </TableHead>
                  <TableHead className="w-12 text-center">Type</TableHead>
                  <TableHead
                    className="cursor-pointer hover:text-slate-700"
                    onClick={() => {
                      setSortField('name');
                      setSortAsc(!sortAsc);
                    }}
                  >
                    Name
                  </TableHead>
                  <TableHead
                    className="w-28 cursor-pointer hover:text-slate-700"
                    onClick={() => {
                      setSortField('size');
                      setSortAsc(!sortAsc);
                    }}
                  >
                    Size
                  </TableHead>
                  <TableHead
                    className="w-44 cursor-pointer hover:text-slate-700"
                    onClick={() => {
                      setSortField('date');
                      setSortAsc(!sortAsc);
                    }}
                  >
                    Uploaded / Items
                  </TableHead>
                  <TableHead className="w-32">Access</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {/* Parent directory navigation row if not root */}
                {currentPath && (
                  <TableRow
                    onClick={navigateUp}
                    className="bg-slate-50/50 dark:bg-[#111111]/70 hover:bg-slate-100/70 dark:hover:bg-[#181818] cursor-pointer"
                  >
                    <TableCell className="text-center"></TableCell>
                    <TableCell className="text-center">
                      <Folder className="w-4 h-4 text-brand-500 dark:text-[#1DB954] mx-auto" />
                    </TableCell>
                    <TableCell colSpan={5} className="font-semibold text-slate-700 dark:text-[#E6E6E6] text-xs">
                      .. (Up to parent folder)
                    </TableCell>
                  </TableRow>
                )}

                {/* Subfolder rows */}
                {subfolders.map((folder) => (
                  <TableRow
                    key={folder.relativePath}
                    onClick={() => navigate(`/files/${selectedSourceId}/${folder.relativePath}`)}
                    className="bg-amber-50/20 dark:bg-[#111111] hover:bg-amber-50/60 dark:hover:bg-[#181818] cursor-pointer transition-colors"
                  >
                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}></TableCell>
                    <TableCell className="text-center">
                      <Folder className="w-4 h-4 text-amber-500 dark:text-[#1DB954] mx-auto" />
                    </TableCell>
                    <TableCell className="font-semibold text-slate-800 dark:text-[#E6E6E6] text-xs hover:text-brand-600 dark:hover:text-[#1DB954]">
                      <div className="flex items-center gap-2">
                        <span>{folder.name}</span>
                        <Badge variant="neutral" size="sm" className="font-normal text-[10px]">
                          Folder
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-500 dark:text-[#8A8A8A]">
                      {formatBytes(folder.totalBytes)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-[#8A8A8A] font-medium">
                      {folder.fileCount} file{folder.fileCount === 1 ? '' : 's'}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-400 dark:text-[#8A8A8A]">Directory</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs text-slate-500 dark:text-[#8A8A8A] hover:text-brand-600 dark:hover:text-[#1DB954]"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/files/${selectedSourceId}/${folder.relativePath}`);
                          }}
                        >
                          Open &rarr;
                        </Button>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1.5 h-8 w-8"
                            title={`Delete folder /${folder.relativePath}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingFolder(folder);
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}

                {/* File rows */}
                {displayedFiles.map((file) => {
                  const isSelected = selectedFile?.fileId === file.fileId;
                  const isChecked = selectedFileIds.has(file.fileId);
                  const isRestricted =
                    !isAdmin && !file.isPublicToFriends && !file.allowedFriends?.includes(user?.uid || '');

                  return (
                    <TableRow
                      key={file.fileId}
                      onClick={() => setSelectedFile(file)}
                      onDoubleClick={() => {
                        if (!isRestricted) setPreviewFile(file);
                      }}
                      className={`cursor-pointer ${
                        isChecked ? 'bg-brand-50/70 dark:bg-[#1DB954]/15' : isSelected ? 'bg-slate-50 dark:bg-[#181818]' : undefined
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
                        <div className="flex items-center gap-2">
                          <span className="truncate max-w-xs">{file.originalName}</span>
                          {file.version > 0 && (
                            <Badge variant="brand" size="sm">
                              v{file.version}
                            </Badge>
                          )}
                          {file.customPermissions && (
                            <Badge variant="warning" size="sm">
                              Override
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="font-mono text-xs text-slate-600 dark:text-[#8A8A8A]">
                        {formatBytes(file.size)}
                      </TableCell>

                      <TableCell className="text-xs text-slate-500 dark:text-[#8A8A8A]">
                        {formatDate(file.uploadedAt)}
                      </TableCell>

                      <TableCell>
                        {isRestricted ? (
                          <Badge variant="warning" size="sm" className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                            🔒 Restricted
                          </Badge>
                        ) : file.isPublicToFriends ? (
                          <Badge variant="success" size="sm">
                            Public
                          </Badge>
                        ) : (file.allowedFriends?.length ?? 0) > 0 ? (
                          <Badge variant="brand" size="sm">
                            Shared ({file.allowedFriends?.length})
                          </Badge>
                        ) : (
                          <Badge variant="neutral" size="sm">
                            Private
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
                            className={`p-1 ${
                              isRestricted
                                ? 'text-slate-300 dark:text-[#8A8A8A]/40 cursor-not-allowed'
                                : 'text-slate-400 hover:text-brand-600 dark:text-[#8A8A8A] dark:hover:text-[#1DB954]'
                            }`}
                            title={isRestricted ? 'Restricted by Vault Owner' : 'Preview in browser'}
                            disabled={isRestricted}
                            onClick={() => !isRestricted && setPreviewFile(file)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            className={`p-1 ${
                              isRestricted
                                ? 'text-slate-300 dark:text-[#8A8A8A]/40 cursor-not-allowed'
                                : 'text-slate-400 hover:text-brand-600 dark:text-[#8A8A8A] dark:hover:text-[#1DB954]'
                            }`}
                            title={isRestricted ? 'Restricted by Vault Owner' : 'Download file'}
                            disabled={isRestricted}
                            isLoading={isDownloading(file.fileId)}
                            onClick={() => {
                              if (vaultId && !isRestricted) {
                                downloadFile(vaultId, file.fileId, file.storedName);
                              }
                            }}
                          >
                            <Download className="w-3.5 h-3.5" />
                          </Button>

                          {isAdmin && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="p-1 text-slate-400 hover:text-slate-700 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6]"
                                title="Modify file sharing"
                                onClick={() => setManagingFile(file)}
                              >
                                <Shield className="w-3.5 h-3.5" />
                              </Button>

                              <Button
                                variant="ghost"
                                size="sm"
                                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                                title="Remove file from vault"
                                onClick={() => setDeletingFile(file)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Floating Action Bar for Selected Files */}
      {selectedFileIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white dark:bg-[#111111] text-slate-900 dark:text-[#E6E6E6] px-5 py-3 rounded-2xl shadow-2xl border border-slate-200 dark:border-[#242424] flex items-center gap-3 z-40 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <span className="text-xs font-semibold text-slate-700 dark:text-[#E6E6E6]">
            {selectedFileIds.size} file{selectedFileIds.size === 1 ? '' : 's'} selected
          </span>

          <div className="h-4 w-px bg-slate-200 dark:bg-[#242424]" />

          <Button
            variant="primary"
            size="sm"
            onClick={handleDownloadZip}
            className="gap-1.5 bg-brand-500 hover:bg-brand-600 dark:bg-[#1DB954] dark:hover:bg-[#1AA34A] text-white dark:text-black dark:font-semibold text-xs h-8"
          >
            <Download className="w-3.5 h-3.5" />
            Download ZIP
          </Button>

          {isAdmin && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCut}
                className="gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 dark:bg-[#181818] dark:hover:bg-[#242424] dark:text-[#E6E6E6] dark:border-[#242424] text-xs h-8"
              >
                <Scissors className="w-3.5 h-3.5" />
                Cut
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopy}
                className="gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 dark:bg-[#181818] dark:hover:bg-[#242424] dark:text-[#E6E6E6] dark:border-[#242424] text-xs h-8"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={handleArchiveToVault}
                className="gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300 dark:bg-[#181818] dark:hover:bg-[#242424] dark:text-[#E6E6E6] dark:border-[#242424] text-xs h-8"
                title="Create 0-compression ZIP and store into current folder"
              >
                <Archive className="w-3.5 h-3.5" />
                Archive to Vault
              </Button>

              <Button
                variant="danger"
                size="sm"
                onClick={() => setIsBulkDeleteModalOpen(true)}
                className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs h-8"
                title="Delete selected files from vault and Backblaze B2 storage"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedFileIds(new Set())}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-[#E6E6E6] p-1 ml-1"
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* ZIP Archiving Progress Modal */}
      {zipProgress?.active && (
        <Dialog isOpen={true} onClose={() => {}} title="Packaging ZIP (Zero CPU Compression)">
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between text-xs text-slate-600 dark:text-[#E6E6E6] font-medium">
              <span>{zipProgress.status}</span>
              <span className="font-mono font-bold text-brand-600 dark:text-[#1DB954]">{zipProgress.percent}%</span>
            </div>
            <div className="w-full bg-slate-100 dark:bg-[#181818] rounded-full h-2 overflow-hidden">
              <div
                className="bg-brand-500 dark:bg-[#1DB954] h-full transition-all duration-200 ease-out"
                style={{ width: `${zipProgress.percent}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 dark:text-[#8A8A8A]">
              Using uncompressed STORE format for instant client-side packaging without CPU overhead.
            </p>
          </div>
        </Dialog>
      )}

      {/* Tri-Pane Right Inspector */}
      {selectedFile && (
        <FileInspector
          file={selectedFile}
          onClose={() => setSelectedFile(null)}
          onManagePermissions={(f) => setManagingFile(f)}
          onPreview={(f) => setPreviewFile(f)}
          onRemove={(f) => setDeletingFile(f)}
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

      {/* Web Direct Upload Dialog */}
      {vaultId && (
        <WebUploadDialog
          isOpen={isUploadOpen}
          onClose={() => {
            setIsUploadOpen(false);
            setDroppedFiles([]);
          }}
          vaultId={vaultId}
          targetRelativePath={currentPath}
          initialFiles={droppedFiles}
          onUploadComplete={() => {
            loadFiles();
            SourceService.listSourcesWithAuthoritativeCount(vaultId, isAdmin).then(setSources);
          }}
        />
      )}

      {/* Create Folder Modal */}
      {vaultId && selectedSourceId && (
        <CreateFolderModal
          isOpen={isCreateFolderOpen}
          onClose={() => setIsCreateFolderOpen(false)}
          currentPath={currentPath}
          onConfirmCreate={async (folderName) => {
            await FileService.createFolder(vaultId, selectedSourceId, currentPath, folderName);
            await loadFiles();
          }}
        />
      )}

      {/* Remove from Vault Confirmation Dialog */}
      {vaultId && (
        <DeleteConfirmationDialog
          isOpen={!!deletingFile}
          onClose={() => setDeletingFile(null)}
          file={deletingFile}
          vaultId={vaultId}
          onDeleted={() => {
            loadFiles();
            if (selectedFile?.fileId === deletingFile?.fileId) {
              setSelectedFile(null);
            }
            SourceService.listSourcesWithAuthoritativeCount(vaultId, isAdmin).then(setSources);
          }}
        />
      )}

      {/* Folder Permissions Dialog */}
      {vaultId && selectedSourceId && (
        <ManagePermissionsDialog
          isOpen={isFolderPermOpen}
          onClose={() => setIsFolderPermOpen(false)}
          vaultId={vaultId}
          sourceId={selectedSourceId}
          relativePath={currentPath}
          onUpdated={() => loadFiles()}
        />
      )}

      {/* File Permissions Dialog */}
      {vaultId && managingFile && (
        <ManagePermissionsDialog
          isOpen={!!managingFile}
          onClose={() => setManagingFile(null)}
          vaultId={vaultId}
          sourceId={managingFile.sourceId}
          relativePath={managingFile.relativePath}
          file={managingFile}
          onUpdated={() => {
            loadFiles();
            setSelectedFile(null);
          }}
        />
      )}

      {/* Bulk Delete Confirmation Dialog */}
      {isBulkDeleteModalOpen && (
        <Dialog
          isOpen={true}
          onClose={() => setIsBulkDeleteModalOpen(false)}
          title="Delete Selected Files"
        >
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-800 dark:text-rose-300 text-xs">
              <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">
                  Permanently delete {selectedFileIds.size} selected file{selectedFileIds.size === 1 ? '' : 's'}?
                </span>
                <p className="mt-1 text-slate-600 dark:text-[#8A8A8A] leading-relaxed">
                  This action will remove metadata records from Firestore and physically delete the underlying storage objects in Backblaze B2 to free your bucket quota. This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-1.5 bg-slate-50 dark:bg-[#111111] p-2.5 rounded-lg border border-slate-200 dark:border-[#242424] text-xs">
              {displayedFiles
                .filter((f) => selectedFileIds.has(f.fileId))
                .slice(0, 8)
                .map((f) => (
                  <div key={f.fileId} className="flex items-center justify-between text-slate-700 dark:text-[#E6E6E6] font-mono text-[11px] truncate">
                    <span className="truncate">{f.originalName}</span>
                    <span className="text-slate-400 dark:text-[#8A8A8A] shrink-0 ml-2">{formatBytes(f.size)}</span>
                  </div>
                ))}
              {selectedFileIds.size > 8 && (
                <div className="text-[11px] text-slate-500 dark:text-[#8A8A8A] italic pt-1">
                  ...and {selectedFileIds.size - 8} more files
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsBulkDeleteModalOpen(false)}
                disabled={isBulkDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleBulkDeleteConfirm}
                isLoading={isBulkDeleting}
                className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Permanently Delete ({selectedFileIds.size})
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Download Error In-App Modal */}
      {errorModal?.isOpen && (
        <Dialog
          isOpen={true}
          onClose={closeErrorModal}
          title={errorModal.title || 'Download Error'}
        >
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-800 dark:text-rose-300 text-xs">
              <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm">{errorModal.title}</div>
                <p className="mt-1 text-slate-600 dark:text-[#E6E6E6] leading-relaxed">{errorModal.message}</p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="secondary" size="sm" onClick={closeErrorModal}>
                Dismiss
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Delete Folder Confirmation Dialog */}
      {deletingFolder && (
        <DeleteFolderConfirmationDialog
          isOpen={!!deletingFolder}
          onClose={() => setDeletingFolder(null)}
          folderPath={deletingFolder.relativePath}
          folderName={deletingFolder.name}
          fileCount={deletingFolder.fileCount}
          totalBytes={deletingFolder.totalBytes}
          vaultId={vaultId || ''}
          sourceId={selectedSourceId}
          onDeleted={async () => {
            if (currentPath === deletingFolder.relativePath || currentPath.startsWith(deletingFolder.relativePath)) {
              const parent = getParentPath(deletingFolder.relativePath);
              navigate(`/files/${selectedSourceId}/${parent}`);
            }
            await loadFiles();
            if (vaultId) {
              await SourceService.listSourcesWithAuthoritativeCount(vaultId, isAdmin).then(setSources);
            }
          }}
        />
      )}

      {/* Wipe All Test Data Modal (Clean Slate Reset) */}
      {isWipeModalOpen && (
        <Dialog
          isOpen={isWipeModalOpen}
          onClose={() => !isWipingStorage && setIsWipeModalOpen(false)}
          title="Reset Storage & Wipe Test Data"
        >
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-lg text-amber-900 dark:text-amber-200 text-xs">
              <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold text-sm">Clean Slate Reset</div>
                <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
                  This will permanently delete all test files, test USB drives, content hashes, and name reservations from both Backblaze B2 and Cloud Firestore.
                </p>
                <p className="text-amber-700 dark:text-[#1DB954] leading-relaxed font-medium">
                  ✓ Your Google Admin account, user permissions, and vault settings will NOT be deleted.
                </p>
              </div>
            </div>

            {wipeStatusMessage && (
              <div className="p-3 bg-slate-50 dark:bg-[#111111] border border-slate-200 dark:border-[#242424] rounded-lg text-xs font-mono text-slate-700 dark:text-[#E6E6E6] flex items-center gap-2">
                {isWipingStorage && <RefreshCw className="w-3.5 h-3.5 animate-spin text-brand-600 dark:text-[#1DB954] shrink-0" />}
                <span>{wipeStatusMessage}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsWipeModalOpen(false)}
                disabled={isWipingStorage}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleWipeAllTestData}
                isLoading={isWipingStorage}
                className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Reset & Wipe Everything
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};
