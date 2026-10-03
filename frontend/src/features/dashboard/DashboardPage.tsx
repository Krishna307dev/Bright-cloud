import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  HardDrive,
  Folder,
  Share2,
  Download,
  Eye,
  RefreshCw,
  Database,
  ArrowRight,
  Upload,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { SourceService } from '../../services/firestore/sourceService';
import { FileService } from '../../services/firestore/fileService';
import { ReconciliationService } from '../../services/reconciliationService';
import type { SourceEntity, FileRecord } from '../../models';
import { formatBytes, formatDate } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { FileIcon } from '../../components/ui/FileIcon';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../components/ui/Table';
import { LoadingState } from '../../components/feedback/LoadingState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { EmptyState } from '../../components/feedback/EmptyState';
import { FileInspector } from '../files/FileInspector';
import { FilePreviewModal } from '../../components/FilePreviewModal';
import { WebUploadDialog } from '../../components/WebUploadDialog';
import { useDownload } from '../../hooks/useDownload';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useToast } from '../../components/ui/Toast';

export const DashboardPage: React.FC = () => {
  usePageTitle('Dashboard');
  const { vaultId, isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const { downloadFile, isDownloading } = useDownload();
  const toast = useToast();

  const [sources, setSources] = useState<SourceEntity[]>([]);
  const [recentFiles, setRecentFiles] = useState<FileRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleManualRefresh = async () => {
    if (!vaultId) return;
    try {
      setIsRefreshing(true);
      await loadDashboardData();
      toast.success('Dashboard refreshed');
    } catch (err: any) {
      toast.error(`Refresh failed: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadDashboardData = async () => {
    if (!vaultId) return;
    try {
      setIsLoading(true);
      setError(null);

      const [srcList, fileList] = await Promise.all([
        SourceService.listSourcesWithAuthoritativeCount(vaultId, isAdmin),
        isAdmin
          ? FileService.listAdminRecentFiles(vaultId, 10)
          : user?.uid
          ? FileService.fetchFriendRecentFiles(vaultId, user.uid, 10)
          : Promise.resolve([]),
      ]);

      setSources(srcList);
      setRecentFiles(fileList);

      // Trigger session-driven Admin reconciliation in background
      if (isAdmin) {
        ReconciliationService.reconcileStaleReservations(vaultId).catch((err) => {
          console.warn('Background reconciliation notice:', err);
        });
      }
    } catch (err: any) {
      setError(`Failed to load dashboard metrics: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [vaultId, isAdmin, user?.uid]);

  // Aggregate metrics
  const totalFilesCount = sources.reduce((acc, s) => acc + (s.totalFilesBackedUp || 0), 0);
  const totalStorageBytes = recentFiles.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Welcome Banner */}
      <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-4 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
              Bright Cloud Vault
            </h1>
            <Badge variant={isAdmin ? 'brand' : 'success'} size="sm">
              {isAdmin ? 'Administrator' : 'Friend / Viewer'}
            </Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-[#8A8A8A]">
            {isAdmin
              ? 'Complete cloud replica of verified USB drives with granular collaborator access'
              : 'Secure access to files and shared repositories in this Bright Cloud Vault'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {isAdmin && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsUploadOpen(true)}
              className="gap-1.5 text-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload File
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isLoading || isRefreshing}
            className="p-2 text-slate-500 hover:text-slate-700 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6]"
            title="Refresh dashboard"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing || isLoading ? 'animate-spin text-brand-600 dark:text-[#1DB954]' : ''}`} />
          </Button>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/files')}
            className="gap-1.5 text-xs"
          >
            <Folder className="w-3.5 h-3.5" />
            Browse Files
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-[#0A0A0A] p-5 rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-50 dark:bg-[#111111] border border-brand-100 dark:border-[#242424] flex items-center justify-center text-brand-600 dark:text-[#1DB954] shrink-0">
            <HardDrive className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-400 dark:text-[#8A8A8A] font-medium block">Active Storage Sources</span>
            <span className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6]">{sources.length}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0A0A0A] p-5 rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 dark:bg-[#111111] border border-indigo-100 dark:border-[#242424] flex items-center justify-center text-indigo-600 dark:text-[#1DB954] shrink-0">
            <Database className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-400 dark:text-[#8A8A8A] font-medium block">Total Backed Up Files</span>
            <span className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6]">{totalFilesCount.toLocaleString()}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0A0A0A] p-5 rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-[#111111] border border-emerald-100 dark:border-[#242424] flex items-center justify-center text-emerald-600 dark:text-[#1DB954] shrink-0">
            <Share2 className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-400 dark:text-[#8A8A8A] font-medium block">Recent Stream Volume</span>
            <span className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6]">{formatBytes(totalStorageBytes)}</span>
          </div>
        </div>
      </div>

      {/* Sources Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6E6E6] uppercase tracking-wider text-[11px]">
            Connected USB Hardware Sources
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/sources')}
            className="text-xs text-brand-600 dark:text-[#1DB954] hover:text-brand-700 dark:hover:text-[#1AA34A] gap-1 p-0"
          >
            <span>View All Sources</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        {sources.length === 0 ? (
          <div className="bg-white dark:bg-[#0A0A0A] p-6 rounded-xl border border-slate-200/80 dark:border-[#242424] text-center text-xs text-slate-500 dark:text-[#8A8A8A]">
            No USB sources registered in this vault yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {sources.map((src) => (
              <div
                key={src.sourceId}
                onClick={() => navigate(`/files/${src.sourceId}`)}
                className="bg-white dark:bg-[#0A0A0A] p-4 rounded-xl border border-slate-200/80 dark:border-[#242424] hover:border-brand-500/50 dark:hover:border-[#1DB954]/50 dark:hover:bg-[#111111] hover:shadow-md transition-all cursor-pointer space-y-2.5"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <HardDrive className="w-5 h-5 text-brand-500 dark:text-[#1DB954] shrink-0" />
                    <span className="font-semibold text-xs text-slate-900 dark:text-[#E6E6E6] truncate max-w-[150px]">
                      {src.displayName || src.sourceId}
                    </span>
                  </div>
                  <Badge variant="neutral" size="sm">
                    {src.totalFilesBackedUp} files
                  </Badge>
                </div>
                <div className="text-[11px] text-slate-400 dark:text-[#8A8A8A] font-mono truncate">
                  Last active: {formatDate(src.lastSeen)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Files Table & Side Inspector */}
      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full space-y-3">
          <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6E6E6] uppercase tracking-wider text-[11px]">
            Recent Files Stream
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/shared')}
            className="text-xs text-brand-600 dark:text-[#1DB954] hover:text-brand-700 dark:hover:text-[#1AA34A] gap-1 p-0"
          >
            <span>Open Shared Stream</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>

        {isLoading ? (
          <LoadingState message="Loading recent files..." />
        ) : error ? (
          <ErrorState message={error} onRetry={loadDashboardData} />
        ) : recentFiles.length === 0 ? (
          <EmptyState
            title="No recent files"
            description="No files are currently available in your recent stream."
          />
        ) : (
          <>
            {/* Mobile Card List (md:hidden) */}
            <div className="md:hidden space-y-2">
              {recentFiles.map((file) => {
                const isRestricted = !isAdmin && !file.isPublicToFriends && !file.allowedFriends?.includes(user?.uid || '');
                return (
                  <div
                    key={file.fileId}
                    onClick={() => {
                      if (!isRestricted) {
                        setPreviewFile(file);
                      } else {
                        setSelectedFile(file);
                      }
                    }}
                    className="w-full min-h-[64px] py-3 px-3 rounded-xl border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#0A0A0A] hover:bg-slate-50 dark:hover:bg-[#111111] transition-colors flex items-center gap-3 cursor-pointer"
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-[#181818] border border-slate-200/60 dark:border-[#242424] flex items-center justify-center shrink-0">
                      <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-5 h-5 mx-auto" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-[#E6E6E6] truncate">
                        {file.originalName}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-[#8A8A8A] mt-0.5 truncate">
                        <span>{formatBytes(file.size)}</span>
                        <span>•</span>
                        <span>{formatDate(file.uploadedAt)}</span>
                        {isRestricted && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.2 rounded shrink-0">
                            Restricted
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-11 h-11 p-0 flex items-center justify-center text-slate-400 hover:text-brand-600 dark:text-[#8A8A8A] dark:hover:text-[#1DB954]"
                        disabled={isRestricted}
                        title={isRestricted ? 'Restricted' : 'Download file'}
                        onClick={() => {
                          if (vaultId && !isRestricted) {
                            downloadFile(vaultId, file.fileId, file.storedName);
                          }
                        }}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Table (hidden md:block) */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-center">Type</TableHead>
                    <TableHead className="min-w-0">Name & Folder</TableHead>
                    <TableHead className="w-24 text-right hidden md:table-cell">Size</TableHead>
                    <TableHead className="w-36 hidden md:table-cell">Uploaded</TableHead>
                    <TableHead className="w-24 hidden sm:table-cell">Access</TableHead>
                    <TableHead className="w-20 sm:w-24 text-right shrink-0">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentFiles.map((file) => (
                    <TableRow
                      key={file.fileId}
                      onClick={() => setSelectedFile(file)}
                      onDoubleClick={() => setPreviewFile(file)}
                      className={`cursor-pointer ${selectedFile?.fileId === file.fileId ? 'bg-brand-50/60 dark:bg-[#1DB954]/10' : undefined}`}
                    >
                      <TableCell className="text-center">
                        <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-4 h-4 mx-auto" />
                      </TableCell>

                      <TableCell className="font-medium text-slate-900 dark:text-[#E6E6E6] text-xs min-w-0">
                        <div className="truncate max-w-[140px] sm:max-w-sm">{file.originalName}</div>
                        <div className="text-[11px] text-slate-400 dark:text-[#8A8A8A] font-mono truncate max-w-[140px] sm:max-w-sm">
                          {file.relativePath || '/'}
                        </div>
                        {/* Mobile subtext */}
                        <div className="text-[11px] text-slate-500 dark:text-[#8A8A8A] flex items-center gap-1.5 mt-0.5 md:hidden font-normal">
                          <span>{formatBytes(file.size)}</span>
                          <span>•</span>
                          <span>{formatDate(file.uploadedAt)}</span>
                        </div>
                      </TableCell>

                      <TableCell className="font-mono text-xs text-slate-600 dark:text-[#8A8A8A] text-right hidden md:table-cell">
                        {formatBytes(file.size)}
                      </TableCell>

                      <TableCell className="text-xs text-slate-500 dark:text-[#8A8A8A] hidden md:table-cell">
                        {formatDate(file.uploadedAt)}
                      </TableCell>

                      <TableCell className="hidden sm:table-cell">
                        {file.isPublicToFriends ? (
                          <Badge variant="success" size="sm">
                            Public
                          </Badge>
                        ) : (file.allowedFriends?.length ?? 0) > 0 ? (
                          <Badge variant="brand" size="sm">
                            Shared
                          </Badge>
                        ) : (
                          <Badge variant="neutral" size="sm">
                            Private
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell className="text-right shrink-0">
                        <div
                          className="flex items-center justify-end gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="p-1 text-slate-400 dark:text-[#8A8A8A] hover:text-brand-600 dark:hover:text-[#1DB954]"
                            title="Preview in browser"
                            onClick={() => setPreviewFile(file)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>

                          <Button
                            variant="ghost"
                            size="sm"
                            className="p-1 text-slate-400 dark:text-[#8A8A8A] hover:text-brand-600 dark:hover:text-[#1DB954]"
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
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        </div>

        {/* Right Inspector */}
        {selectedFile && (
          <FileInspector
            file={selectedFile}
            onClose={() => setSelectedFile(null)}
            onPreview={(f) => setPreviewFile(f)}
          />
        )}
      </div>

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
          onClose={() => setIsUploadOpen(false)}
          vaultId={vaultId}
          targetRelativePath=""
          onUploadComplete={loadDashboardData}
        />
      )}
    </div>
  );
};
