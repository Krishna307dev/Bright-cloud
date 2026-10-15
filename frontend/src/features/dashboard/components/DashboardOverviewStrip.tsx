import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  UserCheck,
  Clock,
  Files,
  HardDrive,
  Database,
  ArrowUpRight,
} from 'lucide-react';
import { formatBytes } from '../../../utils/format';

export interface OverviewMetrics {
  totalUsers: number;
  pendingApprovals: number;
  activeUsers7d: number;
  totalFiles: number;
  storageBytes: number;
  onlineSources: number;
  offlineSources: number;
  isLoading: boolean;
}

interface DashboardOverviewStripProps {
  metrics: OverviewMetrics;
}

export const DashboardOverviewStrip: React.FC<DashboardOverviewStripProps> = ({ metrics }) => {
  const navigate = useNavigate();

  const cards = [
    {
      label: 'Total Users',
      value: metrics.isLoading ? '...' : metrics.totalUsers.toLocaleString(),
      subtext: `${metrics.activeUsers7d} active in last 7 days`,
      icon: Users,
      onClick: () => navigate('/users'),
      color: 'text-blue-500 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/30',
      border: 'hover:border-blue-300 dark:hover:border-blue-800',
    },
    {
      label: 'Pending Approvals',
      value: metrics.isLoading ? '...' : metrics.pendingApprovals.toLocaleString(),
      subtext: metrics.pendingApprovals > 0 ? 'Action required' : 'All caught up',
      icon: Clock,
      onClick: () => navigate('/users?filter=pending'),
      color: metrics.pendingApprovals > 0 ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-[#8A8A8A]',
      bg: metrics.pendingApprovals > 0 ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-slate-50 dark:bg-[#111111]',
      border: 'hover:border-amber-300 dark:hover:border-amber-800',
      highlightBadge: metrics.pendingApprovals > 0 ? 'Pending' : undefined,
    },
    {
      label: 'Active Users (7d)',
      value: metrics.isLoading ? '...' : metrics.activeUsers7d.toLocaleString(),
      subtext: 'Logged in recently',
      icon: UserCheck,
      onClick: () => navigate('/activity?tab=sign-in-activity'),
      color: 'text-emerald-500 dark:text-[#1DB954]',
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
      border: 'hover:border-emerald-300 dark:hover:border-emerald-800',
    },
    {
      label: 'Total Files Backed Up',
      value: metrics.isLoading ? '...' : metrics.totalFiles.toLocaleString(),
      subtext: 'Indexed in vault',
      icon: Files,
      onClick: () => navigate('/files'),
      color: 'text-brand-500 dark:text-[#1DB954]',
      bg: 'bg-brand-50 dark:bg-brand-950/30',
      border: 'hover:border-brand-300 dark:hover:border-brand-800',
    },
    {
      label: 'Storage Used',
      value: metrics.isLoading ? '...' : formatBytes(metrics.storageBytes),
      subtext: 'Cloud bucket storage',
      icon: Database,
      onClick: () => navigate('/files'),
      color: 'text-indigo-500 dark:text-indigo-400',
      bg: 'bg-indigo-50 dark:bg-indigo-950/30',
      border: 'hover:border-indigo-300 dark:hover:border-indigo-800',
    },
    {
      label: 'USB Sources',
      value: metrics.isLoading ? '...' : `${metrics.onlineSources} / ${metrics.onlineSources + metrics.offlineSources}`,
      subtext: `${metrics.onlineSources} online, ${metrics.offlineSources} offline`,
      icon: HardDrive,
      onClick: () => navigate('/sources'),
      color: 'text-purple-500 dark:text-purple-400',
      bg: 'bg-purple-50 dark:bg-purple-950/30',
      border: 'hover:border-purple-300 dark:hover:border-purple-800',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((c) => (
        <button
          key={c.label}
          type="button"
          onClick={c.onClick}
          className={`group text-left bg-white dark:bg-[#0A0A0A] p-3.5 rounded-xl border border-slate-200/80 dark:border-[#242424] transition-all duration-150 shadow-2xs hover:shadow-sm ${c.border} cursor-pointer focus:outline-none focus:ring-1 focus:ring-brand-500`}
        >
          <div className="flex items-center justify-between gap-1 mb-2">
            <div className={`w-7 h-7 rounded-lg ${c.bg} flex items-center justify-center ${c.color}`}>
              <c.icon className="w-3.5 h-3.5" />
            </div>
            <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 dark:text-[#444444] group-hover:text-slate-600 dark:group-hover:text-[#E6E6E6] transition-colors" />
          </div>

          <p className="text-[11px] font-medium text-slate-500 dark:text-[#8A8A8A] truncate">
            {c.label}
          </p>
          <p className="text-lg font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight mt-0.5">
            {c.value}
          </p>
          <p className="text-[10px] text-slate-400 dark:text-[#666666] truncate mt-1">
            {c.subtext}
          </p>
        </button>
      ))}
    </div>
  );
};
