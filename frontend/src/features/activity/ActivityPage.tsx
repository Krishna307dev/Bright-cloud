import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  Clock,
  AlertCircle,
  HardDrive,
  RefreshCw,
  Loader2,
  XCircle,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Search,
  ExternalLink,
  Layers,
  Database,
  Users,
  LogIn,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { JobService } from '../../services/firestore/jobService';
import { SourceService } from '../../services/firestore/sourceService';
import { VaultService } from '../../services/firestore/vaultService';
import type { BackupJob, ContentHashRecord, FileRecord, SourceEntity, UserProfile } from '../../models';
import { UserActivityTab } from './components/UserActivityTab';
import { SignInActivityTab } from './components/SignInActivityTab';
import { formatDate, formatBytes } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { FileIcon } from '../../components/ui/FileIcon';
import { LoadingState } from '../../components/feedback/LoadingState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { EmptyState } from '../../components/feedback/EmptyState';
import { usePageTitle } from '../../hooks/usePageTitle';
import { useToast } from '../../components/ui/Toast';

type FilterTab = 'all' | 'active' | 'completed' | 'issues';

function formatDuration(start: Date, end?: Date): string {
  if (!end) return 'In progress';
  const diffSec = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${min}m ${sec}s`;
}

export const ActivityPage: React.FC = () => {
  usePageTitle('Activity');
  const { vaultId, isAdmin } = useAuth();
  const toast = useToast();

  // Page-level view mode: backup sessions vs user activity vs sign-in activity (admin-only)
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTab = searchParams.get('tab');
  const [pageTab, setPageTab] = useState<'backup' | 'userActivity' | 'signIns'>(
    (paramTab === 'user' || paramTab === 'user-activity' || paramTab === 'userActivity') && isAdmin
      ? 'userActivity'
      : (paramTab === 'signins' || paramTab === 'logins' || paramTab === 'sign-ins') && isAdmin
      ? 'signIns'
      : 'backup'
  );

  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [sources, setSources] = useState<Map<string, SourceEntity>>(new Map());
  const [contentHashes, setContentHashes] = useState<ContentHashRecord[]>([]);
  const [vaultUsers, setVaultUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  // Sync state if user loses admin privileges
  useEffect(() => {
    if (!isAdmin && (pageTab === 'userActivity' || pageTab === 'signIns')) {
      setPageTab('backup');
    }
  }, [isAdmin, pageTab]);

  const handleTabChange = (tab: 'backup' | 'userActivity' | 'signIns') => {
    if ((tab === 'userActivity' || tab === 'signIns') && !isAdmin) return;
    setPageTab(tab);
    if (tab === 'userActivity') {
      setSearchParams({ tab: 'user' });
    } else if (tab === 'signIns') {
      setSearchParams({ tab: 'signins' });
    } else {
      setSearchParams({});
    }
  };

  // Filters & Search
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Expandable state
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());
  const [jobFilesMap, setJobFilesMap] = useState<Map<string, FileRecord[]>>(new Map());
  const [loadingJobFiles, setLoadingJobFiles] = useState<Set<string>>(new Set());

  // Content hashes section
  const [isHashesExpanded, setIsHashesExpanded] = useState(false);
  const [hashSearchQuery, setHashSearchQuery] = useState('');
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // Load sources metadata for friendly display names
  const loadSources = useCallback(async () => {
    if (!vaultId) return;
    try {
      const list = await SourceService.listSources(vaultId);
      const map = new Map<string, SourceEntity>();
      list.forEach((s) => map.set(s.sourceId, s));
      setSources(map);
    } catch {
      // Non-fatal if source metadata fails to load
    }
  }, [vaultId]);

  // Load registered vault users for user activity dropdown and aggregation
  const loadVaultUsers = useCallback(async () => {
    if (!vaultId || !isAdmin) return;
    try {
      const list = await VaultService.listUsers(vaultId);
      setVaultUsers(list);
    } catch {
      // Non-fatal fallback
    }
  }, [vaultId, isAdmin]);

  // Load content hashes
  const loadContentHashes = useCallback(async () => {
    if (!vaultId) return;
    try {
      const hashes = await JobService.getContentHashes(vaultId);
      setContentHashes(hashes);
    } catch {
      // Non-fatal
    }
  }, [vaultId]);

  // Real-time jobs subscription
  useEffect(() => {
    if (!vaultId) return;
    setIsLoading(true);
    setError(null);

    loadSources();
    loadContentHashes();
    if (isAdmin) {
      loadVaultUsers();
    }

    const unsubscribe = JobService.subscribeRecentJobs(
      vaultId,
      (updatedJobs) => {
        setJobs(updatedJobs);
        setIsLoading(false);
      },
      (err) => {
        setError(`Failed to retrieve activity stream: ${err.message}`);
        setIsLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [vaultId, isAdmin, loadSources, loadContentHashes, loadVaultUsers]);

  const handleManualRefresh = async () => {
    if (!vaultId) return;
    try {
      setIsRefreshing(true);
      await Promise.all([
        loadSources(),
        loadContentHashes(),
        isAdmin ? loadVaultUsers() : Promise.resolve(),
      ]);
      const list = await JobService.listRecentJobs(vaultId);
      setJobs(list);
      toast.success('Activity timeline updated');
    } catch (err: any) {
      toast.error(`Refresh failed: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const toggleJobExpansion = async (jobId: string) => {
    setExpandedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) {
        next.delete(jobId);
      } else {
        next.add(jobId);
        // Load files for this job if not already cached
        if (!jobFilesMap.has(jobId) && vaultId) {
          fetchFilesForJob(jobId);
        }
      }
      return next;
    });
  };

  const fetchFilesForJob = async (jobId: string) => {
    if (!vaultId) return;
    setLoadingJobFiles((prev) => new Set(prev).add(jobId));
    try {
      const files = await JobService.getJobFiles(vaultId, jobId);
      setJobFilesMap((prev) => new Map(prev).set(jobId, files));
    } catch (err: any) {
      toast.error(`Failed to load files for job: ${err.message}`);
    } finally {
      setLoadingJobFiles((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
    toast.success('Hash copied to clipboard');
  };

  const handleDismissJob = async (jobId: string) => {
    if (!vaultId) return;
    if (!window.confirm('Dismiss this historical job record from the timeline?')) {
      return;
    }

    try {
      setDismissingId(jobId);
      await JobService.dismissJob(vaultId, jobId);
      setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
      toast.success('Record dismissed');
    } catch (err: any) {
      toast.error(`Failed to dismiss record: ${err?.message}`);
    } finally {
      setDismissingId(null);
    }
  };

  const isJobStale = (job: BackupJob): boolean => {
    const isTerminal = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.state);
    if (isTerminal) return false;
    const now = Date.now();
    const jobStartTime = job.startedAt.getTime();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    return now - jobStartTime > ONE_DAY_MS;
  };

  const getStateBadge = (job: BackupJob) => {
    if (isJobStale(job)) {
      return (
        <Badge variant="neutral" size="sm" className="gap-1.5 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30">
          <Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" />
          Stale session
        </Badge>
      );
    }

    switch (job.state) {
      case 'COMPLETED':
        return (
          <Badge variant="success" size="sm" className="gap-1.5 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            Completed
          </Badge>
        );
      case 'UPLOADING':
        return (
          <Badge variant="brand" size="sm" className="gap-1.5 border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/30">
            <Loader2 className="w-3 h-3 animate-spin text-sky-600 dark:text-sky-400" />
            Uploading
          </Badge>
        );
      case 'HASHING':
        return (
          <Badge variant="neutral" size="sm" className="gap-1.5 border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30">
            <Loader2 className="w-3 h-3 animate-spin text-indigo-600 dark:text-indigo-400" />
            Hashing
          </Badge>
        );
      case 'DEDUPLICATING':
        return (
          <Badge variant="neutral" size="sm" className="gap-1.5 border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30">
            <Loader2 className="w-3 h-3 animate-spin text-purple-600 dark:text-purple-400" />
            Deduplicating
          </Badge>
        );
      case 'SCANNING':
        return (
          <Badge variant="neutral" size="sm" className="gap-1.5 border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30">
            <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />
            Scanning
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge variant="danger" size="sm" className="gap-1.5 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30">
            <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
            Failed
          </Badge>
        );
      case 'CANCELLED':
        return (
          <Badge variant="neutral" size="sm" className="gap-1.5 border-slate-300 dark:border-[#333333] text-slate-700 dark:text-slate-400 bg-slate-50 dark:bg-[#181818]">
            <XCircle className="w-3 h-3 text-slate-500" />
            Cancelled
          </Badge>
        );
      default:
        return (
          <Badge variant="neutral" size="sm">
            {job.state}
          </Badge>
        );
    }
  };

  // Metrics calculations
  const totalUploaded = useMemo(
    () => jobs.reduce((sum, j) => sum + (j.uploadedFiles || 0), 0),
    [jobs]
  );
  const totalSkipped = useMemo(
    () => jobs.reduce((sum, j) => sum + (j.skippedFiles || 0), 0),
    [jobs]
  );
  const activeJobs = useMemo(
    () => jobs.filter((j) => ['SCANNING', 'HASHING', 'DEDUPLICATING', 'UPLOADING'].includes(j.state) && !isJobStale(j)),
    [jobs]
  );
  const completedJobs = useMemo(
    () => jobs.filter((j) => j.state === 'COMPLETED'),
    [jobs]
  );
  const issueJobs = useMemo(
    () => jobs.filter((j) => j.state === 'FAILED' || isJobStale(j) || (j.errorFiles || 0) > 0),
    [jobs]
  );

  // Bandwidth saved estimate from content hashes
  const estimatedBytesSaved = useMemo(() => {
    if (contentHashes.length === 0 || totalSkipped === 0) return 0;
    const avgSize = contentHashes.reduce((acc, h) => acc + h.size, 0) / contentHashes.length;
    return Math.round(avgSize * totalSkipped);
  }, [contentHashes, totalSkipped]);

  // Filtered jobs list
  const filteredJobs = useMemo(() => {
    let list = jobs;
    if (activeTab === 'active') {
      list = activeJobs;
    } else if (activeTab === 'completed') {
      list = completedJobs;
    } else if (activeTab === 'issues') {
      list = issueJobs;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((j) => {
        const sourceName = sources.get(j.sourceId)?.displayName?.toLowerCase() || '';
        return (
          j.jobId.toLowerCase().includes(q) ||
          j.sourceId.toLowerCase().includes(q) ||
          sourceName.includes(q)
        );
      });
    }

    return list;
  }, [jobs, activeTab, activeJobs, completedJobs, issueJobs, searchQuery, sources]);

  // Filtered content hashes for deduplication inspector
  const filteredHashes = useMemo(() => {
    if (!hashSearchQuery.trim()) return contentHashes;
    const q = hashSearchQuery.toLowerCase().trim();
    return contentHashes.filter(
      (h) =>
        h.originalName.toLowerCase().includes(q) ||
        h.storedName.toLowerCase().includes(q) ||
        h.sha256.toLowerCase().includes(q) ||
        h.sourceId.toLowerCase().includes(q) ||
        h.relativePath.toLowerCase().includes(q)
    );
  }, [contentHashes, hashSearchQuery]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#0A0A0A] p-4 sm:p-6 rounded-lg border border-slate-200 dark:border-[#242424]">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-md bg-slate-100 dark:bg-[#181818] border border-slate-200 dark:border-[#242424] flex items-center justify-center text-slate-700 dark:text-[#E6E6E6] shrink-0">
            {pageTab === 'userActivity' ? (
              <Users className="w-5 h-5" />
            ) : pageTab === 'signIns' ? (
              <LogIn className="w-5 h-5" />
            ) : (
              <Activity className="w-5 h-5" />
            )}
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
              {pageTab === 'userActivity'
                ? 'User access and audit log'
                : pageTab === 'signIns'
                ? 'Sign-in and session history'
                : 'Ingest and backup timeline'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-[#8A8A8A]">
              {pageTab === 'userActivity'
                ? 'Live audit records of file previews, downloads, and user activity across all drives and collaborators'
                : pageTab === 'signIns'
                ? 'Chronological history of collaborator Google sign-in sessions and vault membership'
                : 'Live telemetry and chronological history of backup jobs executed by daemon clients'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {pageTab === 'backup' && activeJobs.length > 0 && (
            <Badge variant="brand" size="sm" className="gap-1.5 border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/30">
              <Loader2 className="w-3 h-3 animate-spin text-sky-600 dark:text-sky-400" />
              {activeJobs.length} active session{activeJobs.length > 1 ? 's' : ''}
            </Badge>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isLoading || isRefreshing}
            className="min-h-[44px] min-w-[44px] p-0 flex items-center justify-center text-slate-600 hover:text-slate-900 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6]"
            title="Refresh activity"
            aria-label="Refresh activity"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-emerald-600 dark:text-emerald-400' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Top Navigation Tabs: Backup sessions vs User Activity vs Sign-in Activity (Admin Only) */}
      {isAdmin && (
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#111111] p-1 rounded-md border border-slate-200 dark:border-[#242424] w-fit">
          <button
            type="button"
            onClick={() => handleTabChange('backup')}
            className={`min-h-[36px] px-3.5 py-1.5 text-xs rounded font-medium flex items-center gap-2 transition-colors ${
              pageTab === 'backup'
                ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Backup sessions</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('userActivity')}
            className={`min-h-[36px] px-3.5 py-1.5 text-xs rounded font-medium flex items-center gap-2 transition-colors ${
              pageTab === 'userActivity'
                ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>User Activity</span>
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('signIns')}
            className={`min-h-[36px] px-3.5 py-1.5 text-xs rounded font-medium flex items-center gap-2 transition-colors ${
              pageTab === 'signIns'
                ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
            }`}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Sign-in Activity</span>
          </button>
        </div>
      )}

      {pageTab === 'userActivity' && isAdmin ? (
        <UserActivityTab
          vaultId={vaultId || 'default'}
          users={vaultUsers}
          sources={sources}
        />
      ) : pageTab === 'signIns' && isAdmin ? (
        <SignInActivityTab
          vaultId={vaultId || 'default'}
          users={vaultUsers}
        />
      ) : (
        <>
          {/* KPI Overview Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#0A0A0A] p-4 rounded-lg border border-slate-200 dark:border-[#242424]">
          <span className="text-xs text-slate-500 dark:text-[#8A8A8A] block font-medium">
            Total sessions
          </span>
          <span className="text-xl font-semibold text-slate-900 dark:text-[#E6E6E6] font-mono tabular-nums mt-1 block">
            {jobs.length.toLocaleString()}
          </span>
          <span className="text-[11px] text-slate-400 dark:text-[#666666] mt-0.5 block font-mono">
            {completedJobs.length} completed
          </span>
        </div>

        <div className="bg-white dark:bg-[#0A0A0A] p-4 rounded-lg border border-slate-200 dark:border-[#242424]">
          <span className="text-xs text-emerald-700 dark:text-emerald-400 block font-medium">
            Files uploaded
          </span>
          <span className="text-xl font-semibold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums mt-1 block">
            {totalUploaded.toLocaleString()}
          </span>
          <span className="text-[11px] text-slate-400 dark:text-[#666666] mt-0.5 block font-mono">
            Committed to cloud storage
          </span>
        </div>

        <div className="bg-white dark:bg-[#0A0A0A] p-4 rounded-lg border border-slate-200 dark:border-[#242424]">
          <span className="text-xs text-sky-700 dark:text-sky-400 block font-medium">
            Deduplicated files
          </span>
          <span className="text-xl font-semibold text-sky-700 dark:text-sky-400 font-mono tabular-nums mt-1 block">
            {totalSkipped.toLocaleString()}
          </span>
          <span className="text-[11px] text-slate-400 dark:text-[#666666] mt-0.5 block font-mono">
            Identical content skipped
          </span>
        </div>

        <div className="bg-white dark:bg-[#0A0A0A] p-4 rounded-lg border border-slate-200 dark:border-[#242424]">
          <span className="text-xs text-slate-500 dark:text-[#8A8A8A] block font-medium">
            Bandwidth saved
          </span>
          <span className="text-xl font-semibold text-slate-900 dark:text-[#E6E6E6] font-mono tabular-nums mt-1 block">
            {formatBytes(estimatedBytesSaved)}
          </span>
          <span className="text-[11px] text-slate-400 dark:text-[#666666] mt-0.5 block font-mono">
            {contentHashes.length} unique hashes in vault
          </span>
        </div>
      </div>

      {/* Content Deduplication Registry Card */}
      <div className="bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#242424] rounded-lg p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 text-xs text-slate-700 dark:text-[#8A8A8A]">
            <Layers className="w-5 h-5 text-slate-600 dark:text-slate-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-slate-900 dark:text-[#E6E6E6] text-sm">
                Content addressable storage and deduplication index
              </div>
              <p className="text-slate-500 dark:text-[#8A8A8A] text-xs mt-0.5">
                Files matching existing SHA-256 hashes are skipped across backup passes. Exact canonical copies are indexed below.
              </p>
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsHashesExpanded(!isHashesExpanded)}
            className="min-h-[44px] gap-1.5 shrink-0 self-start sm:self-auto text-xs"
          >
            {isHashesExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {isHashesExpanded ? 'Hide index' : `Inspect canonical hashes (${contentHashes.length})`}
          </Button>
        </div>

        {isHashesExpanded && (
          <div className="pt-4 border-t border-slate-200 dark:border-[#242424] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-700 dark:text-[#E6E6E6]">
                Vault canonical content hashes ({filteredHashes.length})
              </span>
              <div className="relative w-full sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter hashes or files..."
                  value={hashSearchQuery}
                  onChange={(e) => setHashSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-[#111111] border border-slate-200 dark:border-[#242424] rounded text-slate-800 dark:text-[#E6E6E6] focus:outline-none focus:border-slate-400"
                />
              </div>
            </div>

            {filteredHashes.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-[#666666] italic py-2">
                No matching content hash records found.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto rounded border border-slate-200 dark:border-[#242424] bg-slate-50 dark:bg-[#111111]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-[#181818] border-b border-slate-200 dark:border-[#242424] text-slate-600 dark:text-[#8A8A8A] text-[11px] uppercase tracking-wider sticky top-0 font-medium">
                    <tr>
                      <th className="py-2.5 px-3">Canonical file name</th>
                      <th className="py-2.5 px-3">Storage location</th>
                      <th className="py-2.5 px-3">Size</th>
                      <th className="py-2.5 px-3 font-mono">SHA-256 hash</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-[#242424] text-[11px]">
                    {filteredHashes.map((hash) => {
                      const sourceName = sources.get(hash.sourceId)?.displayName || hash.sourceId || 'Default source';
                      const folderPath = hash.relativePath ? `/${hash.relativePath}` : '/';
                      const explorerUrl = `/files/${encodeURIComponent(hash.sourceId || 'default')}${hash.relativePath ? `/${encodeURIComponent(hash.relativePath.replace(/\/$/, ''))}` : ''}`;

                      return (
                        <tr key={hash.sha256} className="hover:bg-white dark:hover:bg-[#181818] transition-colors">
                          <td className="py-2 px-3 font-medium text-slate-900 dark:text-[#E6E6E6] min-w-0">
                            <div className="truncate max-w-[200px]" title={hash.originalName || hash.storedName}>
                              {hash.originalName || hash.storedName}
                            </div>
                            <div className="text-[10px] text-slate-400 dark:text-[#666666] mt-0.5">
                              Indexed: {formatDate(hash.uploadedAt)}
                            </div>
                          </td>

                          <td className="py-2 px-3 text-slate-600 dark:text-[#8A8A8A]">
                            <div className="truncate max-w-[180px]" title={`${sourceName} • ${folderPath}`}>
                              <span className="font-medium text-slate-800 dark:text-[#CCCCCC]">{sourceName}</span>
                              <span className="font-mono text-slate-400 dark:text-[#666666] block text-[10px] truncate">{folderPath}</span>
                            </div>
                          </td>

                          <td className="py-2 px-3 text-slate-600 dark:text-[#8A8A8A] font-mono tabular-nums">
                            {formatBytes(hash.size)}
                          </td>

                          <td className="py-2 px-3 text-slate-500 dark:text-[#8A8A8A] font-mono">
                            <div className="flex items-center gap-1.5">
                              <span title={hash.sha256}>{hash.sha256.substring(0, 12)}...</span>
                              <button
                                onClick={() => handleCopyHash(hash.sha256)}
                                className="min-h-[32px] min-w-[32px] flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-[#E6E6E6]"
                                title="Copy full SHA-256 hash"
                                aria-label="Copy full SHA-256 hash"
                              >
                                {copiedHash === hash.sha256 ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </td>

                          <td className="py-2 px-3 text-right">
                            <Link
                              to={explorerUrl}
                              className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6] text-xs font-medium"
                              title="Locate file in explorer"
                            >
                              <span>Locate</span>
                              <ExternalLink className="w-3 h-3" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filter Tabs and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#111111] p-1 rounded-md border border-slate-200 dark:border-[#242424] self-start">
          <button
            onClick={() => setActiveTab('all')}
            className={`min-h-[36px] px-3 py-1 text-xs rounded font-medium transition-colors ${
              activeTab === 'all'
                ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
            }`}
          >
            All sessions ({jobs.length})
          </button>
          <button
            onClick={() => setActiveTab('active')}
            className={`min-h-[36px] px-3 py-1 text-xs rounded font-medium transition-colors ${
              activeTab === 'active'
                ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
            }`}
          >
            Active ({activeJobs.length})
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`min-h-[36px] px-3 py-1 text-xs rounded font-medium transition-colors ${
              activeTab === 'completed'
                ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
            }`}
          >
            Completed ({completedJobs.length})
          </button>
          <button
            onClick={() => setActiveTab('issues')}
            className={`min-h-[36px] px-3 py-1 text-xs rounded font-medium transition-colors ${
              activeTab === 'issues'
                ? 'bg-white dark:bg-[#1F1F1F] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
            }`}
          >
            Issues ({issueJobs.length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by job ID or drive..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#242424] rounded-md text-slate-800 dark:text-[#E6E6E6] focus:outline-none focus:border-slate-400"
          />
        </div>
      </div>

      {/* Jobs Feed List */}
      {isLoading ? (
        <LoadingState message="Loading backup activity stream..." />
      ) : error ? (
        <ErrorState message={error} onRetry={handleManualRefresh} />
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          icon={<Activity className="w-6 h-6 text-slate-500" />}
          title="No sessions found"
          description={
            searchQuery
              ? `No backup sessions match the query '${searchQuery}'.`
              : 'No activity recorded under the selected filter.'
          }
        />
      ) : (
        <div className="space-y-4">
          {filteredJobs.map((job) => {
            const stale = isJobStale(job);
            const isDismissing = dismissingId === job.jobId;
            const isExpanded = expandedJobIds.has(job.jobId);
            const sourceEntity = sources.get(job.sourceId);
            const sourceDisplayName = sourceEntity?.displayName || `USB Drive ${job.sourceId}`;
            const isJobActive = ['SCANNING', 'HASHING', 'DEDUPLICATING', 'UPLOADING'].includes(job.state) && !stale;

            // Progress calculations
            const total = job.totalFiles || 0;
            const uploaded = job.uploadedFiles || 0;
            const skipped = job.skippedFiles || 0;
            const errors = job.errorFiles || 0;
            const processed = uploaded + skipped + errors;
            const inQueue = Math.max(0, total - processed);

            const uploadPercent = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 0;
            const skippedPercent = total > 0 ? Math.min(100, Math.round((skipped / total) * 100)) : 0;
            const overallPercent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 100;

            const jobFiles = jobFilesMap.get(job.jobId) || [];
            const isLoadingFiles = loadingJobFiles.has(job.jobId);

            return (
              <div
                key={job.jobId}
                className="bg-white dark:bg-[#0A0A0A] rounded-lg border border-slate-200 dark:border-[#242424] p-4 sm:p-5 space-y-4"
              >
                {/* Header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-[#1E1E1E] pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-900 dark:text-[#E6E6E6]">
                      Job {job.jobId.substring(0, 18)}
                    </span>
                    {getStateBadge(job)}

                    <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-[#8A8A8A] bg-slate-50 dark:bg-[#141414] px-2 py-0.5 rounded border border-slate-200 dark:border-[#242424]">
                      <HardDrive className="w-3 h-3 text-slate-500" />
                      <span className="font-medium truncate max-w-[200px]" title={sourceDisplayName}>
                        {sourceDisplayName}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-[#8A8A8A]">
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                      <Clock className="w-3 h-3" />
                      {formatDate(job.startedAt)} • {formatDuration(job.startedAt, job.completedAt)}
                    </span>

                    {isAdmin && stale && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDismissJob(job.jobId)}
                        isLoading={isDismissing}
                        className="text-xs text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 p-1 min-h-[36px]"
                        title="Dismiss unfinalized record"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Dismiss
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleJobExpansion(job.jobId)}
                      className="min-h-[44px] px-2 text-xs text-slate-600 hover:text-slate-900 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6] flex items-center gap-1"
                      aria-expanded={isExpanded}
                    >
                      <span>{isExpanded ? 'Hide details' : 'View files'}</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>

                {/* Stale Warning Banner */}
                {stale && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 rounded text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      Session started on {formatDate(job.startedAt)} in state &apos;{job.state}&apos;, but recorded no activity for over 24 hours. The record was not finalized by the client daemon.
                    </div>
                  </div>
                )}

                {/* Live Progress Bar (for all jobs) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-[#E6E6E6] flex items-center gap-2">
                      {isJobActive ? (
                        <>
                          <Loader2 className="w-3 h-3 animate-spin text-sky-600 dark:text-sky-400" />
                          <span>Processing files ({job.state.toLowerCase()})...</span>
                        </>
                      ) : (
                        <span>Session progress</span>
                      )}
                    </span>
                    <span className="font-mono tabular-nums text-slate-500 dark:text-[#8A8A8A]">
                      {total > 0 ? `${overallPercent}% (${processed} of ${total})` : '0 files discovered'}
                    </span>
                  </div>

                  {total > 0 && (
                    <div className="w-full h-2 rounded bg-slate-100 dark:bg-[#1E1E1E] overflow-hidden flex">
                      <div
                        style={{ width: `${uploadPercent}%` }}
                        className="bg-emerald-600 dark:bg-emerald-500 h-full transition-[width] duration-300 ease-out"
                        title={`Uploaded: ${uploaded} files`}
                      />
                      <div
                        style={{ width: `${skippedPercent}%` }}
                        className="bg-sky-600 dark:bg-sky-500 h-full transition-[width] duration-300 ease-out"
                        title={`Deduplicated: ${skipped} files`}
                      />
                    </div>
                  )}
                </div>

                {/* Metric Summary Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  <div className="bg-slate-50 dark:bg-[#111111] p-2.5 rounded border border-slate-100 dark:border-[#1E1E1E]">
                    <span className="text-[11px] text-slate-400 dark:text-[#666666] block font-medium">Discovered</span>
                    <span className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] font-mono tabular-nums">
                      {total.toLocaleString()}
                    </span>
                  </div>

                  <div className="bg-slate-50 dark:bg-[#111111] p-2.5 rounded border border-slate-100 dark:border-[#1E1E1E]">
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400 block font-medium">Uploaded</span>
                    <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">
                      {uploaded.toLocaleString()}
                    </span>
                  </div>

                  <div className="bg-slate-50 dark:bg-[#111111] p-2.5 rounded border border-slate-100 dark:border-[#1E1E1E]">
                    <span className="text-[11px] text-sky-700 dark:text-sky-400 block font-medium">Skipped (dedup)</span>
                    <span className="text-sm font-semibold text-sky-700 dark:text-sky-400 font-mono tabular-nums">
                      {skipped.toLocaleString()}
                    </span>
                  </div>

                  <div className="bg-slate-50 dark:bg-[#111111] p-2.5 rounded border border-slate-100 dark:border-[#1E1E1E]">
                    <span className="text-[11px] text-slate-400 dark:text-[#666666] block font-medium">In queue</span>
                    <span className="text-sm font-semibold text-slate-700 dark:text-[#CCCCCC] font-mono tabular-nums">
                      {inQueue.toLocaleString()}
                    </span>
                  </div>

                  <div className="bg-slate-50 dark:bg-[#111111] p-2.5 rounded border border-slate-100 dark:border-[#1E1E1E]">
                    <span className="text-[11px] text-slate-400 dark:text-[#666666] block font-medium">Errors</span>
                    <span className={`text-sm font-semibold font-mono tabular-nums ${errors > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-[#CCCCCC]'}`}>
                      {errors}
                    </span>
                  </div>
                </div>

                {/* Deduplication Callout if duplicates skipped */}
                {skipped > 0 && (
                  <div className="p-3 bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/60 rounded text-xs text-sky-900 dark:text-sky-300 flex items-start gap-2">
                    <Database className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="font-semibold block text-sky-950 dark:text-sky-200">
                        Content deduplication: {skipped.toLocaleString()} duplicate files skipped
                      </span>
                      <p className="text-[11px] text-sky-800 dark:text-sky-300/80">
                        Identical SHA-256 byte hashes already exist in this vault. Redundant files were not re-uploaded to Backblaze B2, saving bandwidth and cloud storage.
                      </p>
                    </div>
                  </div>
                )}

                {/* Expandable Session File List */}
                {isExpanded && (
                  <div className="pt-3 border-t border-slate-100 dark:border-[#1E1E1E] space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800 dark:text-[#E6E6E6]">
                        Files recorded in session ({jobFiles.length})
                      </span>
                      {isJobActive && inQueue > 0 && (
                        <span className="text-slate-500 dark:text-[#8A8A8A] font-mono text-[11px]">
                          {inQueue} remaining in processing queue
                        </span>
                      )}
                    </div>

                    {isLoadingFiles ? (
                      <div className="py-6 flex items-center justify-center text-xs text-slate-500 dark:text-[#8A8A8A] gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                        <span>Querying files recorded for this job...</span>
                      </div>
                    ) : jobFiles.length === 0 ? (
                      <div className="py-4 px-3 bg-slate-50 dark:bg-[#111111] rounded border border-slate-200 dark:border-[#242424] text-xs text-slate-500 dark:text-[#8A8A8A]">
                        {total === 0
                          ? 'Zero files discovered on source device during this session.'
                          : 'No uploaded file records finalized yet. In-flight tasks may still be uploading or deduplicated.'}
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto rounded border border-slate-200 dark:border-[#242424] bg-slate-50 dark:bg-[#111111]">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-100 dark:bg-[#181818] border-b border-slate-200 dark:border-[#242424] text-slate-600 dark:text-[#8A8A8A] text-[11px] uppercase tracking-wider sticky top-0 font-medium">
                            <tr>
                              <th className="py-2.5 px-3">File name</th>
                              <th className="py-2.5 px-3">Relative path</th>
                              <th className="py-2.5 px-3">Size</th>
                              <th className="py-2.5 px-3 font-mono">SHA-256 hash</th>
                              <th className="py-2.5 px-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-[#242424] text-[11px]">
                            {jobFiles.map((file) => {
                              const folderPath = file.relativePath ? `/${file.relativePath}` : '/';
                              const explorerUrl = `/files/${encodeURIComponent(file.sourceId || 'default')}${file.relativePath ? `/${encodeURIComponent(file.relativePath.replace(/\/$/, ''))}` : ''}`;

                              return (
                                <tr key={file.fileId} className="hover:bg-white dark:hover:bg-[#181818] transition-colors">
                                  <td className="py-2 px-3 font-medium text-slate-900 dark:text-[#E6E6E6]">
                                    <div className="flex items-center gap-2">
                                      <FileIcon fileName={file.originalName} mimeType={file.mimeType} className="w-4 h-4 shrink-0" />
                                      <span className="truncate max-w-[200px]" title={file.originalName}>
                                        {file.originalName}
                                      </span>
                                    </div>
                                  </td>

                                  <td className="py-2 px-3 text-slate-500 dark:text-[#8A8A8A] font-mono">
                                    <span className="truncate max-w-[150px] block" title={folderPath}>
                                      {folderPath}
                                    </span>
                                  </td>

                                  <td className="py-2 px-3 text-slate-600 dark:text-[#8A8A8A] font-mono tabular-nums">
                                    {formatBytes(file.size)}
                                  </td>

                                  <td className="py-2 px-3 text-slate-500 dark:text-[#8A8A8A] font-mono">
                                    <div className="flex items-center gap-1.5">
                                      <span title={file.sha256}>{file.sha256 ? `${file.sha256.substring(0, 10)}...` : '—'}</span>
                                      {file.sha256 && (
                                        <button
                                          onClick={() => handleCopyHash(file.sha256)}
                                          className="min-h-[32px] min-w-[32px] flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-[#E6E6E6]"
                                          title="Copy SHA-256 hash"
                                          aria-label="Copy SHA-256 hash"
                                        >
                                          {copiedHash === file.sha256 ? (
                                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                                          ) : (
                                            <Copy className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                      )}
                                    </div>
                                  </td>

                                  <td className="py-2 px-3 text-right">
                                    <Link
                                      to={explorerUrl}
                                      className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6] text-xs font-medium"
                                      title="Open in file explorer"
                                    >
                                      <span>Explorer</span>
                                      <ExternalLink className="w-3 h-3" />
                                    </Link>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}
    </div>
  );
};
