import React from 'react';
import {
  RefreshCw,
  AlertCircle,
  Clock,
  Users,
  Loader2,
} from 'lucide-react';
import type { UserProfile } from '../../../models/user';
import type { SourceEntity } from '../../../models/source';
import { useUserActivity } from '../../../hooks/useUserActivity';
import { UserActivityFilterBar } from './UserActivityFilterBar';
import { UserActivitySummaryStrip } from './UserActivitySummaryStrip';
import { UserActivityTable } from './UserActivityTable';
import { UserActivityByUserView } from './UserActivityByUserView';
import { Button } from '../../../components/ui/Button';

interface UserActivityTabProps {
  vaultId: string;
  users: UserProfile[];
  sources: Map<string, SourceEntity>;
}

export const UserActivityTab: React.FC<UserActivityTabProps> = ({
  vaultId,
  users,
  sources,
}) => {
  const sourcesList = React.useMemo(() => Array.from(sources.values()), [sources]);

  const {
    filteredEvents,
    groupedEvents,
    summary,
    userSummaries,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    hasMore,
    filters,
    isFiltered,
    subView,
    setSubView,
    updateFilter,
    resetFilters,
    refresh,
    loadMore,
  } = useUserActivity(vaultId, users);

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Top Controls: Sub-view toggle & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#0A0A0A] p-3 rounded-lg border border-slate-200 dark:border-[#242424]">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-slate-100 dark:bg-[#141414] p-0.5 rounded-md border border-slate-200 dark:border-[#282828]">
            <button
              type="button"
              onClick={() => setSubView('chronological')}
              className={`h-7 px-3 text-xs rounded font-medium transition-colors flex items-center gap-1.5 ${
                subView === 'chronological'
                  ? 'bg-white dark:bg-[#222222] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                  : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>All events ({filteredEvents.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubView('by-user')}
              className={`h-7 px-3 text-xs rounded font-medium transition-colors flex items-center gap-1.5 ${
                subView === 'by-user'
                  ? 'bg-white dark:bg-[#222222] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                  : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>By user ({users.length})</span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={isLoading || isRefreshing}
            className="h-8 gap-1.5 text-xs text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]"
            title="Refresh user activity"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Summary Strip (Three inline flat stats) */}
      <UserActivitySummaryStrip summary={summary} />

      {/* Filter Bar */}
      <UserActivityFilterBar
        filters={filters}
        users={users}
        sources={sourcesList}
        isFiltered={isFiltered}
        onUpdateFilter={updateFilter}
        onResetFilters={resetFilters}
      />

      {/* Main Content Area */}
      {isLoading ? (
        /* Flat Skeleton Loading Rows (no shimmer gradients) */
        <div className="space-y-2 bg-white dark:bg-[#0A0A0A] p-4 rounded-lg border border-slate-200 dark:border-[#242424]">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-10 bg-slate-50 dark:bg-[#141414] rounded border border-slate-100 dark:border-[#1E1E1E] animate-pulse"
            />
          ))}
        </div>
      ) : error ? (
        /* Error State with Real Error Message & Retry */
        <div className="bg-white dark:bg-[#0A0A0A] p-6 rounded-lg border border-rose-200 dark:border-rose-950/40 text-center space-y-3">
          <AlertCircle className="w-6 h-6 text-rose-600 dark:text-rose-400 mx-auto" />
          <div className="text-xs text-slate-900 dark:text-[#E6E6E6] font-medium">
            Failed to load user activity
          </div>
          <p className="text-xs text-rose-600 dark:text-rose-400 font-mono max-w-lg mx-auto">
            {error}
          </p>
          <Button variant="secondary" size="sm" onClick={refresh} className="h-8 text-xs">
            Retry
          </Button>
        </div>
      ) : filteredEvents.length === 0 && subView === 'chronological' ? (
        /* Empty State */
        <div className="bg-white dark:bg-[#0A0A0A] p-8 rounded-lg border border-slate-200 dark:border-[#242424] text-center space-y-2">
          <p className="text-xs text-slate-500 dark:text-[#888888]">
            No activity in this range.
          </p>
          {isFiltered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-xs text-slate-700 dark:text-[#CCCCCC]"
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : subView === 'by-user' ? (
        /* By User View */
        <UserActivityByUserView userSummaries={userSummaries} sourcesMap={sources} />
      ) : (
        /* Chronological Table View */
        <div className="space-y-4">
          <UserActivityTable groupedDays={groupedEvents} sourcesMap={sources} />

          {/* Load More Button */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={loadMore}
                disabled={isLoadingMore}
                className="h-8 gap-2 text-xs"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Loading more...</span>
                  </>
                ) : (
                  <span>Load more activity</span>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
