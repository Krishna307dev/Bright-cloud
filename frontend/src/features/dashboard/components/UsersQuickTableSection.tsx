import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  Search,
  Sliders,
  ShieldCheck,
  UserCheck,
  Ban,
  Clock,
  ExternalLink,
  AlertCircle,
} from 'lucide-react';
import type { UserProfile, UserRole } from '../../../models/user';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { formatDate } from '../../../utils/format';

interface UsersQuickTableSectionProps {
  users: UserProfile[];
  isLoading: boolean;
  onRoleChange: (uid: string, newRole: UserRole) => Promise<void>;
  onToggleSuspend: (uid: string, isSuspended: boolean, email: string) => Promise<void>;
  onOpenCustomize: (user: UserProfile) => void;
}

export const UsersQuickTableSection: React.FC<UsersQuickTableSectionProps> = ({
  users,
  isLoading,
  onRoleChange,
  onToggleSuspend,
  onOpenCustomize,
}) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'friend' | 'pending' | 'suspended'>('all');

  // Confirmation modal state for safe actions
  const [confirmModal, setConfirmModal] = useState<{
    type: 'suspend' | 'activate' | 'changeRole';
    user: UserProfile;
    newRole?: UserRole;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const filteredUsers = useMemo(() => {
    let list = users;

    if (roleFilter === 'suspended') {
      list = list.filter((u) => u.customSettings?.suspended === true || u.role === 'ignored');
    } else if (roleFilter !== 'all') {
      list = list.filter((u) => u.role === roleFilter);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (u) =>
          u.displayName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.uid.toLowerCase().includes(q)
      );
    }

    return list;
  }, [users, roleFilter, searchQuery]);

  const handleExecuteConfirm = async () => {
    if (!confirmModal) return;
    try {
      setIsProcessing(true);
      if (confirmModal.type === 'suspend') {
        await onToggleSuspend(confirmModal.user.uid, true, confirmModal.user.email);
      } else if (confirmModal.type === 'activate') {
        await onToggleSuspend(confirmModal.user.uid, false, confirmModal.user.email);
      } else if (confirmModal.type === 'changeRole' && confirmModal.newRole) {
        await onRoleChange(confirmModal.user.uid, confirmModal.newRole);
      }
      setConfirmModal(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const getRoleBadge = (u: UserProfile) => {
    const isSuspended = u.customSettings?.suspended === true || u.role === 'ignored';
    if (isSuspended) {
      return (
        <Badge variant="danger" size="sm" className="gap-1">
          <Ban className="w-2.5 h-2.5" />
          Suspended
        </Badge>
      );
    }
    if (u.role === 'admin') {
      return (
        <Badge variant="brand" size="sm" className="gap-1">
          <ShieldCheck className="w-2.5 h-2.5" />
          Admin
        </Badge>
      );
    }
    if (u.role === 'friend') {
      return (
        <Badge variant="success" size="sm" className="gap-1">
          <UserCheck className="w-2.5 h-2.5" />
          Friend
        </Badge>
      );
    }
    return (
      <Badge variant="warning" size="sm" className="gap-1">
        <Clock className="w-2.5 h-2.5" />
        Pending
      </Badge>
    );
  };

  return (
    <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-4 sm:p-5 shadow-2xs">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-[#242424] mb-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-brand-600 dark:text-[#1DB954]" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
            Users Quick Control
          </h2>
          <span className="text-[11px] font-medium text-slate-400 dark:text-[#8A8A8A]">
            ({filteredUsers.length} of {users.length})
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-[#8A8A8A] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search users..."
              className="text-xs pl-8 pr-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-[#121212] border border-slate-200 dark:border-[#282828] text-slate-800 dark:text-[#E6E6E6] placeholder-slate-400 dark:placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-brand-500 w-full sm:w-56"
            />
          </div>

          {/* Role Filter Segmented Control */}
          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-[#141414] p-0.5 rounded-lg border border-slate-200/80 dark:border-[#282828] overflow-x-auto shrink-0">
            {(['all', 'admin', 'friend', 'pending', 'suspended'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`text-[11px] capitalize px-2.5 py-1 rounded-md font-medium transition-colors whitespace-nowrap ${
                  roleFilter === r
                    ? 'bg-white dark:bg-[#202020] text-slate-900 dark:text-[#E6E6E6] shadow-2xs font-semibold'
                    : 'text-slate-500 dark:text-[#8A8A8A] hover:text-slate-800 dark:hover:text-[#E6E6E6]'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Users Table */}
      {isLoading ? (
        <div className="py-8 text-center text-xs text-slate-400 dark:text-[#8A8A8A]">
          Loading users...
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400 dark:text-[#8A8A8A]">
          No users match the active search and filter.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-left text-xs border-collapse min-w-[720px]">
            <thead>
              <tr className="border-b border-slate-100 dark:border-[#202020] text-[11px] text-slate-400 dark:text-[#8A8A8A] font-semibold uppercase tracking-wider">
                <th className="py-2.5 px-3 w-72">User</th>
                <th className="py-2.5 px-3 w-44">Role & Status</th>
                <th className="py-2.5 px-3 w-36 hidden sm:table-cell">Last Login</th>
                <th className="py-2.5 px-3 text-right w-64">Quick Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#181818]">
              {filteredUsers.slice(0, 10).map((u) => {
                const isSuspended = u.customSettings?.suspended === true || u.role === 'ignored';
                const hasCustomOverrides = Boolean(
                  u.customSettings?.canUpload !== undefined ||
                  u.customSettings?.canDownload !== undefined ||
                  u.customSettings?.canShare !== undefined ||
                  u.customSettings?.visibleTabs ||
                  u.customSettings?.themeLock ||
                  u.customSettings?.allowedDrives?.length
                );

                return (
                  <tr
                    key={u.uid}
                    className="hover:bg-slate-50/70 dark:hover:bg-[#121212] transition-colors"
                  >
                    {/* User info */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-slate-100 dark:bg-[#181818] border border-slate-200 dark:border-[#282828] flex items-center justify-center font-bold text-xs text-slate-600 dark:text-[#8A8A8A] shrink-0">
                          {u.displayName ? u.displayName.charAt(0).toUpperCase() : u.email?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => navigate(`/users?user=${u.uid}`)}
                            className="font-semibold text-slate-900 dark:text-[#E6E6E6] hover:text-brand-600 dark:hover:text-[#1DB954] hover:underline truncate text-left block"
                            title={`Open ${u.displayName} in Manage Users`}
                          >
                            {u.displayName || 'Unnamed User'}
                          </button>
                          <span className="text-[11px] text-slate-400 dark:text-[#8A8A8A] truncate block">
                            {u.email}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Role & Badges */}
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {getRoleBadge(u)}
                        {hasCustomOverrides && (
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                            title="This user has individual custom overrides"
                          >
                            Customized
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Last Login */}
                    <td className="py-2.5 px-3 text-slate-500 dark:text-[#8A8A8A] hidden sm:table-cell font-mono text-[11px]">
                      {u.lastLogin ? formatDate(u.lastLogin) : 'Never'}
                    </td>

                    {/* Actions */}
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5 shrink-0">
                        {/* Open individual customization drawer */}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => onOpenCustomize(u)}
                          className="h-7 text-xs px-2 gap-1 shrink-0 whitespace-nowrap"
                          title="Open user customization overrides panel"
                        >
                          <Sliders className="w-3 h-3 text-brand-600 dark:text-[#1DB954]" />
                          <span>Customize</span>
                        </Button>

                        {/* Suspend / Activate button */}
                        <Button
                          size="sm"
                          variant={isSuspended ? 'secondary' : 'ghost'}
                          onClick={() =>
                            setConfirmModal({
                              type: isSuspended ? 'activate' : 'suspend',
                              user: u,
                            })
                          }
                          className={`h-7 text-xs px-2 gap-1 ${
                            isSuspended
                              ? 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                              : 'text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                          }`}
                          title={isSuspended ? 'Activate user' : 'Suspend user'}
                        >
                          <Ban className="w-3 h-3" />
                          <span>{isSuspended ? 'Activate' : 'Suspend'}</span>
                        </Button>

                        {/* Link to Manage Users */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => navigate(`/users?user=${u.uid}`)}
                          className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700 dark:hover:text-[#E6E6E6]"
                          title="View full profile in Manage Users"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation Dialog for Safe Actions */}
      <Dialog
        isOpen={Boolean(confirmModal)}
        onClose={() => setConfirmModal(null)}
        title={
          confirmModal?.type === 'suspend'
            ? 'Suspend User Access'
            : confirmModal?.type === 'activate'
            ? 'Reactivate User Access'
            : 'Change User Role'
        }
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-lg text-amber-800 dark:text-amber-200 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <p className="font-semibold">Confirm Administrative Action</p>
              <p className="mt-0.5 text-amber-700 dark:text-amber-300">
                {confirmModal?.type === 'suspend' && (
                  <>
                    Are you sure you want to suspend access for <span className="font-bold">{confirmModal.user.displayName}</span> ({confirmModal.user.email})? They will immediately be blocked from viewing files.
                  </>
                )}
                {confirmModal?.type === 'activate' && (
                  <>
                    Reactivate vault access for <span className="font-bold">{confirmModal.user.displayName}</span> ({confirmModal.user.email})?
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#242424]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmModal(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant={confirmModal?.type === 'suspend' ? 'danger' : 'primary'}
              size="sm"
              onClick={handleExecuteConfirm}
              disabled={isProcessing}
            >
              {isProcessing
                ? 'Processing...'
                : confirmModal?.type === 'suspend'
                ? 'Suspend User'
                : 'Confirm'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
