import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Trash2, Mail, ShieldCheck, RefreshCw, Shield, UserCheck, AlertCircle } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { VaultService } from '../../services/firestore/vaultService';
import type { VaultConfig } from '../../models';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Dialog } from '../../components/ui/Dialog';
import { Badge } from '../../components/ui/Badge';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '../../components/ui/Table';
import { LoadingState } from '../../components/feedback/LoadingState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { EmptyState } from '../../components/feedback/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { formatDate } from '../../utils/format';

export const FriendsPage: React.FC = () => {
  const { vaultId, isAdmin, user } = useAuth();
  const toast = useToast();

  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleManualRefresh = async () => {
    if (!vaultId) return;
    try {
      setIsRefreshing(true);
      await loadConfig();
      toast.success('Collaborators list refreshed');
    } catch (err: any) {
      toast.error(`Refresh failed: ${err.message}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Add Collaborator Dialog State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [uidInput, setUidInput] = useState('');
  const [labelInput, setLabelInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<'ADMIN' | 'FRIEND'>('FRIEND');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Action state
  const [actionUid, setActionUid] = useState<string | null>(null);

  const loadConfig = async () => {
    if (!vaultId) return;
    try {
      setIsLoading(true);
      setError(null);
      const cfg = await VaultService.getVaultConfig(vaultId);
      setVaultConfig(cfg);
    } catch (err: any) {
      setError(`Failed to load collaborators: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, [vaultId]);

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultId || !uidInput.trim()) return;

    try {
      setIsSubmitting(true);
      const cleanUid = uidInput.trim();

      // First add/update contact directory info
      await VaultService.addAuthorizedFriend(
        vaultId,
        cleanUid,
        labelInput.trim() || undefined,
        emailInput.trim() || undefined
      );

      // If Admin role was selected, promote them atomically
      if (selectedRole === 'ADMIN') {
        await VaultService.changeCollaboratorRole(vaultId, cleanUid, 'ADMIN');
      }

      toast.success(`Collaborator added as ${selectedRole}`);
      setIsAddModalOpen(false);
      setUidInput('');
      setLabelInput('');
      setEmailInput('');
      setSelectedRole('FRIEND');
      await loadConfig();
    } catch (err: any) {
      toast.error(`Error adding collaborator: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRoleChange = async (uid: string, newRole: 'ADMIN' | 'FRIEND' | 'REVOKED') => {
    if (!vaultId) return;
    try {
      setActionUid(uid);
      await VaultService.changeCollaboratorRole(vaultId, uid, newRole);
      toast.success(newRole === 'REVOKED' ? 'Collaborator access revoked' : `Role changed to ${newRole}`);
      await loadConfig();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update collaborator role');
    } finally {
      setActionUid(null);
    }
  };

  if (!isAdmin) {
    return (
      <div className="p-8 text-center text-slate-500">
        Administrator permissions required to view and manage collaborators.
      </div>
    );
  }

  const adminUids = vaultConfig?.adminUids || [];
  const friendUids = vaultConfig?.authorizedFriends || [];
  const friendDirectory = vaultConfig?.friendDirectory || {};

  // Combine unique UIDs from admins and friends
  const allCollaboratorUids = Array.from(new Set([...adminUids, ...friendUids]));

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200/80 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-brand-50 border border-brand-200/60 flex items-center justify-center text-brand-600">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Vault Collaborators & Access Control
            </h1>
            <p className="text-xs text-slate-500">
              Manage authorized Administrators, Friends, and contact directory metadata
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isLoading || isRefreshing}
            className="p-2"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 text-slate-500 ${isRefreshing || isLoading ? 'animate-spin text-brand-600 dark:text-[#1DB954]' : ''}`} />
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            className="gap-2"
          >
            <UserPlus className="w-4 h-4" />
            Add Collaborator
          </Button>
        </div>
      </div>

      {/* Directory Notice */}
      <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-4 flex items-start gap-3 text-xs text-slate-600">
        <ShieldCheck className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" />
        <div className="leading-relaxed">
          <span className="font-semibold text-slate-800">Privacy & Authorization Invariant: </span>
          Collaborators are authorized by their Google Account UID. Human display names and emails are maintained in your private vault directory. Emails are informational Admin notes and visibly marked unverified.
        </div>
      </div>

      {/* Collaborators Table */}
      {isLoading ? (
        <LoadingState message="Loading collaborator directory..." />
      ) : error ? (
        <ErrorState message={error} onRetry={loadConfig} />
      ) : allCollaboratorUids.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6 text-brand-500" />}
          title="No collaborators added"
          description="Your vault currently has no authorized collaborators. Add Google Account identifiers to allow friends or co-administrators to access resources."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsAddModalOpen(true)}
              className="gap-2"
            >
              <UserPlus className="w-4 h-4" />
              Add First Collaborator
            </Button>
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Collaborator Name / Note</TableHead>
                <TableHead>Contact Email (Unverified)</TableHead>
                <TableHead className="w-36">Added On</TableHead>
                <TableHead className="w-36">Role</TableHead>
                <TableHead className="w-44 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allCollaboratorUids.map((uid, index) => {
                const entry = friendDirectory[uid];
                const isUserAdmin = adminUids.includes(uid);
                const isCurrentUser = user?.uid === uid;
                const displayName = entry?.label || (isUserAdmin ? 'Vault Administrator' : 'Authorized Friend');
                const email = entry?.email || '—';
                const dateAdded = entry?.addedAt ? formatDate(new Date(entry.addedAt)) : '—';
                const isBusy = actionUid === uid;

                return (
                  <TableRow key={uid}>
                    <TableCell className="text-center font-mono text-xs text-slate-400">
                      {index + 1}
                    </TableCell>

                    <TableCell className="font-semibold text-slate-900 text-xs">
                      <div className="flex items-center gap-2">
                        <span>{displayName}</span>
                        {isCurrentUser && (
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                            You
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="text-xs text-slate-600 font-mono">
                      <div className="flex items-center gap-1.5">
                        {entry?.email && <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
                        <span className="truncate max-w-[180px]">{email}</span>
                        {entry?.email && (
                          <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200/60 px-1 py-0.2 rounded font-sans">
                            Unverified
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="text-xs text-slate-500">
                      {dateAdded}
                    </TableCell>

                    <TableCell>
                      {isUserAdmin ? (
                        <Badge variant="brand" size="sm" className="gap-1">
                          <Shield className="w-3 h-3 text-brand-600" />
                          Administrator
                        </Badge>
                      ) : (
                        <Badge variant="neutral" size="sm" className="gap-1">
                          <UserCheck className="w-3 h-3 text-slate-500" />
                          Friend / Viewer
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isUserAdmin ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRoleChange(uid, 'FRIEND')}
                            disabled={isBusy || (isUserAdmin && adminUids.length <= 1)}
                            title={adminUids.length <= 1 ? 'Cannot demote only administrator' : 'Demote to Friend'}
                            className="text-xs text-slate-500 hover:text-slate-800"
                          >
                            Demote
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRoleChange(uid, 'ADMIN')}
                            disabled={isBusy}
                            title="Promote to Administrator"
                            className="text-xs text-brand-600 hover:text-brand-700"
                          >
                            Promote
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRoleChange(uid, 'REVOKED')}
                          disabled={isBusy || (isUserAdmin && adminUids.length <= 1)}
                          title={isUserAdmin && adminUids.length <= 1 ? 'Cannot remove only administrator' : 'Revoke Access'}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Collaborator Dialog */}
      <Dialog
        isOpen={isAddModalOpen}
        onClose={() => !isSubmitting && setIsAddModalOpen(false)}
        title="Authorize New Collaborator"
        description="Add a collaborator to this vault using their Google Account identifier."
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsAddModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleAddCollaborator}
              isLoading={isSubmitting}
              disabled={!uidInput.trim()}
            >
              Authorize Collaborator
            </Button>
          </div>
        }
      >
        <form onSubmit={handleAddCollaborator} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-800 mb-1">
              Google Account UID <span className="text-rose-500">*</span>
            </label>
            <Input
              placeholder="e.g. 28-character Firebase/Google UID"
              value={uidInput}
              onChange={(e) => setUidInput(e.target.value)}
              required
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-slate-400 mt-1 leading-normal">
              Internal authorization identifier. This value is stored securely in vault permissions and is never rendered in public views.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-800 mb-1">
              Role
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelectedRole('FRIEND')}
                className={`p-2.5 rounded-lg border text-left text-xs transition-all ${
                  selectedRole === 'FRIEND'
                    ? 'border-brand-500 bg-brand-50/50 text-brand-900 font-medium'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <div className="font-semibold">Friend / Viewer</div>
                <div className="text-[11px] text-slate-400 mt-0.5">Read-only access to shared resources</div>
              </button>
              <button
                type="button"
                onClick={() => setSelectedRole('ADMIN')}
                className={`p-2.5 rounded-lg border text-left text-xs transition-all ${
                  selectedRole === 'ADMIN'
                    ? 'border-brand-500 bg-brand-50/50 text-brand-900 font-medium'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'
                }`}
              >
                <div className="font-semibold">Administrator</div>
                <div className="text-[11px] text-slate-400 mt-0.5">Full vault management & uploads</div>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-800 mb-1">
              Display Name / Note (Optional)
            </label>
            <Input
              placeholder="e.g. Alice Smith (Research Assistant)"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-800 mb-1">
              Contact Email Note (Unverified)
            </label>
            <Input
              type="email"
              placeholder="e.g. alice@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
            />
            <p className="text-[11px] text-amber-700/80 mt-1 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 inline shrink-0" />
              Emails entered here are informational directory notes, not verified email claims.
            </p>
          </div>
        </form>
      </Dialog>
    </div>
  );
};
