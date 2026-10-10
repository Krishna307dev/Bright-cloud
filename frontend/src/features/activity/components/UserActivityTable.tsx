import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Eye,
  Download,
  FolderOpen,
  ExternalLink,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { UserActivityEvent, UserActivityAction } from '../../../models/userActivity';
import type { DayGroupedActivity } from '../../../hooks/useUserActivity';
import type { SourceEntity } from '../../../models/source';
import { FileIcon } from '../../../components/ui/FileIcon';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';

interface UserActivityTableProps {
  groupedDays: DayGroupedActivity[];
  sourcesMap: Map<string, SourceEntity>;
}

export function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffSec = Math.max(0, Math.floor((now - date.getTime()) / 1000));

  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function ActionBadge({ action }: { action: UserActivityAction }) {
  if (action === 'preview') {
    return (
      <Badge
        variant="neutral"
        size="sm"
        className="gap-1 border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/30"
      >
        <Eye className="w-3 h-3 text-sky-600 dark:text-sky-400" />
        Previewed
      </Badge>
    );
  }
  if (action === 'download') {
    return (
      <Badge
        variant="neutral"
        size="sm"
        className="gap-1 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
      >
        <Download className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
        Downloaded
      </Badge>
    );
  }
  return (
    <Badge
      variant="neutral"
      size="sm"
      className="gap-1 border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30"
    >
      <FolderOpen className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
      Opened
    </Badge>
  );
}

