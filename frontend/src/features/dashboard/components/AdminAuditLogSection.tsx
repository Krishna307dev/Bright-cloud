import React, { useState } from 'react';
import {
  ShieldAlert,
  ExternalLink,
} from 'lucide-react';
import type { AdminAuditRecord } from '../../../models/webCustomization';
import { formatDate } from '../../../utils/format';
import { Dialog } from '../../../components/ui/Dialog';
import { Button } from '../../../components/ui/Button';

interface AdminAuditLogSectionProps {
  logs: AdminAuditRecord[];
  isLoading: boolean;
}

export const AdminAuditLogSection: React.FC<AdminAuditLogSectionProps> = ({
  logs,
  isLoading,
}) => {
  const [isViewAllOpen, setIsViewAllOpen] = useState(false);

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'UPDATE_GLOBAL_CONFIG':
        return 'Updated Global Config';
      case 'RESET_GLOBAL_CONFIG':
        return 'Reset Global Config';
      case 'UPDATE_USER_OVERRIDE':
        return 'Updated User Overrides';
      case 'RESET_USER_OVERRIDE':
        return 'Reset User Overrides';
      case 'CHANGE_USER_ROLE':
        return 'Changed User Role';
      case 'SUSPEND_USER':
        return 'Suspended User';
      case 'ACTIVATE_USER':
        return 'Activated User';
      case 'APPROVE_USER':
        return 'Approved User';
      case 'REJECT_USER':
        return 'Rejected User';
      default:
        return action;
    }
  };

  return (
    <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-4 sm:p-5 shadow-2xs">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-[#242424] mb-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-brand-600 dark:text-[#1DB954]" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
            Admin Action Audit Log
          </h2>
          <span className="text-[11px] font-medium text-slate-400 dark:text-[#8A8A8A]">
            ({logs.length} logged events)
          </span>
        </div>

        {logs.length > 5 && (
          <button
            type="button"
            onClick={() => setIsViewAllOpen(true)}
            className="text-xs font-medium text-brand-600 dark:text-[#1DB954] hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>View all</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-xs text-slate-400 dark:text-[#8A8A8A]">
          Loading audit trail...
        </div>
      ) : logs.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400 dark:text-[#8A8A8A]">
          No administrative settings or permissions have been altered yet.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-left text-xs border-collapse min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-100 dark:border-[#202020] text-[11px] text-slate-400 dark:text-[#8A8A8A] font-semibold uppercase tracking-wider">
                <th className="py-2.5 px-3 w-44">Timestamp</th>
                <th className="py-2.5 px-3 w-52">Admin</th>
                <th className="py-2.5 px-3 w-44">Action</th>
                <th className="py-2.5 px-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#181818]">
              {logs.slice(0, 5).map((log) => (
                <tr
                  key={log.id}
                  className="hover:bg-slate-50/70 dark:hover:bg-[#121212] transition-colors"
                >
                  <td className="py-2 px-3 font-mono text-[11px] text-slate-500 dark:text-[#8A8A8A] whitespace-nowrap">
                    {formatDate(log.timestamp)}
                  </td>
                  <td className="py-2 px-3 font-medium text-slate-800 dark:text-[#E6E6E6] whitespace-nowrap">
                    {log.adminEmail || log.adminUid}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-slate-100 dark:bg-[#181818] text-slate-700 dark:text-[#E6E6E6] border border-slate-200/60 dark:border-[#282828]">
                      {getActionLabel(log.action)}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-slate-600 dark:text-[#A0A0A0] max-w-xs truncate" title={log.details}>
                    {log.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* View All Modal */}
      <Dialog
        isOpen={isViewAllOpen}
        onClose={() => setIsViewAllOpen(false)}
        title="Admin Audit Trail (Full Log)"
        maxWidth="xl"
      >
        <div className="space-y-4 max-h-[70vh] flex flex-col">
          <div className="overflow-y-auto flex-1">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-white dark:bg-[#0A0A0A]">
                <tr className="border-b border-slate-200 dark:border-[#202020] text-[11px] text-slate-400 dark:text-[#8A8A8A] font-semibold uppercase tracking-wider">
                  <th className="py-2 px-3">Timestamp</th>
                  <th className="py-2 px-3">Admin</th>
                  <th className="py-2 px-3">Action</th>
                  <th className="py-2 px-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#181818]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-[#121212]">
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 dark:text-[#8A8A8A] whitespace-nowrap">
                      {formatDate(log.timestamp)}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-[#E6E6E6] whitespace-nowrap">
                      {log.adminEmail || log.adminUid}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-slate-100 dark:bg-[#181818] text-slate-700 dark:text-[#E6E6E6] border border-slate-200/60 dark:border-[#282828]">
                        {getActionLabel(log.action)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-[#A0A0A0]">
                      {log.details}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-[#242424]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsViewAllOpen(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
