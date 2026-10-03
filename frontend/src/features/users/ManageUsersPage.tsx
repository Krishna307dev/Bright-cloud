import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  Trash2,
  Mail,
  ShieldCheck,
  RefreshCw,
  UserCheck,
  Ban,
  Search,
  Clock,
  Shield,
  CheckCircle2,
  AlertCircle,
  FileText
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { VaultService } from '../../services/firestore/vaultService';
import { ApprovalService } from '../../services/firestore/approvalService';
import type { UserProfile, UserRole, ApprovalRequest } from '../../models';
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
import { usePageTitle } from '../../hooks/usePageTitle';

export const ManageUsersPage: React.FC = () => {
  usePageTitle('Manage Users');
  const { vaultId, isAdmin, user } = useAuth();
  const toast = useToast();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Add Pre-authorization Dialog State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [uidInput, setUidInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('friend');
  const [isSubmitting, setIsSubmitting] = useState(false);


  // User action state for spinners
  const [actionUid, setActionUid] = useState<string | null>(null);

  // Delete User Confirmation Modal
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);

  // Approval Requests Map and View Request Dialog State
  const [requestsMap, setRequestsMap] = useState<Map<string, ApprovalRequest>>(new Map());
  const [viewingRequest, setViewingRequest] = useState<{ user: UserProfile; request: ApprovalRequest } | null>(null);

  const loadUsers = async () => {
    if (!vaultId) return;
    try {
      setIsLoading(true);
      setError(null);
      const [list, reqs] = await Promise.all([
        VaultService.listUsers(vaultId),
        ApprovalService.listApprovalRequests(),
      ]);
      setUsers(list);
      setRequestsMap(reqs);
    } catch (err: any) {
      setError(`Failed to load users: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [vaultId]);

  const handleManualRefresh = async () => {
    if (!vaultId) return;
    try {
      await loadUsers();
      toast.success('Users list refreshed');
    } catch (err: any) {
      toast.error(`Refresh failed: ${err.message}`);
    }
  };

  const handleRoleChange = async (targetUid: string, newRole: UserRole) => {
    if (!vaultId) return;
    try {
      setActionUid(targetUid);
      await VaultService.setUserRole(vaultId, targetUid, newRole);

      // If this user has an approval request, delete it from the database upon approval or rejection
      if (requestsMap.has(targetUid)) {
        if (newRole === 'friend' || newRole === 'admin' || newRole === 'ignored') {
          await ApprovalService.deleteApprovalRequest(targetUid).catch(() => {});
          setRequestsMap((prev) => {
            const next = new Map(prev);
            next.delete(targetUid);
            return next;
          });
        } else {
          await ApprovalService.updateApprovalStatus(targetUid, 'pending').catch(() => {});
        }
      }

      toast.success(
        newRole === 'admin'
          ? 'User promoted to Administrator'
          : newRole === 'friend'
          ? 'User authorized as Friend'
          : newRole === 'ignored'
          ? 'User access rejected / revoked'
          : 'User status set to Pending'
      );
      await loadUsers();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update user role');
    } finally {
      setActionUid(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!vaultId || !userToDelete) return;
    try {
      setActionUid(userToDelete.uid);
      await VaultService.deleteUser(vaultId, userToDelete.uid);
      await ApprovalService.deleteApprovalRequest(userToDelete.uid).catch(() => {});
      setRequestsMap((prev) => {
        const next = new Map(prev);
        next.delete(userToDelete.uid);
        return next;
      });
      toast.success(`User '${userToDelete.displayName}' removed from vault`);
      setUserToDelete(null);
      await loadUsers();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete user');
    } finally {
      setActionUid(null);
    }
  };

  const handleAddPreAuthUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultId || !uidInput.trim()) return;

    try {
      setIsSubmitting(true);
      const cleanUid = uidInput.trim();
      const cleanEmail = emailInput.trim();
      const cleanName = nameInput.trim() || cleanEmail.split('@')[0] || 'User';

      await VaultService.syncUserProfile(
        vaultId,
        {
          uid: cleanUid,
          email: cleanEmail,
          displayName: cleanName,
        },
        selectedRole
      );

      if (selectedRole === 'admin') {
        await VaultService.setUserRole(vaultId, cleanUid, 'admin');
      } else if (selectedRole === 'friend') {
        await VaultService.setUserRole(vaultId, cleanUid, 'friend');
      }

      toast.success(`User pre-authorized with role ${selectedRole}`);
      setIsAddModalOpen(false);
      setUidInput('');
      setNameInput('');
      setEmailInput('');
      setSelectedRole('friend');
      await loadUsers();
    } catch (err: any) {
      toast.error(`Error adding user: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter users by search query
  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      u.email.toLowerCase().includes(q) ||
      u.displayName.toLowerCase().includes(q) ||
      u.uid.toLowerCase().includes(q)
    );
  });

  const adminCount = users.filter((u) => u.role === 'admin').length;
  const friendCount = users.filter((u) => u.role === 'friend').length;
  const pendingCount = users.filter((u) => u.role === 'pending').length;

  if (isLoading) {
    return <LoadingState message="Loading registered users..." />;
  }

  if (error) {
    return <ErrorState message={error} onRetry={loadUsers} />;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6 animate-fadeIn">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-[#242424] pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight flex items-center gap-2.5">
            <Users className="w-6 h-6 text-brand-600 dark:text-[#1DB954]" />
            Manage Users
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-[#8A8A8A] mt-1">
            Authorize Google accounts to view and download files from your Bright Cloud vault.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleManualRefresh}
            disabled={isLoading}
            className="text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6] gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-brand-600 dark:text-[#1DB954]' : ''}`} />
            Refresh
          </Button>

          {isAdmin && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsRulesModalOpen(true)}
                className="gap-1.5 text-xs text-slate-700 dark:text-[#E6E6E6] border-slate-200 dark:border-[#242424] hover:bg-slate-50 dark:hover:bg-[#181818]"
                title="View Cloud Firestore Rules snippet for Firebase Console"
              >
                <Shield className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954]" />
                Security Rules
              </Button>

              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsAddModalOpen(true)}
                className="gap-1.5 text-xs"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add User
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white dark:bg-[#0A0A0A] p-4 rounded-xl border border-slate-200/90 dark:border-[#242424] shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-[#111111] border border-slate-200 dark:border-[#242424] flex items-center justify-center text-slate-700 dark:text-[#E6E6E6]">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6] leading-tight">{users.length}</div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-[#8A8A8A]">Total Users</div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0A0A0A] p-4 rounded-xl border border-slate-200/90 dark:border-[#242424] shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-50 dark:bg-[#1DB954]/15 border border-brand-200/60 dark:border-[#1DB954]/30 flex items-center justify-center text-brand-600 dark:text-[#1DB954]">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6] leading-tight">{adminCount}</div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-[#8A8A8A]">Administrators</div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0A0A0A] p-4 rounded-xl border border-slate-200/90 dark:border-[#242424] shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-[#1DB954]/15 border border-emerald-200/60 dark:border-[#1DB954]/30 flex items-center justify-center text-emerald-600 dark:text-[#1DB954]">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6] leading-tight">{friendCount}</div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-[#8A8A8A]">Authorized Friends</div>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0A0A0A] p-4 rounded-xl border border-slate-200/90 dark:border-[#242424] shadow-xs flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-800/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6] leading-tight">{pendingCount}</div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-[#8A8A8A]">Pending Approval</div>
          </div>
        </div>
      </div>

      {/* Search Toolbar */}
      <div className="flex items-center justify-between gap-3 bg-white dark:bg-[#0A0A0A] p-3 rounded-xl border border-slate-200/90 dark:border-[#242424] shadow-xs">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 text-slate-400 dark:text-[#8A8A8A] absolute left-3 top-2.5" />
          <Input
            placeholder="Search by email or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>
        <div className="text-xs text-slate-500 dark:text-[#8A8A8A] font-medium">
          Showing {filteredUsers.length} of {users.length} users
        </div>
      </div>

      {/* Users Table */}
      {filteredUsers.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title="No users match your search"
          description="Try adjusting your search criteria or invite a new collaborator."
        />
      ) : (
        <div className="space-y-4">
          {/* Mobile Card List (< md) */}
          <div className="md:hidden space-y-3">
            {filteredUsers.map((u) => {
              const isCurrentUser = u.uid === user?.uid;
              const isItemLoading = actionUid === u.uid;

              return (
                <div
                  key={u.uid}
                  className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200 dark:border-[#242424] p-4 shadow-xs space-y-3"
                >
                  {/* User Profile & Role */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      {u.photoURL ? (
                        <img
                          src={u.photoURL}
                          alt={u.displayName}
                          className="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-[#242424] shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-brand-50 dark:bg-[#111111] border border-brand-200 dark:border-[#242424] text-brand-600 dark:text-[#1DB954] flex items-center justify-center font-bold text-xs shrink-0">
                          {u.displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] flex items-center gap-1.5 truncate">
                          <span className="truncate">{u.displayName}</span>
                          {isCurrentUser && (
                            <span className="text-[10px] bg-slate-100 dark:bg-[#181818] text-slate-600 dark:text-[#E6E6E6] font-semibold px-1.5 py-0.5 rounded-full shrink-0">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-[#8A8A8A] flex items-center gap-1 mt-0.5 truncate">
                          <Mail className="w-3 h-3 shrink-0 text-slate-400 dark:text-[#8A8A8A]" />
                          <span className="truncate">{u.email || 'No email provided'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {u.role === 'admin' ? (
                        <Badge variant="brand" size="sm" className="gap-1 font-semibold">
                          <ShieldCheck className="w-3 h-3" />
                          Admin
                        </Badge>
                      ) : u.role === 'friend' ? (
                        <Badge variant="success" size="sm" className="gap-1 font-semibold">
                          <CheckCircle2 className="w-3 h-3" />
                          Authorized Friend
                        </Badge>
                      ) : u.role === 'ignored' ? (
                        <Badge variant="neutral" size="sm" className="gap-1 font-medium text-slate-600 dark:text-[#8A8A8A]">
                          <Ban className="w-3 h-3 text-slate-400 dark:text-[#8A8A8A]" />
                          Revoked
                        </Badge>
                      ) : (
                        <Badge variant="warning" size="sm" className="gap-1 font-medium">
                          <Clock className="w-3 h-3" />
                          Pending Approval
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Subtitle: Last Login & Request Button */}
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-[#8A8A8A] pt-1">
                    <span className="font-mono text-[11px]">
                      {u.lastLogin ? `Active: ${formatDate(u.lastLogin)}` : 'Never logged in'}
                    </span>
                    {requestsMap.has(u.uid) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setViewingRequest({ user: u, request: requestsMap.get(u.uid)! })}
                        className="inline-flex items-center gap-1 text-xs text-brand-700 dark:text-[#1DB954] bg-brand-50 dark:bg-[#1DB954]/10 hover:bg-brand-100 dark:hover:bg-[#1DB954]/20 border-brand-200 dark:border-[#1DB954]/30 h-7 px-2.5 font-medium shrink-0"
                        title="View submitted approval request"
                      >
                        <FileText className="w-3 h-3 shrink-0" />
                        <span>View Request</span>
                      </Button>
                    )}
                  </div>

                  {/* Action buttons (Touch-friendly flex wrap) */}
                  <div className="pt-2 border-t border-slate-100 dark:border-[#242424] flex items-center flex-wrap gap-2">
                    {u.role !== 'friend' && u.role !== 'admin' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={isItemLoading}
                        onClick={() => handleRoleChange(u.uid, 'friend')}
                        className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-[#1DB954] bg-emerald-50 dark:bg-[#1DB954]/10 hover:bg-emerald-100 dark:hover:bg-[#1DB954]/20 border-emerald-200 dark:border-[#1DB954]/30 min-h-[30px] px-2.5 font-medium"
                      >
                        <UserCheck className="w-3.5 h-3.5 shrink-0" />
                        <span>Authorize</span>
                      </Button>
                    )}

                    {u.role !== 'admin' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isItemLoading}
                        onClick={() => handleRoleChange(u.uid, 'admin')}
                        className="inline-flex items-center gap-1 text-xs text-brand-700 dark:text-[#1DB954] hover:bg-brand-50 dark:hover:bg-[#181818] min-h-[30px] px-2.5"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                        <span>Make Admin</span>
                      </Button>
                    ) : !isCurrentUser ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isItemLoading}
                        onClick={() => handleRoleChange(u.uid, 'friend')}
                        className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-[#E6E6E6] hover:bg-slate-100 dark:hover:bg-[#181818] min-h-[30px] px-2.5"
                      >
                        <Shield className="w-3.5 h-3.5 shrink-0" />
                        <span>Demote</span>
                      </Button>
                    ) : null}

                    {(u.role === 'friend' || (u.role === 'admin' && !isCurrentUser)) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isItemLoading}
                        onClick={() => handleRoleChange(u.uid, 'ignored')}
                        className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-[#181818] min-h-[30px] px-2.5"
                      >
                        <Ban className="w-3.5 h-3.5 shrink-0" />
                        <span>Revoke</span>
                      </Button>
                    )}

                    {!isCurrentUser && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isItemLoading}
                        onClick={() => setUserToDelete(u)}
                        className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-[#181818] min-h-[30px] h-8 w-8 p-0 ml-auto"
                        title="Delete user record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table (hidden on mobile, visible on md+) */}
          <div className="hidden md:block bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200 dark:border-[#242424] shadow-xs">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/75 dark:bg-[#111111] border-b border-slate-200 dark:border-[#242424]">
                  <TableHead className="text-xs font-semibold text-slate-700 dark:text-[#8A8A8A] py-3 whitespace-nowrap">User</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 dark:text-[#8A8A8A] py-3 w-52 whitespace-nowrap">Role & Request</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 dark:text-[#8A8A8A] py-3 w-36 whitespace-nowrap">Last Login</TableHead>
                  <TableHead className="text-xs font-semibold text-slate-700 dark:text-[#8A8A8A] py-3 text-right whitespace-nowrap">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map((u) => {
                  const isCurrentUser = u.uid === user?.uid;
                  const isItemLoading = actionUid === u.uid;

                  return (
                    <TableRow key={u.uid} className="hover:bg-slate-50/60 dark:hover:bg-[#181818] transition-colors">
                      {/* User Profile */}
                      <TableCell className="py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          {u.photoURL ? (
                            <img
                              src={u.photoURL}
                              alt={u.displayName}
                              className="w-9 h-9 rounded-full object-cover border border-slate-200 dark:border-[#242424] shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-brand-50 dark:bg-[#111111] border border-brand-200 dark:border-[#242424] text-brand-600 dark:text-[#1DB954] flex items-center justify-center font-bold text-xs shrink-0">
                              {u.displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6] flex items-center gap-2 truncate">
                              <span className="truncate">{u.displayName}</span>
                              {isCurrentUser && (
                                <span className="text-[10px] bg-slate-100 dark:bg-[#181818] text-slate-600 dark:text-[#E6E6E6] font-semibold px-1.5 py-0.5 rounded-full shrink-0 border border-transparent dark:border-[#242424]">
                                  You
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-[#8A8A8A] flex items-center gap-1 mt-0.5 truncate">
                              <Mail className="w-3 h-3 shrink-0 text-slate-400 dark:text-[#8A8A8A]" />
                              <span className="truncate">{u.email || 'No email provided'}</span>
                            </div>
                            <div className="text-[11px] text-slate-400 dark:text-[#8A8A8A] font-mono mt-0.5 truncate max-w-[220px]" title={u.uid}>
                              UID: {u.uid.slice(0, 10)}...
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Role & Request Status */}
                      <TableCell className="py-3">
                        <div className="flex flex-col items-start gap-1.5">
                          {u.role === 'admin' ? (
                            <Badge variant="brand" size="sm" className="gap-1 font-semibold">
                              <ShieldCheck className="w-3 h-3" />
                              Admin
                            </Badge>
                          ) : u.role === 'friend' ? (
                            <Badge variant="success" size="sm" className="gap-1 font-semibold">
                              <CheckCircle2 className="w-3 h-3" />
                              Authorized Friend
                            </Badge>
                          ) : u.role === 'ignored' ? (
                            <Badge variant="neutral" size="sm" className="gap-1 font-medium text-slate-600 dark:text-[#8A8A8A]">
                              <Ban className="w-3 h-3 text-slate-400 dark:text-[#8A8A8A]" />
                              Revoked
                            </Badge>
                          ) : (
                            <Badge variant="warning" size="sm" className="gap-1 font-medium">
                              <Clock className="w-3 h-3" />
                              Pending Approval
                            </Badge>
                          )}

                          {requestsMap.has(u.uid) && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setViewingRequest({ user: u, request: requestsMap.get(u.uid)! })}
                              className="inline-flex items-center gap-1 text-[11px] text-brand-700 dark:text-[#1DB954] bg-brand-50 dark:bg-[#1DB954]/10 hover:bg-brand-100 dark:hover:bg-[#1DB954]/20 border-brand-200 dark:border-[#1DB954]/30 h-6 px-2 whitespace-nowrap font-medium shrink-0"
                              title="View submitted approval request"
                            >
                              <FileText className="w-3 h-3 shrink-0" />
                              <span>View Request</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>

                      {/* Last Login */}
                      <TableCell className="py-3 text-xs text-slate-500 dark:text-[#8A8A8A] font-mono whitespace-nowrap">
                        {formatDate(u.lastLogin)}
                      </TableCell>

                      {/* One-Click Action Buttons */}
                      <TableCell className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {/* 1. Authorize as Friend */}
                          {u.role !== 'friend' && u.role !== 'admin' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isItemLoading}
                              onClick={() => handleRoleChange(u.uid, 'friend')}
                              className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-[#1DB954] bg-emerald-50 dark:bg-[#1DB954]/10 hover:bg-emerald-100 dark:hover:bg-[#1DB954]/20 border-emerald-200 dark:border-[#1DB954]/30 min-h-[30px] px-2.5 whitespace-nowrap shrink-0 font-medium"
                              title="Authorize user to view and download files"
                            >
                              <UserCheck className="w-3.5 h-3.5 shrink-0" />
                              <span className="whitespace-nowrap">Authorize</span>
                            </Button>
                          )}

                          {/* 2. Make Admin / Demote Admin */}
                          {u.role !== 'admin' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isItemLoading}
                              onClick={() => handleRoleChange(u.uid, 'admin')}
                              className="inline-flex items-center gap-1 text-xs text-brand-700 dark:text-[#1DB954] hover:bg-brand-50 dark:hover:bg-[#181818] min-h-[30px] px-2.5 whitespace-nowrap shrink-0"
                              title="Promote user to full Administrator"
                            >
                              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                              <span className="whitespace-nowrap">Make Admin</span>
                            </Button>
                          ) : !isCurrentUser ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isItemLoading}
                              onClick={() => handleRoleChange(u.uid, 'friend')}
                              className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-[#E6E6E6] hover:bg-slate-100 dark:hover:bg-[#181818] min-h-[30px] px-2.5 whitespace-nowrap shrink-0"
                              title="Demote administrator to Friend"
                            >
                              <Shield className="w-3.5 h-3.5 shrink-0" />
                              <span className="whitespace-nowrap">Demote</span>
                            </Button>
                          ) : null}

                          {/* 3. Revoke Access */}
                          {(u.role === 'friend' || (u.role === 'admin' && !isCurrentUser)) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isItemLoading}
                              onClick={() => handleRoleChange(u.uid, 'ignored')}
                              className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-[#181818] min-h-[30px] px-2.5 whitespace-nowrap shrink-0"
                              title="Revoke vault access"
                            >
                              <Ban className="w-3.5 h-3.5 shrink-0" />
                              <span className="whitespace-nowrap">Revoke</span>
                            </Button>
                          )}

                          {/* 4. Delete Record */}
                          {!isCurrentUser && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isItemLoading}
                              onClick={() => setUserToDelete(u)}
                              className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-[#181818] min-h-[30px] h-8 w-8 p-0 shrink-0"
                              title="Delete user record"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Dialog */}
      {userToDelete && (
        <Dialog
          isOpen={true}
          onClose={() => setUserToDelete(null)}
          title="Delete User Record"
        >
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-lg text-rose-800 dark:text-rose-400 text-xs">
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Are you sure you want to delete this user?</span>
                <p className="mt-1 text-slate-600 dark:text-[#8A8A8A]">
                  User <strong>{userToDelete.displayName}</strong> ({userToDelete.email}) will have their vault access revoked and profile removed.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setUserToDelete(null)}
                disabled={!!actionUid}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDeleteUser}
                isLoading={!!actionUid}
                className="gap-1.5 bg-rose-600 hover:bg-rose-700 text-white"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete User
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Pre-Authorize User Dialog */}
      <Dialog
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="Add / Pre-Authorize User"
      >
        <form onSubmit={handleAddPreAuthUser} className="space-y-4 py-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-[#E6E6E6] mb-1">
              Google Account UID <span className="text-rose-500">*</span>
            </label>
            <Input
              required
              placeholder="e.g. 104829103948572019283"
              value={uidInput}
              onChange={(e) => setUidInput(e.target.value)}
              className="text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-[#E6E6E6] mb-1">
              Email Address
            </label>
            <Input
              type="email"
              placeholder="e.g. friend@gmail.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-[#E6E6E6] mb-1">
              Display Name
            </label>
            <Input
              placeholder="e.g. Alice Smith"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              className="text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-[#E6E6E6] mb-1">
              Assigned Role
            </label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                type="button"
                onClick={() => setSelectedRole('friend')}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  selectedRole === 'friend'
                    ? 'border-brand-500 dark:border-[#1DB954] bg-brand-50/60 dark:bg-[#111111] text-brand-900 dark:text-[#1DB954] font-semibold'
                    : 'border-slate-200 dark:border-[#242424] hover:bg-slate-50 dark:hover:bg-[#181818] text-slate-700 dark:text-[#8A8A8A]'
                }`}
              >
                <div className="text-xs">Authorized Friend</div>
                <div className="text-[10px] text-slate-500 dark:text-[#8A8A8A] font-normal">Read & download files</div>
              </button>

              <button
                type="button"
                onClick={() => setSelectedRole('admin')}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  selectedRole === 'admin'
                    ? 'border-brand-500 dark:border-[#1DB954] bg-brand-50/60 dark:bg-[#111111] text-brand-900 dark:text-[#1DB954] font-semibold'
                    : 'border-slate-200 dark:border-[#242424] hover:bg-slate-50 dark:hover:bg-[#181818] text-slate-700 dark:text-[#8A8A8A]'
                }`}
              >
                <div className="text-xs">Administrator</div>
                <div className="text-[10px] text-slate-500 dark:text-[#8A8A8A] font-normal">Full control & management</div>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-[#242424]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsAddModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSubmitting}
              className="gap-1.5 bg-brand-500 hover:bg-brand-600 dark:bg-[#1DB954] dark:hover:bg-[#1AA34A] text-white dark:text-black dark:font-semibold"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Save & Authorize
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Firestore Security Rules Modal */}
      <Dialog
        isOpen={isRulesModalOpen}
        onClose={() => setIsRulesModalOpen(false)}
        title="Cloud Firestore Security Rules for Users"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-[#8A8A8A] leading-relaxed">
            By default, user management works immediately via <strong>Vault Settings Config</strong>. To enable automatic discovery of non-authorized Google accounts when they sign in, paste this snippet inside your <code className="bg-slate-100 dark:bg-[#111111] px-1 py-0.5 rounded text-brand-600 dark:text-[#1DB954] font-mono border border-transparent dark:border-[#242424]">match /vaults/{'{vaultId}'}</code> block in Firebase Console:
          </p>

          <div className="relative">
            <pre className="p-3 bg-slate-900 dark:bg-black text-slate-100 dark:text-[#E6E6E6] rounded-lg text-[11px] font-mono overflow-x-auto leading-normal border border-slate-800 dark:border-[#242424]">
{`match /users/{userId} {
  allow read: if isAdmin(vaultId) || (isGoogleUser() && request.auth.uid == userId);
  allow create: if isAdmin(vaultId) || (
    isGoogleUser() && request.auth.uid == userId &&
    (!('role' in request.resource.data) || request.resource.data.role == 'pending')
  );
  allow update: if isAdmin(vaultId) || (
    isGoogleUser() && request.auth.uid == userId &&
    (!('role' in request.resource.data) || request.resource.data.role == resource.data.role)
  );
  allow delete: if isAdmin(vaultId);
}`}
            </pre>
            <Button
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2 text-xs h-7 px-2.5 bg-slate-800 hover:bg-slate-700 dark:bg-[#181818] dark:hover:bg-[#242424] text-white dark:text-[#E6E6E6] border-slate-700 dark:border-[#242424]"
              onClick={() => {
                navigator.clipboard.writeText(`match /users/{userId} {
  allow read: if isAdmin(vaultId) || (isGoogleUser() && request.auth.uid == userId);
  allow create: if isAdmin(vaultId) || (
    isGoogleUser() && request.auth.uid == userId &&
    (!('role' in request.resource.data) || request.resource.data.role == 'pending')
  );
  allow update: if isAdmin(vaultId) || (
    isGoogleUser() && request.auth.uid == userId &&
    (!('role' in request.resource.data) || request.resource.data.role == resource.data.role)
  );
  allow delete: if isAdmin(vaultId);
}`);
                toast.success('Rules copied to clipboard!');
              }}
            >
              Copy Rules
            </Button>
          </div>

          <div className="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-[#242424]">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setIsRulesModalOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </Dialog>

      {/* View Approval Request Dialog */}
      <Dialog
        isOpen={!!viewingRequest}
        onClose={() => setViewingRequest(null)}
        title={
          <div className="flex items-center gap-2 text-slate-900 dark:text-[#E6E6E6]">
            <FileText className="w-5 h-5 text-brand-600 dark:text-[#1DB954]" />
            <span>Approval Request Details</span>
          </div>
        }
        description="Review the applicant's submission and decide to grant or deny vault access."
        maxWidth="md"
        footer={
          <div className="flex items-center justify-between w-full gap-2 pt-2 border-t border-slate-100 dark:border-[#242424]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setViewingRequest(null)}
            >
              Close
            </Button>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="danger"
                size="sm"
                className="gap-1.5"
                onClick={async () => {
                  if (viewingRequest) {
                    await handleRoleChange(viewingRequest.user.uid, 'ignored');
                    setViewingRequest(null);
                  }
                }}
              >
                <Ban className="w-3.5 h-3.5" />
                <span>Reject</span>
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="gap-1.5"
                onClick={async () => {
                  if (viewingRequest) {
                    await handleRoleChange(viewingRequest.user.uid, 'friend');
                    setViewingRequest(null);
                  }
                }}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>Approve as Friend</span>
              </Button>
            </div>
          </div>
        }
      >
        {viewingRequest && (
          <div className="space-y-4 pt-1 text-left">
            {/* Applicant Name & Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-[#111111] rounded-xl border border-slate-200/80 dark:border-[#242424]">
              <div>
                <div className="text-[11px] font-semibold text-slate-400 dark:text-[#8A8A8A] uppercase tracking-wider">
                  Full Name
                </div>
                <div className="text-sm font-semibold text-slate-800 dark:text-[#E6E6E6] mt-0.5">
                  {viewingRequest.request.name}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-slate-400 dark:text-[#8A8A8A] uppercase tracking-wider">
                  Email
                </div>
                <div className="text-xs font-mono text-slate-600 dark:text-[#8A8A8A] mt-0.5 truncate" title={viewingRequest.request.email}>
                  {viewingRequest.request.email}
                </div>
              </div>
            </div>

            {/* Why do you want approval */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-[#E6E6E6]">
                Why do you want approval? (Reason)
              </label>
              <div className="p-3 bg-slate-50 dark:bg-[#111111] rounded-xl border border-slate-200 dark:border-[#242424] text-xs text-slate-800 dark:text-[#E6E6E6] whitespace-pre-wrap leading-relaxed">
                {viewingRequest.request.reason}
              </div>
            </div>

            {/* How did you find this website / Who told you about it */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 dark:text-[#E6E6E6]">
                Source / Referred By
              </label>
              <div className="p-3 bg-slate-50 dark:bg-[#111111] rounded-xl border border-slate-200 dark:border-[#242424] text-xs font-medium text-slate-800 dark:text-[#E6E6E6]">
                {viewingRequest.request.referredBy}
              </div>
            </div>

            {/* Status and timestamp */}
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#8A8A8A] pt-1">
              <div className="flex items-center gap-1.5">
                <span>Request Status:</span>
                <span className="font-semibold text-slate-700 dark:text-[#E6E6E6] capitalize">
                  {viewingRequest.request.status}
                </span>
              </div>
              <div>
                Submitted {formatDate(viewingRequest.request.createdAt)}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};
