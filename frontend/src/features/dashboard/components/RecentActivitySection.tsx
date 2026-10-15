import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ExternalLink,
  Eye,
  Download,
  FolderOpen,
} from 'lucide-react';
import type { UserActivityEvent } from '../../../models/userActivity';
import { formatRelativeTime } from '../../activity/components/UserActivityTable';

interface RecentActivitySectionProps {
  events: UserActivityEvent[];
  isLoading: boolean;
}

export const RecentActivitySection: React.FC<RecentActivitySectionProps> = ({
  events,
  isLoading,
}) => {
  const navigate = useNavigate();

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'download':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40">
            <Download className="w-2.5 h-2.5" />
            Download
          </span>
        );
      case 'preview':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/40">
            <Eye className="w-2.5 h-2.5" />
            Preview
          </span>
        );
      case 'open':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-[#181818] text-slate-700 dark:text-[#E6E6E6] border border-slate-200/60 dark:border-[#282828]">
            <FolderOpen className="w-2.5 h-2.5" />
            Open
          </span>
        );
    }
  };

  return (
    <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-4 sm:p-5 shadow-2xs">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-[#242424] mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-brand-600 dark:text-[#1DB954]" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
            Recent User Activity
          </h2>
          <span className="text-[11px] font-medium text-slate-400 dark:text-[#8A8A8A]">
            Latest access events
          </span>
        </div>

        <Link
          to="/activity"
          className="text-xs font-medium text-brand-600 dark:text-[#1DB954] hover:underline flex items-center gap-1"
        >
          <span>View all</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-xs text-slate-400 dark:text-[#8A8A8A]">
          Loading recent activities...
        </div>
      ) : events.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400 dark:text-[#8A8A8A]">
          No recorded activity events yet.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-[#1C1C1C]">
          {events.slice(0, 8).map((ev) => (
            <div
              key={ev.id}
              className="py-2.5 flex items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0 flex-1 flex items-center gap-2.5">
                {getActionBadge(ev.action)}

                {/* Clickable user name opening Manage Users with that user selected */}
                <button
                  type="button"
                  onClick={() => navigate(`/users?user=${ev.userId}`)}
                  className="font-semibold text-slate-800 dark:text-[#E6E6E6] hover:text-brand-600 dark:hover:text-[#1DB954] hover:underline truncate max-w-[140px] text-left"
                  title={`View user ${ev.userDisplayName} (${ev.email || ev.userId}) in Manage Users`}
                >
                  {ev.userDisplayName || ev.email?.split('@')[0] || 'User'}
                </button>

                <span className="text-slate-300 dark:text-[#333333] shrink-0">•</span>

                <span
                  className="text-slate-600 dark:text-[#A0A0A0] truncate max-w-[200px] sm:max-w-[320px]"
                  title={ev.relativePath ? `${ev.relativePath}/${ev.fileName}` : ev.fileName}
                >
                  {ev.fileName}
                </span>
              </div>

              <div className="text-[11px] text-slate-400 dark:text-[#666666] shrink-0 font-mono">
                {formatRelativeTime(ev.createdAt)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
