import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock,
  Check,
  X,
  ExternalLink,
  Mail,
  AlertCircle,
} from 'lucide-react';
import type { ApprovalRequest } from '../../../models/user';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { formatDate } from '../../../utils/format';

interface PendingApprovalsSectionProps {
  requests: ApprovalRequest[];
  onApprove: (req: ApprovalRequest) => Promise<void>;
  onReject: (req: ApprovalRequest) => Promise<void>;
}

export const PendingApprovalsSection: React.FC<PendingApprovalsSectionProps> = ({
  requests,
  onApprove,
  onReject,
}) => {
  const [rejectingRequest, setRejectingRequest] = useState<ApprovalRequest | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeUid, setActiveUid] = useState<string | null>(null);

  const handleApprove = async (req: ApprovalRequest) => {
    try {
      setActiveUid(req.uid);
      setIsProcessing(true);
      await onApprove(req);
    } finally {
      setIsProcessing(false);
      setActiveUid(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectingRequest) return;
    try {
      setIsProcessing(true);
      await onReject(rejectingRequest);
      setRejectingRequest(null);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-[#0A0A0A] rounded-xl border border-slate-200/80 dark:border-[#242424] p-4 sm:p-5 shadow-2xs">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-[#242424] mb-3">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
            Pending Approvals
          </h2>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-900/60">
            {requests.length}
          </span>
        </div>

        <Link
          to="/users?filter=pending"
          className="text-xs font-medium text-brand-600 dark:text-[#1DB954] hover:underline flex items-center gap-1"
        >
          <span>Open in Manage Users</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-400 dark:text-[#8A8A8A]">
          No pending access requests. All users have been approved or rejected.
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-[#1C1C1C]">
          {requests.slice(0, 5).map((req) => (
            <div
              key={req.uid}
              className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800 dark:text-[#E6E6E6] truncate">
                    {req.name || 'Anonymous User'}
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-[#8A8A8A] flex items-center gap-1 truncate">
                    <Mail className="w-3 h-3 shrink-0" />
                    {req.email}
                  </span>
                </div>
                {req.reason && (
                  <p className="text-[11px] text-slate-500 dark:text-[#8A8A8A] mt-1 line-clamp-1 italic">
                    &ldquo;{req.reason}&rdquo;
                  </p>
                )}
                <p className="text-[10px] text-slate-400 dark:text-[#666666] mt-0.5">
                  Requested {req.createdAt ? formatDate(req.createdAt) : 'recently'}
                  {req.referredBy ? ` • Referred by: ${req.referredBy}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => handleApprove(req)}
                  disabled={isProcessing && activeUid === req.uid}
                  className="gap-1 text-xs py-1 px-2.5 h-7"
                >
                  <Check className="w-3 h-3" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRejectingRequest(req)}
                  disabled={isProcessing}
                  className="gap-1 text-xs py-1 px-2.5 h-7 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                >
                  <X className="w-3 h-3" />
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation Dialog for Rejecting */}
      <Dialog
        isOpen={Boolean(rejectingRequest)}
        onClose={() => setRejectingRequest(null)}
        title="Reject Access Request"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-lg text-rose-800 dark:text-rose-200 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
            <div>
              <p className="font-semibold">Confirm Request Rejection</p>
              <p className="mt-0.5 text-rose-700 dark:text-rose-300">
                Are you sure you want to reject access for <span className="font-bold">{rejectingRequest?.name}</span> ({rejectingRequest?.email})? The user will remain restricted from accessing vault files.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#242424]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRejectingRequest(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleConfirmReject}
              disabled={isProcessing}
            >
              {isProcessing ? 'Rejecting...' : 'Reject Request'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
