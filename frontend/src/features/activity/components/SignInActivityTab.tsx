import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Ban,
  UserCheck,
} from 'lucide-react';
import type { UserProfile } from '../../../models/user';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { formatRelativeTime } from './UserActivityTable';

interface SignInActivityTabProps {
  vaultId: string;
  users: UserProfile[];
}

export const SignInActivityTab: React.FC<SignInActivityTabProps> = ({
  users,
}) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'friend' | 'pending'>('all');

  // Filtered users list
  const filteredUsers = useMemo(() => {
    let list = users;
    if (roleFilter !== 'all') {
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

  // Summary counts
  const summary = useMemo(() => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const activeLogins = users.filter((u) => u.lastLogin && u.lastLogin.getTime() >= thirtyDaysAgo).length;
    const adminCount = users.filter((u) => u.role === 'admin').length;

    return {
      totalUsers: users.length,
      activeLogins,
      adminCount,
    };
  }, [users]);

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Summary Strip (Flat, inline stats matching design tokens) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-[#0A0A0A] p-3 rounded-lg border border-slate-200 dark:border-[#242424]">
          <span className="text-[11px] font-medium text-slate-500 dark:text-[#888888] block">
            Registered Users
          </span>
          <span className="text-xl font-semibold font-mono text-slate-900 dark:text-[#E6E6E6] mt-0.5 block">
            {summary.totalUsers}
          </span>
        </div>
        <div className="bg-white dark:bg-[#0A0A0A] p-3 rounded-lg border border-slate-200 dark:border-[#242424]">
          <span className="text-[11px] font-medium text-slate-500 dark:text-[#888888] block">
            Active Sign-ins (30d)
          </span>
          <span className="text-xl font-semibold font-mono text-slate-900 dark:text-[#E6E6E6] mt-0.5 block">
            {summary.activeLogins}
          </span>
        </div>
        <div className="bg-white dark:bg-[#0A0A0A] p-3 rounded-lg border border-slate-200 dark:border-[#242424]">
          <span className="text-[11px] font-medium text-slate-500 dark:text-[#888888] block">
            Administrators
          </span>
          <span className="text-xl font-semibold font-mono text-slate-900 dark:text-[#E6E6E6] mt-0.5 block">
            {summary.adminCount}
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-[#0A0A0A] p-3 rounded-lg border border-slate-200 dark:border-[#242424]">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, or UID..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded border border-slate-200 dark:border-[#2C2C2C] bg-slate-50 dark:bg-[#121212] text-slate-900 dark:text-[#E6E6E6] placeholder-slate-400 focus:outline-none focus:border-slate-400 dark:focus:border-[#444444]"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="h-8 px-2.5 text-xs rounded border border-slate-200 dark:border-[#2C2C2C] bg-slate-50 dark:bg-[#121212] text-slate-900 dark:text-[#E6E6E6] focus:outline-none"
          >
            <option value="all">All Roles</option>
            <option value="admin">Administrators</option>
            <option value="friend">Authorized Collaborators</option>
            <option value="pending">Pending Approval</option>
          </select>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/users')}
            className="h-8 gap-1.5 text-xs shrink-0"
          >
            <span>Manage Users</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Main List */}
      {filteredUsers.length === 0 ? (
        <div className="bg-white dark:bg-[#0A0A0A] rounded-lg border border-slate-200 dark:border-[#242424] p-8 text-center text-xs text-slate-500 dark:text-[#888888]">
          No user sign-in records match the current filter.
        </div>
      ) : (
        <>
          {/* Desktop Dense Table */}
          <div className="hidden sm:block overflow-hidden bg-white dark:bg-[#0A0A0A] rounded-lg border border-slate-200 dark:border-[#242424]">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-[#121212] border-b border-slate-200 dark:border-[#242424] text-slate-500 dark:text-[#8A8A8A] font-medium">
                <tr>
                  <th className="py-2.5 px-3">User</th>
                  <th className="py-2.5 px-3">Email</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Member Since</th>
                  <th className="py-2.5 px-3 text-right">Last Sign-in Session</th>
                  <th className="w-12 py-2.5 px-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1C1C1C]">
                {filteredUsers.map((u) => {
                  const initial = (u.displayName || u.email || 'U')[0].toUpperCase();
                  return (
                    <tr
                      key={u.uid}
                      className="transition-colors hover:bg-slate-50 dark:hover:bg-[#121212]"
                    >
                      {/* 1. User */}
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-[#202020] text-slate-700 dark:text-[#CCCCCC] font-semibold text-xs flex items-center justify-center shrink-0">
                            {initial}
                          </div>
                          <span
                            className="font-medium text-slate-900 dark:text-[#E6E6E6] truncate block max-w-[160px]"
                            title={u.displayName}
                          >
                            {u.displayName}
                          </span>
                        </div>
                      </td>

                      {/* 2. Email */}
                      <td className="py-3 px-3 text-slate-500 dark:text-[#888888] font-mono text-[11px] truncate max-w-[200px]">
                        {u.email || 'N/A'}
                      </td>

                      {/* 3. Role */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {u.role === 'admin' ? (
                          <Badge variant="brand" size="sm" className="gap-1 font-semibold text-[10px]">
                            <ShieldCheck className="w-3 h-3" />
                            Admin
                          </Badge>
                        ) : u.role === 'friend' ? (
                          <Badge variant="success" size="sm" className="gap-1 font-semibold text-[10px]">
                            <CheckCircle2 className="w-3 h-3" />
                            Collaborator
                          </Badge>
                        ) : u.role === 'ignored' ? (
                          <Badge variant="neutral" size="sm" className="gap-1 text-[10px]">
                            <Ban className="w-3 h-3" />
                            Revoked
                          </Badge>
                        ) : (
                          <Badge variant="warning" size="sm" className="gap-1 text-[10px]">
                            <Clock className="w-3 h-3" />
                            Pending
                          </Badge>
                        )}
                      </td>

                      {/* 4. Member Since */}
                      <td className="py-3 px-3 whitespace-nowrap font-mono text-slate-500 dark:text-[#888888] text-[11px]">
                        {u.createdAt ? u.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Initial setup'}
                      </td>

                      {/* 5. Last Sign-in Session */}
                      <td className="py-3 px-3 whitespace-nowrap text-right">
                        {u.lastLogin ? (
                          <div>
                            <span
                              className="font-mono text-slate-800 dark:text-[#CCCCCC] text-[11px] block"
                              title={u.lastLogin.toLocaleString()}
                            >
                              {formatRelativeTime(u.lastLogin)}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-[#666666] block">
                              {u.lastLogin.toLocaleDateString()}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-[#666666] italic text-[11px]">
                            Never logged in
                          </span>
                        )}
                      </td>

                      {/* 6. Quick Action */}
                      <td className="py-3 px-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate('/users')}
                          className="h-7 w-7 p-0 flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-[#E6E6E6]"
                          title="Manage user in Users page"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards (44px tap targets) */}
          <div className="sm:hidden space-y-2.5">
            {filteredUsers.map((u) => {
              const initial = (u.displayName || u.email || 'U')[0].toUpperCase();
              return (
                <div
                  key={u.uid}
                  className="bg-white dark:bg-[#0A0A0A] rounded-lg border border-slate-200 dark:border-[#242424] p-3.5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-[#202020] text-slate-700 dark:text-[#CCCCCC] font-semibold text-xs flex items-center justify-center shrink-0">
                        {initial}
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-900 dark:text-[#E6E6E6] truncate block">
                          {u.displayName}
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-[#777777] truncate block">
                          {u.email || 'No email provided'}
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {u.role === 'admin' ? (
                        <Badge variant="brand" size="sm" className="text-[10px]">
                          Admin
                        </Badge>
                      ) : (
                        <Badge variant="neutral" size="sm" className="text-[10px]">
                          {u.role || 'Member'}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-slate-100 dark:border-[#1E1E1E]">
                    <div className="bg-slate-50 dark:bg-[#121212] p-2 rounded">
                      <span className="text-[10px] text-slate-400 dark:text-[#777777] block">
                        Member Since
                      </span>
                      <span className="font-mono text-[11px] text-slate-800 dark:text-[#CCCCCC]">
                        {u.createdAt ? u.createdAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Initial setup'}
                      </span>
                    </div>

                    <div className="bg-slate-50 dark:bg-[#121212] p-2 rounded">
                      <span className="text-[10px] text-slate-400 dark:text-[#777777] block">
                        Last Sign-in
                      </span>
                      <span className="font-mono text-[11px] text-slate-800 dark:text-[#CCCCCC]">
                        {u.lastLogin ? formatRelativeTime(u.lastLogin) : 'Never'}
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate('/users')}
                    className="w-full min-h-[44px] justify-center gap-1.5 text-xs text-slate-800 dark:text-[#E6E6E6]"
                  >
                    <UserCheck className="w-4 h-4 text-slate-500" />
                    <span>Manage user settings</span>
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
