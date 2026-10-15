import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { HardDrive, Folder, Clock, Calendar, RefreshCw, Trash2, RotateCcw } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { SourceService } from '../../services/firestore/sourceService';
import type { SourceEntity } from '../../models';
import { formatDate } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { LoadingState } from '../../components/feedback/LoadingState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { EmptyState } from '../../components/feedback/EmptyState';
import { DeleteDriveModal } from '../../components/DeleteDriveModal';
import { usePageTitle } from '../../hooks/usePageTitle';

export const SourcesPage: React.FC = () => {
  usePageTitle('USB Sources');
  const { vaultId, isAdmin } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [sources, setSources] = useState<SourceEntity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetDeleteSource, setTargetDeleteSource] = useState<SourceEntity | null>(null);

  const handleManualRefresh = async () => {
    if (!vaultId) return;
    try {
      setIsRefreshing(true);
      await loadSources();
      toast.success('USB sources refreshed');
    } catch (err: any) {
      toast.error(`Refresh failed: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadSources = async () => {
    if (!vaultId) return;
    try {
      setIsLoading(true);
      setError(null);
      if (isAdmin) {
        await SourceService.processExpiredDeletions(vaultId);
      }
      const list = await SourceService.listSources(vaultId);
      setSources(list);
    } catch (err: any) {
      setError(`Failed to retrieve USB sources: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmSchedule = async (src: SourceEntity) => {
    if (!vaultId) return;
    try {
      await SourceService.scheduleSourceDeletion(vaultId, src.sourceId);
      toast.success(`Scheduled deletion for ${src.displayName}. 24-hour undo window is active.`);
      await loadSources();
    } catch (err: any) {
      toast.error(`Failed to schedule deletion: ${err.message}`);
    }
  };

  const handleCancelDeletion = async (src: SourceEntity) => {
    if (!vaultId) return;
    try {
      await SourceService.cancelSourceDeletion(vaultId, src.sourceId);
      toast.success(`Cancelled deletion for ${src.displayName}. Drive restored to active.`);
      await loadSources();
    } catch (err: any) {
      toast.error(`Failed to cancel deletion: ${err.message}`);
    }
  };

  const handleImmediatePurge = async (src: SourceEntity) => {
    if (!vaultId) return;
    if (
      !window.confirm(
        `Permanently purge drive "${src.displayName}" right now? All files will be deleted from Backblaze B2 and Firestore immediately.`
      )
    ) {
      return;
    }

    try {
      setIsLoading(true);
      const res = await SourceService.executeSourceDeletion(vaultId, src.sourceId);
      toast.success(
        `Permanently purged drive ${src.displayName}. Reclaimed B2 bucket storage (${res.b2PurgedCount} objects/versions purged).`
      );
      await loadSources();
    } catch (err: any) {
      toast.error(`Purge failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const getRemainingDeletionTime = (deletionExecuteAt?: Date) => {
    if (!deletionExecuteAt) return '24 hours';
    const diffMs = deletionExecuteAt.getTime() - Date.now();
    if (diffMs <= 0) return 'Expired (Purging...)';
    const hours = Math.floor(diffMs / (3600 * 1000));
    const mins = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
    return `${hours}h ${mins}m`;
  };

  useEffect(() => {
    loadSources();
  }, [vaultId]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#0A0A0A] p-4 sm:p-6 rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-50 dark:bg-[#111111] border border-brand-200/60 dark:border-[#242424] flex items-center justify-center text-brand-600 dark:text-[#1DB954] shrink-0">
            <HardDrive className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
              Physical USB Hardware Sources
            </h1>
            <p className="text-xs text-slate-500 dark:text-[#8A8A8A]">
              Verified physical USB storage drives paired with this Bright Cloud Vault
            </p>
            {sources.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-[#8A8A8A] bg-slate-100 dark:bg-[#111111] px-2.5 py-0.5 rounded-md border border-slate-200/80 dark:border-[#242424]">
                  <span className="font-semibold text-slate-800 dark:text-[#E6E6E6]">{sources.length}</span> {sources.length === 1 ? 'source' : 'sources'}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-[#8A8A8A] bg-slate-100 dark:bg-[#111111] px-2.5 py-0.5 rounded-md border border-slate-200/80 dark:border-[#242424]">
                  <span className="font-semibold text-slate-800 dark:text-[#E6E6E6]">
                    {sources.reduce((acc, s) => acc + (s.totalFilesBackedUp || 0), 0).toLocaleString()}
                  </span> files backed up
                </span>
              </div>
            )}
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleManualRefresh}
          disabled={isLoading || isRefreshing}
          className="w-10 h-10 sm:w-9 sm:h-9 p-0 flex items-center justify-center self-end sm:self-auto text-slate-500 hover:text-slate-700 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6] active:scale-95 transition-transform"
          title="Refresh hardware sources"
          aria-label="Refresh hardware sources"
        >
          <RefreshCw className={`w-4 h-4 ${isRefreshing || isLoading ? 'animate-spin text-brand-600 dark:text-[#1DB954]' : ''}`} />
        </Button>
      </div>

      {/* Sources Grid */}
      {isLoading ? (
        <LoadingState message="Discovering connected hardware sources..." />
      ) : error ? (
        <ErrorState message={error} onRetry={loadSources} />
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<HardDrive className="w-6 h-6 text-brand-500 dark:text-[#1DB954]" />}
          title="No USB sources registered"
          description="No physical USB drives have backed up to this vault yet. Connect a USB drive to your backup daemon to register the device."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sources.map((src) => (
            <div
              key={src.sourceId}
              className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-5 shadow-sm hover:border-brand-300 dark:hover:border-[#1DB954]/50 dark:hover:bg-[#111111] transition-all flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-[#181818] border border-slate-200 dark:border-[#242424] flex items-center justify-center text-slate-700 dark:text-[#E6E6E6]">
                      <HardDrive className="w-5 h-5 text-brand-500 dark:text-[#1DB954]" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-[#E6E6E6] leading-tight">
                        {src.displayName || src.sourceId}
                      </h3>
                      <p className="text-[11px] font-mono text-slate-400 dark:text-[#8A8A8A] mt-0.5">
                        ID: {src.sourceId}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {src.status === 'PENDING_DELETION' ? (
                      <Badge variant="warning" size="sm" className="gap-1">
                        <Clock className="w-3 h-3 text-amber-600" />
                        Pending Deletion
                      </Badge>
                    ) : (
                      <Badge variant="success" size="sm">
                        Verified
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Specs & Hardware Telemetry */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#242424] grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="bg-slate-50 dark:bg-[#111111] p-2.5 rounded-lg border border-slate-100 dark:border-[#242424]">
                    <span className="text-[10px] uppercase font-sans text-slate-400 dark:text-[#8A8A8A] block font-semibold">
                      Files Backed Up
                    </span>
                    <span className="text-sm font-bold text-slate-800 dark:text-[#E6E6E6]">
                      {src.totalFilesBackedUp.toLocaleString()}
                    </span>
                  </div>

                  <div className="bg-slate-50 dark:bg-[#111111] p-2.5 rounded-lg border border-slate-100 dark:border-[#242424]">
                    <span className="text-[10px] uppercase font-sans text-slate-400 dark:text-[#8A8A8A] block font-semibold">
                      USB VID / PID
                    </span>
                    <span className="text-xs font-bold text-slate-700 dark:text-[#E6E6E6]">
                      0x{src.usbVendorId.toString(16).toUpperCase()} : 0x
                      {src.usbProductId.toString(16).toUpperCase()}
                    </span>
                  </div>

                  {src.volumeUuid && (
                    <div className="bg-slate-50 dark:bg-[#111111] p-2.5 rounded-lg border border-slate-100 dark:border-[#242424] col-span-2">
                      <span className="text-[10px] uppercase font-sans text-slate-400 dark:text-[#8A8A8A] block font-semibold">
                        Volume UUID
                      </span>
                      <span className="text-xs text-slate-700 dark:text-[#E6E6E6] truncate block">
                        {src.volumeUuid}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 dark:text-[#8A8A8A]">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    First seen: {formatDate(src.firstSeen)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    Last active: {formatDate(src.lastSeen)}
                  </span>
                </div>

                {/* 24h Undo Banner */}
                {src.status === 'PENDING_DELETION' && (
                  <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/90 dark:border-amber-800/80 rounded-lg text-xs text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                      <div>
                        <span className="font-semibold block">
                          Scheduled for Deletion: {getRemainingDeletionTime(src.deletionExecuteAt)}
                        </span>
                        All files remain safe. You can undo anytime or purge immediately.
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleCancelDeletion(src)}
                        className="text-xs font-semibold text-brand-600 dark:text-[#1DB954] bg-white dark:bg-[#181818] hover:bg-slate-50 dark:hover:bg-[#242424] gap-1 shadow-xs"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Undo
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleImmediatePurge(src)}
                          className="text-xs font-semibold gap-1"
                          title="Skip remaining 24h window and purge immediately"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Purge Now
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 mt-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate(`/files/${src.sourceId}`)}
                  className="flex-1 justify-center gap-2"
                >
                  <Folder className="w-4 h-4 text-brand-500 dark:text-[#1DB954]" />
                  Browse Source Files
                </Button>

                {isAdmin && (
                  src.status === 'PENDING_DELETION' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancelDeletion(src)}
                      className="text-brand-600 dark:text-[#1DB954] hover:bg-brand-50 dark:hover:bg-[#181818] gap-1.5 text-xs font-semibold"
                      title="Undo scheduled deletion"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Undo Deletion
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTargetDeleteSource(src)}
                      className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 p-2"
                      title="Delete entire drive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 2-Step Scheduled Delete Modal */}
      <DeleteDriveModal
        isOpen={Boolean(targetDeleteSource)}
        onClose={() => setTargetDeleteSource(null)}
        source={targetDeleteSource}
        onConfirmSchedule={handleConfirmSchedule}
      />
    </div>
  );
};
