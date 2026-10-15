import React from 'react';
import { Link } from 'react-router-dom';
import {
  HardDrive,
  ExternalLink,
} from 'lucide-react';
import type { SourceEntity } from '../../../models/source';
import { formatBytes, formatDate } from '../../../utils/format';

export interface DriveStorageTelemetry {
  source: SourceEntity;
  fileCount: number;
  totalBytes: number;
  lastActivity?: Date;
}

interface DrivesStorageSectionProps {
  drives: DriveStorageTelemetry[];
  totalVaultBytes: number;
  isLoading: boolean;
}

export const DrivesStorageSection: React.FC<DrivesStorageSectionProps> = ({
  drives,
  totalVaultBytes,
  isLoading,
}) => {
  return (
    <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-4 sm:p-5 shadow-2xs">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-[#242424] mb-3">
        <div className="flex items-center gap-2">
          <HardDrive className="w-4 h-4 text-purple-600 dark:text-purple-400" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
            Storage & Drives Overview
          </h2>
          <span className="text-[11px] font-medium text-slate-400 dark:text-[#8A8A8A]">
            ({drives.length} drives)
          </span>
        </div>

        <Link
          to="/sources"
          className="text-xs font-medium text-brand-600 dark:text-[#1DB954] hover:underline flex items-center gap-1"
        >
          <span>Manage Sources</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-xs text-slate-400 dark:text-[#8A8A8A]">
          Loading drives telemetry...
        </div>
      ) : drives.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400 dark:text-[#8A8A8A]">
          No storage drives registered in this vault.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {drives.map(({ source, fileCount, totalBytes }) => {
            const percentageOfTotal =
              totalVaultBytes > 0
                ? Math.min(100, Math.round((totalBytes / totalVaultBytes) * 100))
                : 0;

            return (
              <div
                key={source.sourceId}
                className="p-3.5 rounded-lg border border-slate-100 dark:border-[#1E1E1E] bg-slate-50/50 dark:bg-[#111111] hover:border-slate-300 dark:hover:border-[#333333] transition-colors flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-xs text-slate-900 dark:text-[#E6E6E6] truncate">
                        {source.displayName}
                      </h3>
                      <p className="text-[10px] font-mono text-slate-400 dark:text-[#8A8A8A] truncate">
                        {source.sourceId}
                      </p>
                    </div>

                    <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/50 dark:border-emerald-800/40 shrink-0">
                      Active
                    </span>
                  </div>

                  {/* Telemetry Numbers */}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 dark:text-[#8A8A8A] block">
                        Files
                      </span>
                      <span className="font-bold text-slate-800 dark:text-[#E6E6E6]">
                        {fileCount.toLocaleString()}
                      </span>
                    </div>

                    <div>
                      <span className="text-[10px] text-slate-400 dark:text-[#8A8A8A] block">
                        Storage
                      </span>
                      <span className="font-bold text-slate-800 dark:text-[#E6E6E6]">
                        {formatBytes(totalBytes)}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  {totalVaultBytes > 0 && (
                    <div className="mt-2.5">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 dark:text-[#8A8A8A] mb-1">
                        <span>Vault share</span>
                        <span>{percentageOfTotal}%</span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-[#202020] rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-brand-500 dark:bg-[#1DB954] h-1.5 rounded-full transition-all"
                          style={{ width: `${percentageOfTotal}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer action: link to Explorer with this drive selected */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-[#1E1E1E] flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 dark:text-[#666666] text-[10px]">
                    Last seen: {source.lastSeen ? formatDate(source.lastSeen) : 'N/A'}
                  </span>

                  <Link
                    to={`/files?drive=${source.sourceId}`}
                    className="text-brand-600 dark:text-[#1DB954] hover:underline flex items-center gap-1 font-medium"
                  >
                    <span>Open in Explorer</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
