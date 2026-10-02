import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  Server,
  Users,
  CheckCircle2,
  AlertCircle,
  Database,
  ExternalLink,
  Layers,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { VaultService } from '../../services/firestore/vaultService';
import { FileService } from '../../services/firestore/fileService';
import { B2AuthorizerClient, type HealthDiagnostics } from '../../services/b2Authorizer';
import { PropagationEngine } from '../../services/firestore/propagationEngine';
import { ReconciliationService, type ReconciliationSummary } from '../../services/reconciliationService';
import type { VaultConfig } from '../../models';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { useToast } from '../../components/ui/Toast';
import { LoadingState } from '../../components/feedback/LoadingState';
import { usePageTitle } from '../../hooks/usePageTitle';

export const AdminVaultSettingsPage: React.FC = () => {
  usePageTitle('Vault Settings');
  const { vaultId, isAdmin } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null);
  const [vaultNameInput, setVaultNameInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingName, setIsSavingName] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // B2 Health State
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [b2Diagnostics, setB2Diagnostics] = useState<HealthDiagnostics | null>(null);

  // Permission Reconciliation State
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);

  // Stale Reservation Reconciliation State
  const [isReconcilingReservations, setIsReconcilingReservations] = useState(false);
  const [reservationReconcileSummary, setReservationReconcileSummary] = useState<ReconciliationSummary | null>(null);

  // Storage Wipe State
  const [isWiping, setIsWiping] = useState(false);
  const [wipeResult, setWipeResult] = useState<string | null>(null);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);

  useEffect(() => {
    if (vaultId) {
      (window as any).wipeAllStorage = async () => {
        console.log('Initiating wipeAllStorage for vault:', vaultId);
        const res = await FileService.wipeAllStorage(vaultId);
        console.log('wipeAllStorage finished:', res);
        return res;
      };
    }
  }, [vaultId]);

  const loadConfig = async () => {
    if (!vaultId) return;
    try {
      setIsLoading(true);
      setError(null);
      const cfg = await VaultService.getVaultConfig(vaultId);
      setVaultConfig(cfg);
      if (cfg) setVaultNameInput(cfg.vaultName);
    } catch (err: any) {
      setError(`Failed to load vault settings: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, [vaultId]);

  const handleUpdateVaultName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultId || !vaultNameInput.trim()) return;

    try {
      setIsSavingName(true);
      await VaultService.updateVaultConfig(vaultId, {
        vaultName: vaultNameInput.trim(),
      });
      toast.success('Vault name updated');
      await loadConfig();
    } catch (err: any) {
      toast.error(`Failed to update vault name: ${err.message}`);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleCheckB2Health = async () => {
    try {
      setIsCheckingHealth(true);
      setB2Diagnostics(null);
      const diag = await B2AuthorizerClient.getHealthDiagnostics();
      setB2Diagnostics(diag);
      if (diag.healthy) {
        toast.success('B2 Authorizer Cloudflare Worker is healthy and responsive');
      } else {
        toast.error(`B2 Authorizer check failed: ${diag.message || diag.status}`);
      }
    } catch (err: any) {
      setB2Diagnostics({ healthy: false, message: err?.message });
      toast.error(`Health check failed: ${err.message}`);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const handleReconcilePermissions = async () => {
    if (!vaultId) return;
    try {
      setIsReconciling(true);
      setReconcileResult(null);
      toast.info('Starting full vault permission reconciliation...');

      const count = await PropagationEngine.reconcileAllVaultFiles(vaultId);
      setReconcileResult(`Successfully evaluated and reconciled ${count} files.`);
      toast.success(`Reconciliation complete: ${count} files processed`);
    } catch (err: any) {
      toast.error(`Reconciliation error: ${err.message}`);
    } finally {
      setIsReconciling(false);
    }
  };

  const handleReconcileReservations = async () => {
    if (!vaultId) return;
    try {
      setIsReconcilingReservations(true);
      setReservationReconcileSummary(null);
      toast.info('Reconciling stale upload locks & reservations...');

      const summary = await ReconciliationService.reconcileStaleReservations(vaultId);
      setReservationReconcileSummary(summary);
      toast.success(
        `Reconciled: ${summary.expiredLocksReconciled} locks, ${summary.expiredVersionReservationsReconciled} reservations, ${summary.uncommittedCandidatesDeleted} candidate objects compensated.`
      );
    } catch (err: any) {
      toast.error(`Reservation reconciliation failed: ${err.message}`);
    } finally {
      setIsReconcilingReservations(false);
    }
  };

  const handleWipeAllStorage = async () => {
    if (!vaultId) return;
    try {
      setIsWiping(true);
      setWipeResult(null);
      const res = await FileService.wipeAllStorage(vaultId);
      const msg = `Wipe complete: ${res.filesDeleted} files, ${res.sourcesDeleted} drives, ${res.reservationsDeleted} reservations deleted; ${res.b2PurgedCount} B2 versions purged. Fresh empty storage ready.`;
      setWipeResult(msg);
      toast.success('All files and drives wiped successfully. Settings & users preserved.');
      setShowWipeConfirm(false);
    } catch (err: any) {
      toast.error(`Wipe failed: ${err.message}`);
    } finally {
      setIsWiping(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-slate-500 dark:text-[#8A8A8A]">
        Administrator permissions required to access Vault Configuration.
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-white dark:bg-[#0A0A0A] p-6 rounded-xl border border-slate-200/80 dark:border-[#242424] shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-50 dark:bg-[#111111] border border-brand-200/60 dark:border-[#242424] flex items-center justify-center text-brand-600 dark:text-[#1DB954]">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
              Vault Security & Administration
            </h1>
            <p className="text-xs text-slate-500 dark:text-[#8A8A8A]">
              Admin-only vault infrastructure, storage endpoints, and permission consistency
            </p>
          </div>
        </div>

        <Badge variant="brand" size="md">
          Administrator
        </Badge>
      </div>

      {isLoading ? (
        <LoadingState message="Loading vault configuration..." />
      ) : (
        <div className="space-y-6">
          {error && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl p-4 flex items-center justify-between text-xs text-amber-800 dark:text-amber-300">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Failed to load vault identity configuration: {error}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={loadConfig}
                className="text-amber-900 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                Retry
              </Button>
            </div>
          )}

          {/* General Vault Settings */}
          {vaultConfig && (
            <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-6 shadow-sm space-y-4">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] uppercase tracking-wider text-[11px]">
                Vault Identity
              </h2>

            <form onSubmit={handleUpdateVaultName} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-[#E6E6E6] mb-1">
                  Vault Name
                </label>
                <div className="flex gap-2">
                  <Input
                    value={vaultNameInput}
                    onChange={(e) => setVaultNameInput(e.target.value)}
                    required
                    className="max-w-md text-xs font-medium"
                  />
                  <Button
                    type="submit"
                    variant="secondary"
                    size="sm"
                    isLoading={isSavingName}
                    disabled={vaultNameInput === vaultConfig?.vaultName}
                  >
                    Save Name
                  </Button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-[#E6E6E6] mb-1">
                  Vault Document ID
                </label>
                <div className="text-xs font-mono bg-slate-50 dark:bg-[#111111] p-2.5 rounded-lg border border-slate-200/70 dark:border-[#242424] text-slate-600 dark:text-[#E6E6E6] max-w-md select-all">
                  {vaultConfig?.vaultId}
                </div>
              </div>
            </form>
          </div>
          )}

          {/* Collaborator Whitelist Shortcut */}
          <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-[#E6E6E6]">
                <Users className="w-4 h-4 text-brand-500 dark:text-[#1DB954]" />
                <span>Collaborator Access Whitelist</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-[#8A8A8A]">
                Currently authorizing {vaultConfig?.authorizedFriends.length || 0} Friend(s) with view & download permissions.
              </p>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/users')}
              className="gap-2 shrink-0"
            >
              <span>Manage Users</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Storage Backend & Authorizer Health */}
          <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] uppercase tracking-wider text-[11px]">
              Backblaze B2 & Cloudflare Authorizer
            </h2>

            <p className="text-xs text-slate-500 dark:text-[#8A8A8A] leading-relaxed">
              Downloads and direct uploads are authenticated via signed JSON Web Tokens and authorized through a Cloudflare Worker providing scoped AWS SigV4 presigned URLs. Master credentials remain strictly server-side.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCheckB2Health}
                isLoading={isCheckingHealth}
                className="gap-2"
              >
                <Server className="w-4 h-4 text-slate-500 dark:text-[#8A8A8A]" />
                Ping Authorizer Endpoint
              </Button>

              {b2Diagnostics && (
                <div className="flex items-center gap-2 text-xs">
                  {b2Diagnostics.healthy ? (
                    <div className="flex items-center gap-1.5 text-emerald-700 dark:text-[#1DB954] font-semibold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-[#1DB954]" />
                      <span>Online ({b2Diagnostics.storageProvider || 'Backblaze B2'} - {b2Diagnostics.bucket || 'BrightCloud'})</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-rose-700 dark:text-rose-400 font-semibold">
                      <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                      <span>{b2Diagnostics.message || 'Offline / Endpoint Unreachable'}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Stale Reservation & Upload Reconciliation */}
          <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] uppercase tracking-wider text-[11px]">
              Upload Locks & Stale Reservation Reconciliation
            </h2>

            <p className="text-xs text-slate-500 dark:text-[#8A8A8A] leading-relaxed">
              Scans for expired logical identity locks and abandoned version reservations. Compensates uncommitted candidate objects in B2 while strictly preserving canonical CAS blocks.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleReconcileReservations}
                isLoading={isReconcilingReservations}
                className="gap-2"
              >
                <Layers className="w-4 h-4 text-slate-500 dark:text-[#8A8A8A]" />
                Reconcile Expired Reservations
              </Button>

              {reservationReconcileSummary && (
                <div className="text-xs text-slate-600 dark:text-[#8A8A8A] font-mono">
                  Reconciled {reservationReconcileSummary.expiredLocksReconciled} locks, {reservationReconcileSummary.expiredVersionReservationsReconciled} reservations ({reservationReconcileSummary.uncommittedCandidatesDeleted} candidate deletes).
                </div>
              )}
            </div>
          </div>

          {/* Permission Reconciliation Sweep */}
          <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] uppercase tracking-wider text-[11px]">
              On-Demand Permission Reconciliation
            </h2>

            <p className="text-xs text-slate-500 dark:text-[#8A8A8A] leading-relaxed">
              The Android daemon uploads new files with default private permissions. Run an exhaustive sweep across all files in the vault to align newly ingested files with their corresponding folder rules (preserving files with explicit custom overrides).
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
              <Button
                variant="primary"
                size="sm"
                onClick={handleReconcilePermissions}
                isLoading={isReconciling}
                className="gap-2 shadow-sm"
              >
                <Database className="w-4 h-4" />
                Reconcile All Folder Permissions
              </Button>

              {reconcileResult && (
                <div className="text-xs font-semibold text-emerald-700 dark:text-[#1DB954] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{reconcileResult}</span>
                </div>
              )}
            </div>
          </div>

          {/* Danger Zone: Fresh Empty Storage Wipe */}
          <div className="bg-rose-50/50 dark:bg-rose-950/20 rounded-xl border border-rose-200 dark:border-rose-900/40 p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
              <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-[11px]">
                Danger Zone: Fresh Empty Storage Wipe
              </h2>
            </div>

            <p className="text-xs text-rose-600/90 dark:text-rose-300/80 leading-relaxed">
              Permanently purges all files, versions, and delete markers from Backblaze B2 storage, and deletes all files metadata, USB drives (sources), name reservations, backup jobs, and folder rules from Cloud Firestore.
              <br />
              <strong className="text-rose-800 dark:text-rose-300">Strictly Preserved:</strong> Vault settings and Google user accounts are never touched.
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
              {!showWipeConfirm ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setShowWipeConfirm(true)}
                  className="gap-2 bg-rose-600 hover:bg-rose-700 text-white"
                >
                  <Trash2 className="w-4 h-4" />
                  Wipe All Files & Drives
                </Button>
              ) : (
                <div className="flex items-center gap-3 bg-white dark:bg-[#111111] p-3 rounded-lg border border-rose-300 dark:border-rose-900/60">
                  <span className="text-xs font-semibold text-rose-800 dark:text-rose-300">
                    Confirm complete storage wipe? This cannot be undone.
                  </span>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleWipeAllStorage}
                    isLoading={isWiping}
                    className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
                  >
                    Yes, Wipe Everything
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowWipeConfirm(false)}
                    disabled={isWiping}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {wipeResult && (
                <div className="text-xs font-semibold text-emerald-700 dark:text-[#1DB954] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{wipeResult}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
