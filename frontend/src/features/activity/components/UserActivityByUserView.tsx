import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import type { UserSummaryRecord, UserActivityEvent } from '../../../models/userActivity';
import type { SourceEntity } from '../../../models/source';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { FileIcon } from '../../../components/ui/FileIcon';
import { ActionBadge, formatRelativeTime } from './UserActivityTable';

interface UserActivityByUserViewProps {
  userSummaries: UserSummaryRecord[];
  sourcesMap: Map<string, SourceEntity>;
}

export const UserActivityByUserView: React.FC<UserActivityByUserViewProps> = ({
  userSummaries,
  sourcesMap,
}) => {
  const navigate = useNavigate();
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  const toggleUserExpand = (uid: string) => {
    setExpandedUid((prev) => (prev === uid ? null : uid));
  };

  const handleOpenInFolder = (event: UserActivityEvent) => {
    if (event.sourceId === 'system') {
      navigate('/users');
      return;
    }
    const cleanPath = (event.relativePath || '').replace(/^\/+|\/+$/g, '');
    const driveRoute = event.sourceId ? `/files/${event.sourceId}/${cleanPath}` : '/files';
    navigate(driveRoute, {
      state: { highlightFileId: event.fileId },
    });
  };

  if (userSummaries.length === 0) {
    return (
      <div className="bg-white dark:bg-[#0A0A0A] rounded-lg border border-slate-200 dark:border-[#242424] p-8 text-center text-xs text-slate-500 dark:text-[#888888]">
        No users registered in this vault.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Desktop view */}
      <div className="hidden sm:block overflow-hidden bg-white dark:bg-[#0A0A0A] rounded-lg border border-slate-200 dark:border-[#242424]">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-[#121212] border-b border-slate-200 dark:border-[#242424] text-slate-500 dark:text-[#8A8A8A] font-medium">
            <tr>
              <th className="py-2.5 px-3">User</th>
              <th className="py-2.5 px-3">Role</th>
              <th className="py-2.5 px-3 text-right">Previews</th>
              <th className="py-2.5 px-3 text-right">Downloads</th>
              <th className="py-2.5 px-3 text-right">Total events</th>
              <th className="py-2.5 px-3 text-right">Last active</th>
              <th className="w-8 py-2.5 px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-[#1C1C1C]">
            {userSummaries.map((record) => {
              const isExpanded = expandedUid === record.uid;
              const hasActivity = record.totalCount > 0;
              const initial = (record.displayName || record.email || 'U')[0].toUpperCase();

              return (
                <React.Fragment key={record.uid}>
                  <tr
                    onClick={() => toggleUserExpand(record.uid)}
                    className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-[#121212] ${
                      isExpanded ? 'bg-slate-50/80 dark:bg-[#151515]' : ''
                    }`}
                  >
                    {/* User info */}
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-[#202020] text-slate-700 dark:text-[#CCCCCC] font-semibold text-xs flex items-center justify-center shrink-0">
                          {initial}
                        </div>
                        <div className="min-w-0">
                          <span
                            className="font-medium text-slate-900 dark:text-[#E6E6E6] truncate block"
                            title={record.displayName}
                          >
                            {record.displayName}
                          </span>
                          <span
                            className="text-[11px] text-slate-400 dark:text-[#777777] truncate block"
                            title={record.email}
                          >
                            {record.email}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Role badge */}
                    <td className="py-3 px-3">
                      {record.role === 'admin' ? (
                        <Badge variant="brand" size="sm" className="text-[10px]">
                          Admin
                        </Badge>
                      ) : (
                        <Badge variant="neutral" size="sm" className="text-[10px]">
                          {record.role || 'Member'}
                        </Badge>
                      )}
                    </td>

                    {/* Previews count */}
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-[#CCCCCC]">
                      {record.previewCount}
                    </td>

                    {/* Downloads count */}
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-[#CCCCCC]">
                      {record.downloadCount}
                    </td>

                    {/* Total events */}
                    <td className="py-3 px-3 text-right">
                      {hasActivity ? (
                        <span className="font-semibold font-mono tabular-nums text-slate-900 dark:text-[#E6E6E6]">
                          {record.totalCount}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-[#666666] italic text-[11px]">
                          No file actions
                        </span>
                      )}
                    </td>

                    {/* Last active time */}
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      {record.lastActive ? (
                        <span
                          className="text-slate-500 dark:text-[#888888] font-mono text-[11px]"
                          title={record.lastActive.toLocaleString()}
                        >
                          {formatRelativeTime(record.lastActive)}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-[#666666] italic text-[11px]">
                          Never
                        </span>
                      )}
                    </td>

                    {/* Chevron */}
                    <td className="py-3 px-2 text-right text-slate-400">
                      {isExpanded ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </td>
                  </tr>

                  {/* Expandable Accordion with User's Recent File Activity */}
                  {isExpanded && (
                    <tr className="bg-slate-50/50 dark:bg-[#141414] border-b border-slate-200 dark:border-[#222222]">
                      <td colSpan={7} className="p-4">
                        <div className="space-y-3">
                          {record.recentEvents.length > 0 ? (
                            <div className="space-y-2">
                              <span className="text-[11px] font-semibold text-slate-600 dark:text-[#AAAAAA] uppercase tracking-wider block">
                                Recent Files Accessed ({record.recentEvents.length})
                              </span>
                              <div className="divide-y divide-slate-100 dark:divide-[#1F1F1F] rounded-md border border-slate-200 dark:border-[#222222] bg-white dark:bg-[#0C0C0C] overflow-hidden">
                                {record.recentEvents.map((evt) => {
                                  const src = sourcesMap.get(evt.sourceId);
                                  const driveName = src?.displayName || evt.sourceId || 'Drive';
                                  return (
                                    <div
                                      key={evt.id}
                                      className="flex items-center justify-between p-2.5 gap-3 hover:bg-slate-50 dark:hover:bg-[#151515] transition-colors"
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <FileIcon fileName={evt.fileName} className="w-4 h-4 shrink-0" />
                                        <span
                                          className="font-medium text-slate-900 dark:text-[#E6E6E6] truncate text-xs"
                                          title={evt.fileName}
                                        >
                                          {evt.fileName}
                                        </span>
                                        <span
                                          className="text-slate-400 dark:text-[#666666] font-mono text-[11px] truncate hidden md:inline"
                                          title={evt.relativePath || '/'}
                                        >
                                          /{evt.relativePath || ''}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-3 shrink-0">
                                        <span className="text-slate-400 dark:text-[#777777] text-[11px] hidden sm:inline">
                                          {driveName}
                                        </span>
                                        <ActionBadge action={evt.action} />
                                        <span
                                          className="text-slate-400 dark:text-[#777777] font-mono text-[11px]"
                                          title={evt.createdAt.toLocaleString()}
                                        >
                                          {formatRelativeTime(evt.createdAt)}
                                        </span>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => handleOpenInFolder(evt)}
                                          className="h-7 w-7 p-0 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-[#E6E6E6]"
                                          title="Open in folder"
                                        >
                                          <ExternalLink className="w-3.5 h-3.5" />
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <div className="text-center py-3 text-xs text-slate-500 dark:text-[#777777]">
                              No file preview or download records yet. This user has not accessed files on the website.
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Stacked Cards (44px tap targets) */}
      <div className="sm:hidden space-y-2.5">
        {userSummaries.map((record) => {
          const isExpanded = expandedUid === record.uid;
          const hasActivity = record.totalCount > 0;
          const initial = (record.displayName || record.email || 'U')[0].toUpperCase();

          return (
            <div
              key={record.uid}
              onClick={() => toggleUserExpand(record.uid)}
              className={`bg-white dark:bg-[#0A0A0A] rounded-lg border border-slate-200 dark:border-[#242424] p-3.5 transition-colors cursor-pointer ${
                isExpanded ? 'ring-1 ring-slate-300 dark:ring-[#333333]' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-[#202020] text-slate-700 dark:text-[#CCCCCC] font-semibold text-xs flex items-center justify-center shrink-0">
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-900 dark:text-[#E6E6E6] truncate block">
                      {record.displayName}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-[#777777] truncate block">
                      {record.email}
                    </span>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  {hasActivity ? (
                    <span className="text-xs font-mono font-semibold text-slate-900 dark:text-[#E6E6E6]">
                      {record.totalCount} events
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400 dark:text-[#666666] italic">
                      No file actions
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs pt-2.5 mt-2.5 border-t border-slate-100 dark:border-[#1E1E1E]">
                <div className="bg-slate-50 dark:bg-[#121212] p-1.5 rounded">
                  <span className="text-[10px] text-slate-400 dark:text-[#777777] block">Previews</span>
                  <span className="font-mono font-medium text-slate-800 dark:text-[#CCCCCC]">
                    {record.previewCount}
                  </span>
                </div>
                <div className="bg-slate-50 dark:bg-[#121212] p-1.5 rounded">
                  <span className="text-[10px] text-slate-400 dark:text-[#777777] block">Downloads</span>
                  <span className="font-mono font-medium text-slate-800 dark:text-[#CCCCCC]">
                    {record.downloadCount}
                  </span>
                </div>
                <div className="bg-slate-50 dark:bg-[#121212] p-1.5 rounded">
                  <span className="text-[10px] text-slate-400 dark:text-[#777777] block">Last active</span>
                  <span className="font-mono text-[11px] text-slate-800 dark:text-[#CCCCCC]">
                    {record.lastActive ? formatRelativeTime(record.lastActive) : 'Never'}
                  </span>
                </div>
              </div>

              {/* Mobile Expanded List */}
              {isExpanded && (
                <div className="pt-3 mt-3 border-t border-slate-100 dark:border-[#1E1E1E] space-y-3 animate-fadeIn">
                  {record.recentEvents.length > 0 ? (
                    <div className="space-y-2">
                      <span className="text-[11px] font-semibold text-slate-500 dark:text-[#888888] uppercase tracking-wider block">
                        Recent Files ({record.recentEvents.length})
                      </span>
                      <div className="divide-y divide-slate-100 dark:divide-[#1C1C1C]">
                        {record.recentEvents.map((evt) => (
                          <div
                            key={evt.id}
                            className="py-2 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-xs font-medium text-slate-900 dark:text-[#E6E6E6] truncate block">
                                {evt.fileName}
                              </span>
                              <span className="text-[10px] text-slate-400 dark:text-[#777777] font-mono truncate block">
                                /{evt.relativePath || ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <ActionBadge action={evt.action} />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenInFolder(evt);
                                }}
                                className="min-h-[44px] min-w-[44px] p-0 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-[#E6E6E6]"
                                title="Open in folder"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-2 text-xs text-slate-500 dark:text-[#777777]">
                      No file preview or download records yet. This user has not accessed files on the website.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
