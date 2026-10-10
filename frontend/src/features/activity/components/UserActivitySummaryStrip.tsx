import React from 'react';
import { Activity, Users, FileText } from 'lucide-react';
import type { UserActivitySummary } from '../../../models/userActivity';

interface UserActivitySummaryStripProps {
  summary: UserActivitySummary;
}

export const UserActivitySummaryStrip: React.FC<UserActivitySummaryStripProps> = ({ summary }) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* 1. Total events */}
      <div className="bg-white dark:bg-[#0A0A0A] p-3 rounded-lg border border-slate-200 dark:border-[#242424] flex items-center justify-between">
        <div>
          <span className="text-[11px] font-medium text-slate-500 dark:text-[#8A8A8A] uppercase tracking-wider block">
            Total events
          </span>
          <span className="text-lg font-semibold text-slate-900 dark:text-[#E6E6E6] font-mono tabular-nums mt-0.5 block">
            {summary.totalEvents.toLocaleString()}
          </span>
        </div>
        <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-[#161616] border border-slate-200 dark:border-[#282828] flex items-center justify-center text-slate-600 dark:text-[#A0A0A0]">
          <Activity className="w-4 h-4" />
        </div>
      </div>

      {/* 2. Active users */}
      <div className="bg-white dark:bg-[#0A0A0A] p-3 rounded-lg border border-slate-200 dark:border-[#242424] flex items-center justify-between">
        <div>
          <span className="text-[11px] font-medium text-slate-500 dark:text-[#8A8A8A] uppercase tracking-wider block">
            Active users
          </span>
          <span className="text-lg font-semibold text-slate-900 dark:text-[#E6E6E6] font-mono tabular-nums mt-0.5 block">
            {summary.activeUsersCount.toLocaleString()}
          </span>
        </div>
        <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-[#161616] border border-slate-200 dark:border-[#282828] flex items-center justify-center text-slate-600 dark:text-[#A0A0A0]">
          <Users className="w-4 h-4" />
        </div>
      </div>

      {/* 3. Most accessed file */}
      <div className="bg-white dark:bg-[#0A0A0A] p-3 rounded-lg border border-slate-200 dark:border-[#242424] flex items-center justify-between min-w-0">
        <div className="min-w-0 flex-1 mr-2">
          <span className="text-[11px] font-medium text-slate-500 dark:text-[#8A8A8A] uppercase tracking-wider block">
            Most accessed file
          </span>
          {summary.mostAccessedFile ? (
            <div className="mt-0.5 truncate flex items-baseline gap-1.5">
              <span
                className="text-xs font-medium text-slate-900 dark:text-[#E6E6E6] truncate"
                title={summary.mostAccessedFile.name}
              >
                {summary.mostAccessedFile.name}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-[#8A8A8A] font-mono shrink-0">
                ({summary.mostAccessedFile.count}x)
              </span>
            </div>
          ) : (
            <span className="text-xs text-slate-400 dark:text-[#666666] mt-0.5 block">
              None in range
            </span>
          )}
        </div>
        <div className="w-8 h-8 rounded-md bg-slate-100 dark:bg-[#161616] border border-slate-200 dark:border-[#282828] flex items-center justify-center text-slate-600 dark:text-[#A0A0A0] shrink-0">
          <FileText className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
};
