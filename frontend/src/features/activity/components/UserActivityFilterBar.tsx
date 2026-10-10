import React, { useState } from 'react';
import {
  Search,
  Filter,
  X,
  ChevronDown,
} from 'lucide-react';
import type {
  UserActivityFilterState,
  ActivityDateRange,
  UserActivityAction,
} from '../../../models/userActivity';
import type { UserProfile } from '../../../models/user';
import type { SourceEntity } from '../../../models/source';
import { Button } from '../../../components/ui/Button';

interface UserActivityFilterBarProps {
  filters: UserActivityFilterState;
  users: UserProfile[];
  sources: SourceEntity[];
  isFiltered: boolean;
  onUpdateFilter: <K extends keyof UserActivityFilterState>(
    key: K,
    value: UserActivityFilterState[K]
  ) => void;
  onResetFilters: () => void;
}

export const UserActivityFilterBar: React.FC<UserActivityFilterBarProps> = ({
  filters,
  users,
  sources,
  isFiltered,
  onUpdateFilter,
  onResetFilters,
}) => {
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  // Active filter count for mobile badge
  const activeCount = [
    filters.userId !== 'all',
    filters.action !== 'all',
    filters.sourceId !== 'all',
    filters.dateRange !== 'all',
    filters.searchQuery.trim() !== '',
  ].filter(Boolean).length;

  return (
    <div className="space-y-3">
      {/* Mobile filter toggle and quick search */}
      <div className="flex sm:hidden items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#8A8A8A] pointer-events-none" />
          <input
            type="text"
            placeholder="Search files or paths..."
            value={filters.searchQuery}
            onChange={(e) => onUpdateFilter('searchQuery', e.target.value)}
            className="w-full min-h-[44px] pl-9 pr-3 text-xs bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#242424] rounded-lg text-slate-900 dark:text-[#E6E6E6] placeholder-slate-400 dark:placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-slate-400 dark:focus:ring-[#444444]"
          />
        </div>

        <button
          type="button"
          onClick={() => setIsMobileFiltersOpen(true)}
          className="min-h-[44px] min-w-[44px] px-3 py-2 flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#0A0A0A] text-slate-700 dark:text-[#CCCCCC]"
          aria-label="Open filters"
        >
          <Filter className="w-4 h-4" />
          <span>Filters</span>
          {activeCount > 0 && (
            <span className="w-4 h-4 rounded-full bg-slate-900 text-white dark:bg-white dark:text-black text-[10px] font-mono flex items-center justify-center font-bold">
              {activeCount}
            </span>
          )}
        </button>

        {isFiltered && (
          <button
            type="button"
            onClick={onResetFilters}
            className="min-h-[44px] px-2 text-xs text-rose-600 dark:text-rose-400 hover:underline flex items-center"
            title="Reset filters"
          >
            Reset
          </button>
        )}
      </div>

      {/* Desktop Filter Bar (one row, wraps cleanly) */}
      <div className="hidden sm:flex flex-wrap items-center gap-2 bg-white dark:bg-[#0A0A0A] p-2.5 rounded-lg border border-slate-200 dark:border-[#242424]">
        {/* User dropdown */}
        <div className="relative">
          <select
            value={filters.userId}
            onChange={(e) => onUpdateFilter('userId', e.target.value)}
            className="h-8 pl-2.5 pr-7 text-xs bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-md text-slate-800 dark:text-[#E0E0E0] focus:outline-none focus:ring-1 focus:ring-slate-400 dark:focus:ring-[#444444] appearance-none cursor-pointer"
            aria-label="Filter by user"
          >
            <option value="all">All users</option>
            {users.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.displayName || u.email?.split('@')[0]}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* Action segmented control */}
        <div className="flex items-center bg-slate-100 dark:bg-[#141414] p-0.5 rounded-md border border-slate-200 dark:border-[#282828]">
          {(['all', 'preview', 'download'] as const).map((act) => {
            const isSelected = filters.action === act;
            const label = act === 'all' ? 'All' : act === 'preview' ? 'Previewed' : 'Downloaded';
            return (
              <button
                key={act}
                type="button"
                onClick={() => onUpdateFilter('action', act as UserActivityAction | 'all')}
                className={`h-7 px-2.5 text-xs rounded font-medium transition-colors ${
                  isSelected
                    ? 'bg-white dark:bg-[#222222] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                    : 'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Drive dropdown */}
        <div className="relative">
          <select
            value={filters.sourceId}
            onChange={(e) => onUpdateFilter('sourceId', e.target.value)}
            className="h-8 pl-2.5 pr-7 text-xs bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-md text-slate-800 dark:text-[#E0E0E0] focus:outline-none focus:ring-1 focus:ring-slate-400 dark:focus:ring-[#444444] appearance-none cursor-pointer"
            aria-label="Filter by drive"
          >
            <option value="all">All drives</option>
            {sources.map((s) => (
              <option key={s.sourceId} value={s.sourceId}>
                {s.displayName || `Drive ${s.sourceId}`}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* Date range dropdown */}
        <div className="relative">
          <select
            value={filters.dateRange}
            onChange={(e) => onUpdateFilter('dateRange', e.target.value as ActivityDateRange)}
            className="h-8 pl-2.5 pr-7 text-xs bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-md text-slate-800 dark:text-[#E0E0E0] focus:outline-none focus:ring-1 focus:ring-slate-400 dark:focus:ring-[#444444] appearance-none cursor-pointer"
            aria-label="Filter by date range"
          >
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="7days">Past 7 days</option>
            <option value="30days">Past 30 days</option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* Search input */}
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search file name or path..."
            value={filters.searchQuery}
            onChange={(e) => onUpdateFilter('searchQuery', e.target.value)}
            className="w-full h-8 pl-8 pr-2.5 text-xs bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#282828] rounded-md text-slate-900 dark:text-[#E6E6E6] placeholder-slate-400 dark:placeholder-[#666666] focus:outline-none focus:ring-1 focus:ring-slate-400 dark:focus:ring-[#444444]"
          />
        </div>

        {/* Reset text button */}
        {isFiltered && (
          <button
            type="button"
            onClick={onResetFilters}
            className="h-8 px-2 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-[#888888] dark:hover:text-[#CCCCCC] hover:underline transition-colors shrink-0"
            title="Reset active filters"
          >
            Reset
          </button>
        )}
      </div>

      {/* Mobile Filter Sheet / Modal */}
      {isMobileFiltersOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:hidden bg-black/60 backdrop-blur-[2px]">
          <div className="w-full bg-white dark:bg-[#0E0E0E] border-t border-slate-200 dark:border-[#242424] rounded-t-2xl p-5 space-y-4 max-h-[85vh] overflow-y-auto animate-fadeIn">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-[#1E1E1E]">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-600 dark:text-[#AAAAAA]" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-[#E6E6E6]">
                  Filter User Activity
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileFiltersOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-[#E6E6E6]"
                aria-label="Close filters"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mobile User Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-[#8A8A8A]">
                User
              </label>
              <select
                value={filters.userId}
                onChange={(e) => onUpdateFilter('userId', e.target.value)}
                className="w-full min-h-[44px] px-3 text-xs bg-slate-50 dark:bg-[#161616] border border-slate-200 dark:border-[#282828] rounded-lg text-slate-900 dark:text-[#E6E6E6]"
              >
                <option value="all">All users</option>
                {users.map((u) => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName || u.email?.split('@')[0]}
                  </option>
                ))}
              </select>
            </div>

            {/* Mobile Action Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-[#8A8A8A]">
                Action
              </label>
              <div className="grid grid-cols-3 gap-1 bg-slate-100 dark:bg-[#161616] p-1 rounded-lg">
                {(['all', 'preview', 'download'] as const).map((act) => {
                  const isSelected = filters.action === act;
                  const label = act === 'all' ? 'All' : act === 'preview' ? 'Preview' : 'Download';
                  return (
                    <button
                      key={act}
                      type="button"
                      onClick={() => onUpdateFilter('action', act as UserActivityAction | 'all')}
                      className={`min-h-[44px] px-2 text-xs rounded-md font-medium ${
                        isSelected
                          ? 'bg-white dark:bg-[#242424] text-slate-900 dark:text-[#E6E6E6] shadow-sm'
                          : 'text-slate-600 dark:text-[#8A8A8A]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mobile Drive Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-[#8A8A8A]">
                Drive
              </label>
              <select
                value={filters.sourceId}
                onChange={(e) => onUpdateFilter('sourceId', e.target.value)}
                className="w-full min-h-[44px] px-3 text-xs bg-slate-50 dark:bg-[#161616] border border-slate-200 dark:border-[#282828] rounded-lg text-slate-900 dark:text-[#E6E6E6]"
              >
                <option value="all">All drives</option>
                {sources.map((s) => (
                  <option key={s.sourceId} value={s.sourceId}>
                    {s.displayName || `Drive ${s.sourceId}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Mobile Date Range Filter */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-[#8A8A8A]">
                Date range
              </label>
              <select
                value={filters.dateRange}
                onChange={(e) => onUpdateFilter('dateRange', e.target.value as ActivityDateRange)}
                className="w-full min-h-[44px] px-3 text-xs bg-slate-50 dark:bg-[#161616] border border-slate-200 dark:border-[#282828] rounded-lg text-slate-900 dark:text-[#E6E6E6]"
              >
                <option value="all">All time</option>
                <option value="today">Today</option>
                <option value="7days">Past 7 days</option>
                <option value="30days">Past 30 days</option>
              </select>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <Button
                variant="primary"
                onClick={() => setIsMobileFiltersOpen(false)}
                className="flex-1 min-h-[44px] justify-center text-xs"
              >
                Apply Filters
              </Button>
              {isFiltered && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    onResetFilters();
                    setIsMobileFiltersOpen(false);
                  }}
                  className="min-h-[44px] text-xs"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
