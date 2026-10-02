import React, { useState, useEffect } from 'react';
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
  Sparkles,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { useAuth } from '../auth/AuthContext';
import { JobService } from '../../services/firestore/jobService';
import type { BackupJob } from '../../models';
import { formatDate, formatBytes } from '../../utils/format';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { LoadingState } from '../../components/feedback/LoadingState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { EmptyState } from '../../components/feedback/EmptyState';
import { usePageTitle } from '../../hooks/usePageTitle';

interface ContentHashRecord {
  sha256: string;
  storedName: string;
  size: number;
  uploadedAt: Date;
  fileId: string;
}

export const ActivityPage: React.FC = () => {
  usePageTitle('Activity');
  const { vaultId, isAdmin } = useAuth();
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [contentHashes, setContentHashes] = useState<ContentHashRecord[]>([]);
  const [isHashesExpanded, setIsHashesExpanded] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const loadJobs = async () => {
    if (!vaultId) return;
    try {
      setIsLoading(true);
      setError(null);
      const [list, hashesSnap] = await Promise.all([
        JobService.listRecentJobs(vaultId),
        getDocs(collection(db, 'vaults', vaultId, 'contentHashes')),
      ]);
      setJobs(list);
      setContentHashes(
        hashesSnap.docs.map((d) => {
          const data = d.data();
          return {
            sha256: d.id,
            storedName: data.storedName || 'Canonical Object',
            size: data.size || 0,
            uploadedAt: data.uploadedAt?.toDate ? data.uploadedAt.toDate() : new Date(),
            fileId: data.fileId || '',
          };
        })
      );
    } catch (err: any) {
      setError(`Failed to retrieve activity log: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, [vaultId]);

  const handleDismissJob = async (jobId: string) => {
    if (!vaultId) return;
    if (
      !window.confirm(
        'Are you sure you want to dismiss this historical job record? This removes the unfinalized log entry from your timeline.'
      )
    ) {
      return;
    }

    try {
      setDismissingId(jobId);
      await JobService.dismissJob(vaultId, jobId);
      setJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    } catch (err: any) {
      alert(`Failed to dismiss job: ${err?.message}`);
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
        <Badge variant="neutral" size="sm" className="gap-1 bg-amber-50 text-amber-800 border-amber-200">
          <Clock className="w-3 h-3 text-amber-600" />
          Stale / No Recent Activity
        </Badge>
      );
    }

    switch (job.state) {
      case 'COMPLETED':
        return (
          <Badge variant="success" size="sm" className="gap-1">
            <CheckCircle2 className="w-3 h-3" />
            Completed
          </Badge>
        );
      case 'UPLOADING':
      case 'HASHING':
      case 'SCANNING':
        return (
          <Badge variant="brand" size="sm" className="gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            {job.state.toLowerCase()}
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge variant="danger" size="sm" className="gap-1">
            <AlertCircle className="w-3 h-3" />
            Failed
          </Badge>
        );
      case 'CANCELLED':
        return (
          <Badge variant="neutral" size="sm" className="gap-1">
            <XCircle className="w-3 h-3" />
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="neutral" size="sm">{job.state}</Badge>;
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#0A0A0A] p-6 rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-50 dark:bg-[#111111] border border-brand-200/60 dark:border-[#242424] flex items-center justify-center text-brand-600 dark:text-[#1DB954]">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
              Ingest & Backup Timeline
            </h1>
            <p className="text-xs text-slate-500 dark:text-[#8A8A8A]">
              Chronological log of USB synchronization jobs executed by the Android backup daemon
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={loadJobs}
          className="p-2 self-end sm:self-auto text-slate-500 hover:text-slate-700 dark:text-[#8A8A8A] dark:hover:text-[#E6E6E6]"
          title="Refresh activity"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {/* Deduplication & Transparency Card */}
      <div className="bg-slate-50 dark:bg-[#0A0A0A] border border-slate-200/80 dark:border-[#242424] rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 text-xs text-slate-700 dark:text-[#8A8A8A]">
            <Sparkles className="w-5 h-5 text-brand-500 dark:text-[#1DB954] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-slate-900 dark:text-[#E6E6E6] text-sm">
                CAS Content Deduplication & Skipped Files Engine
              </div>
              <p className="text-slate-500 dark:text-[#8A8A8A] text-xs mt-0.5 leading-relaxed">
                Files with matching SHA-256 hashes are automatically skipped across backup passes and sources.
                Zero redundant bytes are re-uploaded, saving cloud bandwidth.
              </p>
            </div>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsHashesExpanded(!isHashesExpanded)}
            className="gap-1.5 shrink-0 self-start sm:self-auto text-xs"
          >
            {isHashesExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {isHashesExpanded ? 'Hide Index' : `View Unique Content Hashes (${contentHashes.length})`}
          </Button>
        </div>

        {/* Expandable Content Hashes Table */}
        {isHashesExpanded && (
          <div className="pt-3 border-t border-slate-200/80 dark:border-[#242424] space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#8A8A8A]">
              <span className="font-semibold text-slate-700 dark:text-[#E6E6E6]">
                Canonical Content Hashes in Vault ({contentHashes.length})
              </span>
              <span>All deduplicated files reference these immutable records</span>
            </div>

            {contentHashes.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-[#8A8A8A] italic">No content hashes recorded in vault yet.</p>
            ) : (
              <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#0A0A0A]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-[#111111] border-b border-slate-200 dark:border-[#242424] text-slate-500 dark:text-[#8A8A8A] text-[11px] uppercase tracking-wider sticky top-0">
                    <tr>
                      <th className="py-2 px-3 font-semibold">Canonical Stored Object</th>
                      <th className="py-2 px-3 font-semibold">Size</th>
                      <th className="py-2 px-3 font-semibold">SHA-256 Hash</th>
                      <th className="py-2 px-3 font-semibold text-right">Indexed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#242424] font-mono text-[11px]">
                    {contentHashes.map((hash) => (
                      <tr key={hash.sha256} className="hover:bg-slate-50/60 dark:hover:bg-[#181818]">
                        <td className="py-2 px-3 font-sans font-medium text-slate-800 dark:text-[#E6E6E6] truncate max-w-[200px]" title={hash.storedName}>
                          {hash.storedName}
                        </td>
                        <td className="py-2 px-3 text-slate-600 dark:text-[#8A8A8A] font-mono">
                          {formatBytes(hash.size)}
                        </td>
                        <td className="py-2 px-3 text-slate-500 dark:text-[#8A8A8A] font-mono">
                          <div className="flex items-center gap-1.5">
                            <span title={hash.sha256}>{hash.sha256.substring(0, 16)}...</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(hash.sha256);
                                setCopiedHash(hash.sha256);
                                setTimeout(() => setCopiedHash(null), 2000);
                              }}
                              className="text-slate-400 hover:text-brand-600 dark:text-[#8A8A8A] dark:hover:text-[#1DB954]"
                              title="Copy full SHA-256 hash"
                            >
                              {copiedHash === hash.sha256 ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right font-sans text-slate-400 text-[11px]">
                          {formatDate(hash.uploadedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Jobs Feed */}
      {isLoading ? (
        <LoadingState message="Loading backup activity stream..." />
      ) : error ? (
        <ErrorState message={error} onRetry={loadJobs} />
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<Activity className="w-6 h-6 text-brand-500 dark:text-[#1DB954]" />}
          title="No activity recorded"
          description="No backup sessions have been logged in this vault yet."
        />
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const stale = isJobStale(job);
            const isDismissing = dismissingId === job.jobId;

            return (
              <div
                key={job.jobId}
                className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-5 shadow-sm space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-[#242424] pb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-slate-800 dark:text-[#E6E6E6]">
                      Job {job.jobId.substring(0, 16)}
                    </span>
                    {getStateBadge(job)}
                  </div>

                  <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-[#8A8A8A] font-mono">
                    <span className="flex items-center gap-1 font-sans">
                      <Clock className="w-3.5 h-3.5" />
                      Started: {formatDate(job.startedAt)}
                    </span>
                    {job.completedAt && (
                      <span className="hidden sm:inline font-sans">
                        Finished: {formatDate(job.completedAt)}
                      </span>
                    )}

                    {isAdmin && stale && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDismissJob(job.jobId)}
                        isLoading={isDismissing}
                        className="text-xs text-slate-400 hover:text-rose-600 dark:text-[#8A8A8A] dark:hover:text-rose-400 gap-1 p-1 h-auto"
                        title="Dismiss unfinalized historical record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Dismiss Record
                      </Button>
                    )}
                  </div>
                </div>

                {/* Stale Warning Banner if non-terminal and > 24 hours */}
                {stale && (
                  <div className="p-3 bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/80 rounded-lg text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5 leading-relaxed">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      This backup job was started on {formatDate(job.startedAt)} in state &apos;{job.state}&apos;, but has recorded no activity for over 24 hours. The underlying database record was not finalized.
                    </div>
                  </div>
                )}

                {/* Job Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-slate-50 dark:bg-[#111111] p-3 rounded-lg border border-slate-100 dark:border-[#242424]">
                    <span className="text-[11px] text-slate-400 dark:text-[#8A8A8A] block font-medium">Discovered</span>
                    <span className="text-base font-bold text-slate-800 dark:text-[#E6E6E6]">
                      {job.totalFiles.toLocaleString()} files
                    </span>
                  </div>

                  <div className="bg-emerald-50/60 dark:bg-[#1DB954]/10 p-3 rounded-lg border border-emerald-100 dark:border-[#1DB954]/25">
                    <span className="text-[11px] text-emerald-700 dark:text-[#1DB954] block font-medium">Uploaded</span>
                    <span className="text-base font-bold text-emerald-800 dark:text-[#E6E6E6]">
                      {job.uploadedFiles.toLocaleString()} files
                    </span>
                  </div>

                  <div className="bg-slate-50 dark:bg-[#111111] p-3 rounded-lg border border-slate-100 dark:border-[#242424]">
                    <span className="text-[11px] text-slate-400 dark:text-[#8A8A8A] block font-medium">Skipped (Dedup)</span>
                    <span className="text-base font-bold text-slate-700 dark:text-[#E6E6E6]">
                      {job.skippedFiles.toLocaleString()} files
                    </span>
                  </div>

                  <div className="bg-slate-50 dark:bg-[#111111] p-3 rounded-lg border border-slate-100 dark:border-[#242424]">
                    <span className="text-[11px] text-slate-400 dark:text-[#8A8A8A] block font-medium">Errors</span>
                    <span className="text-base font-bold text-slate-700 dark:text-[#E6E6E6]">
                      {job.errorFiles}
                    </span>
                  </div>
                </div>

                {/* Deduplication Callout if files were skipped */}
                {job.skippedFiles > 0 && (
                  <div className="p-3 bg-emerald-50/70 dark:bg-[#1DB954]/10 border border-emerald-200/80 dark:border-[#1DB954]/25 rounded-lg text-xs text-emerald-900 dark:text-[#E6E6E6] flex items-start gap-2.5 leading-relaxed">
                    <Sparkles className="w-4 h-4 text-emerald-600 dark:text-[#1DB954] shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold block text-emerald-950 dark:text-[#1DB954]">
                        Content Deduplication: {job.skippedFiles.toLocaleString()} duplicate files skipped
                      </span>
                      Exact byte-level SHA-256 matches were found in this vault. Duplicate bytes were not re-uploaded to Backblaze B2, saving bandwidth and cloud storage.
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 text-[11px] text-slate-400 dark:text-[#8A8A8A] font-mono">
                  <HardDrive className="w-3.5 h-3.5 text-slate-400 dark:text-[#8A8A8A]" />
                  <span>Source Device: {job.sourceId}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
