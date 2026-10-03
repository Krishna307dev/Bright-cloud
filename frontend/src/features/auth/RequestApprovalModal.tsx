import React, { useState, useEffect } from 'react';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ApprovalService } from '../../services/firestore/approvalService';
import type { ApprovalRequest } from '../../models';
import { useToast } from '../../components/ui/Toast';
import { ShieldCheck, Info } from 'lucide-react';

interface RequestApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: { uid: string; email?: string | null; displayName?: string | null } | null;
  existingRequest?: ApprovalRequest | null;
  onSuccess?: (request: ApprovalRequest) => void;
}

export const RequestApprovalModal: React.FC<RequestApprovalModalProps> = ({
  isOpen,
  onClose,
  user,
  existingRequest,
  onSuccess,
}) => {
  const toast = useToast();
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [referredBy, setReferredBy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(existingRequest?.name || user?.displayName || '');
      setReason(existingRequest?.reason || '');
      setReferredBy(existingRequest?.referredBy || '');
      setError(null);
    }
  }, [isOpen, existingRequest, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError('You must be signed in to request approval.');
      return;
    }

    const cleanName = name.trim();
    const cleanReason = reason.trim();
    const cleanReferredBy = referredBy.trim().slice(0, 100);

    if (!cleanName) {
      setError('Name is required.');
      return;
    }
    if (!cleanReason) {
      setError('Please provide a reason why you want approval.');
      return;
    }
    if (!cleanReferredBy) {
      setError('Please provide who referred you or how you found this website.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const savedRequest = await ApprovalService.submitApprovalRequest({
        uid: user.uid,
        email: user.email || '',
        name: cleanName,
        reason: cleanReason,
        referredBy: cleanReferredBy,
      });

      const isReapply = existingRequest?.status === 'rejected';
      toast.success(
        isReapply
          ? 'New access request submitted successfully!'
          : existingRequest
          ? 'Approval request updated successfully!'
          : 'Approval request submitted! The administrator will review your application.'
      );

      if (onSuccess) {
        onSuccess(savedRequest);
      }
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to submit approval request.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isReapply = existingRequest?.status === 'rejected';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-slate-900 dark:text-[#E6E6E6]">
          <ShieldCheck className="w-5 h-5 text-brand-600 dark:text-[#1DB954]" />
          <span>
            {isReapply
              ? 'Submit New Access Request'
              : existingRequest
              ? 'Update Approval Request'
              : 'Request Vault Access'}
          </span>
        </div>
      }
      description={
        isReapply
          ? 'Submit updated details to re-apply for access to the Bright Cloud Vault.'
          : existingRequest
          ? 'You have already submitted an approval request. You may edit your submission below.'
          : 'Submit your details to request authorization from the Vault Administrator.'
      }
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {error && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg text-rose-700 dark:text-rose-300 text-xs">
            {error}
          </div>
        )}

        {/* Name input */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-700 dark:text-[#E6E6E6]">
            Your Name <span className="text-rose-500">*</span>
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. John Doe"
            required
            className="text-xs"
          />
        </div>

        {/* Why do you want approval (textarea) */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-700 dark:text-[#E6E6E6]">
            Why do you want approval? <span className="text-rose-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why you are requesting access to this vault..."
            required
            rows={3}
            className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#111111] text-slate-900 dark:text-[#E6E6E6] focus:outline-hidden focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 dark:focus:border-[#1DB954] transition-all resize-none placeholder:text-slate-400 dark:placeholder:text-[#8A8A8A]"
          />
        </div>

        {/* How did you find this website / who told you about it */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold text-slate-700 dark:text-[#E6E6E6]">
              How did you find this website / who told you about it? <span className="text-rose-500">*</span>
            </label>
            <span className="text-[10px] text-slate-400 dark:text-[#8A8A8A]">
              {referredBy.length}/100
            </span>
          </div>
          <Input
            value={referredBy}
            onChange={(e) => setReferredBy(e.target.value.slice(0, 100))}
            placeholder="e.g. Name of the person who told you about this website"
            maxLength={100}
            required
            className="text-xs"
          />
        </div>

        {/* Account Info banner */}
        <div className="p-3 bg-slate-50 dark:bg-[#111111] border border-slate-200/80 dark:border-[#242424] rounded-lg text-xs text-slate-500 dark:text-[#8A8A8A] flex items-start gap-2.5">
          <Info className="w-4 h-4 text-brand-600 dark:text-[#1DB954] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div>
              Submitting as <span className="font-semibold text-slate-700 dark:text-[#E6E6E6]">{user?.email}</span>
            </div>
            <div className="text-[11px] text-slate-400 dark:text-[#8A8A8A]">
              The administrator will be notified with your name and justification.
            </div>
          </div>
        </div>

        {/* Form Actions */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#242424]">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" isLoading={isSubmitting}>
            {existingRequest ? 'Update Request' : 'Submit Request'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