export const UserActivityTable: React.FC<UserActivityTableProps> = ({
  groupedDays,
  sourcesMap,
}) => {
  const navigate = useNavigate();
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

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

  const toggleExpand = (id: string) => {
    setExpandedEventId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="space-y-6">
      {groupedDays.map((dayGroup) => (
        <div key={dayGroup.dateKey} className="space-y-2">
          {/* Sticky Day Header */}
          <div className="sticky top-0 z-10 flex items-center gap-2 py-1.5 px-3 bg-slate-100/90 dark:bg-[#141414]/90 backdrop-blur-[2px] rounded-md border border-slate-200 dark:border-[#242424]">
            <Clock className="w-3.5 h-3.5 text-slate-500 dark:text-[#8A8A8A]" />
            <span className="text-xs font-semibold text-slate-800 dark:text-[#E0E0E0]">
              {dayGroup.dateLabel}
            </span>
            <span className="text-[11px] text-slate-400 dark:text-[#666666] font-mono">
              ({dayGroup.events.length} event{dayGroup.events.length > 1 ? 's' : ''})
            </span>
          </div>

          {/* Desktop Dense Table */}
          <div className="hidden sm:block overflow-hidden bg-white dark:bg-[#0A0A0A] rounded-lg border border-slate-200 dark:border-[#242424]">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-[#121212] border-b border-slate-200 dark:border-[#242424] text-slate-500 dark:text-[#8A8A8A] font-medium">
                <tr>
                  <th className="py-2.5 px-3">User</th>
                  <th className="py-2.5 px-3">Action</th>
                  <th className="py-2.5 px-3">File name</th>
                  <th className="py-2.5 px-3">Folder path</th>
                  <th className="py-2.5 px-3">Drive</th>
                  <th className="py-2.5 px-3 text-right">Time</th>
                  <th className="w-8 py-2.5 px-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1C1C1C]">
                {dayGroup.events.map((event) => {
                  const isExpanded = expandedEventId === event.id;
                  const source = sourcesMap.get(event.sourceId);
                  const driveName = event.sourceId === 'system' ? 'System' : (source?.displayName || event.sourceId || 'Unknown Drive');
                  const initial = (event.userDisplayName || event.email || 'U')[0].toUpperCase();

                  return (
                    <React.Fragment key={event.id}>
                      <tr
                        onClick={() => toggleExpand(event.id)}
                        className={`cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-[#121212] ${
                          isExpanded ? 'bg-slate-50/80 dark:bg-[#151515]' : ''
                        }`}
                      >
                        {/* 1. User */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-[#202020] text-slate-700 dark:text-[#CCCCCC] font-semibold text-[11px] flex items-center justify-center shrink-0">
                              {initial}
                            </div>
                            <span
                              className="font-medium text-slate-900 dark:text-[#E6E6E6] truncate max-w-[120px]"
                              title={`${event.userDisplayName} (${event.email})`}
                            >
                              {event.userDisplayName}
                            </span>
                          </div>
                        </td>

                        {/* 2. Action */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <ActionBadge action={event.action} />
                        </td>

                        {/* 3. File name */}
                        <td className="py-2.5 px-3 max-w-[200px]">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileIcon fileName={event.fileName} className="w-4 h-4 shrink-0" />
                            <span
                              className="font-medium text-slate-900 dark:text-[#E6E6E6] truncate"
                              title={event.fileName}
                            >
                              {event.fileName}
                            </span>
                          </div>
                        </td>

                        {/* 4. Folder path */}
                        <td className="py-2.5 px-3 max-w-[180px]">
                          <span
                            className="text-slate-400 dark:text-[#7A7A7A] truncate block font-mono text-[11px]"
                            title={event.relativePath || '/'}
                          >
                            /{event.relativePath || ''}
                          </span>
                        </td>

                        {/* 5. Drive */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 dark:text-[#999999]">
                          <span className="truncate block max-w-[120px]" title={driveName}>
                            {driveName}
                          </span>
                        </td>

                        {/* 6. Time */}
                        <td
                          className="py-2.5 px-3 whitespace-nowrap text-right text-slate-500 dark:text-[#888888] font-mono text-[11px]"
                          title={event.createdAt.toLocaleString()}
                        >
                          {formatRelativeTime(event.createdAt)}
                        </td>

                        {/* 7. Expand Chevron */}
                        <td className="py-2.5 px-2 text-right text-slate-400">
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </td>
                      </tr>

                      {/* Expanded Details Row */}
                      {isExpanded && (
                        <tr className="bg-slate-50/50 dark:bg-[#141414] border-b border-slate-200 dark:border-[#222222]">
                          <td colSpan={7} className="p-4">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                <div>
                                  <span className="text-[11px] text-slate-400 dark:text-[#777777] block font-medium">
                                    Full Path
                                  </span>
                                  <span className="font-mono text-slate-900 dark:text-[#E0E0E0] break-all">
                                    /{event.relativePath ? `${event.relativePath}/` : ''}
                                    {event.fileName}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[11px] text-slate-400 dark:text-[#777777] block font-medium">
                                    User Email
                                  </span>
                                  <span className="text-slate-800 dark:text-[#CCCCCC]">
                                    {event.email || 'N/A'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[11px] text-slate-400 dark:text-[#777777] block font-medium">
                                    Client Device
                                  </span>
                                  <span className="text-slate-800 dark:text-[#CCCCCC]">
                                    {event.device || 'Web Browser'}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[11px] text-slate-400 dark:text-[#777777] block font-medium">
                                    Exact Timestamp
                                  </span>
                                  <span className="font-mono text-slate-800 dark:text-[#CCCCCC]">
                                    {event.createdAt.toLocaleString()}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleOpenInFolder(event);
                                  }}
                                  className="h-8 gap-1.5 text-xs text-slate-800 dark:text-[#E6E6E6]"
                                >
                                  <span>{event.sourceId === 'system' ? 'Manage user profile' : 'Open in folder'}</span>
                                  <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                                </Button>
                              </div>
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

          {/* Mobile Stacked Rows (No horizontal scroll, 44px tap targets) */}
          <div className="sm:hidden space-y-2">
            {dayGroup.events.map((event) => {
              const isExpanded = expandedEventId === event.id;
              const source = sourcesMap.get(event.sourceId);
              const driveName = event.sourceId === 'system' ? 'System' : (source?.displayName || event.sourceId || 'Drive');
              const initial = (event.userDisplayName || event.email || 'U')[0].toUpperCase();

              return (
                <div
                  key={event.id}
                  onClick={() => toggleExpand(event.id)}
                  className={`bg-white dark:bg-[#0A0A0A] rounded-lg border border-slate-200 dark:border-[#242424] p-3.5 transition-colors cursor-pointer ${
                    isExpanded ? 'ring-1 ring-slate-300 dark:ring-[#333333]' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <FileIcon fileName={event.fileName} className="w-5 h-5 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <span className="text-xs font-semibold text-slate-900 dark:text-[#E6E6E6] truncate block">
                          {event.fileName}
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-[#777777] font-mono truncate block mt-0.5">
                          /{event.relativePath || ''}
                        </span>
                      </div>
                    </div>
                    <ActionBadge action={event.action} />
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#8A8A8A] pt-2 mt-2 border-t border-slate-100 dark:border-[#1E1E1E]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-[#202020] text-slate-700 dark:text-[#CCCCCC] font-semibold text-[10px] flex items-center justify-center shrink-0">
                        {initial}
                      </div>
                      <span className="text-[11px] truncate max-w-[120px]">
                        {event.userDisplayName}
                      </span>
                    </div>

                    <span
                      className="text-[11px] font-mono shrink-0"
                      title={event.createdAt.toLocaleString()}
                    >
                      {formatRelativeTime(event.createdAt)}
                    </span>
                  </div>

                  {/* Expanded Mobile Details */}
                  {isExpanded && (
                    <div className="pt-3 mt-3 border-t border-slate-100 dark:border-[#1C1C1C] space-y-2.5 text-xs animate-fadeIn">
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-400 dark:text-[#666666] block">Drive</span>
                          <span className="text-slate-800 dark:text-[#CCCCCC]">{driveName}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 dark:text-[#666666] block">Device</span>
                          <span className="text-slate-800 dark:text-[#CCCCCC]">
                            {event.device || 'Web Browser'}
                          </span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-slate-400 dark:text-[#666666] block">Time</span>
                          <span className="font-mono text-slate-800 dark:text-[#CCCCCC]">
                            {event.createdAt.toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="pt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenInFolder(event);
                          }}
                          className="w-full min-h-[44px] justify-center gap-1.5 text-xs text-slate-800 dark:text-[#E6E6E6]"
                        >
                          <span>{event.sourceId === 'system' ? 'Manage user profile' : 'Open in folder'}</span>
                          <ExternalLink className="w-4 h-4 text-slate-500" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
