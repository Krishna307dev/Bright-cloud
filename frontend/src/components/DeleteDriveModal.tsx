import React, { useState } from 'react';
import { AlertTriangle, Clock, ShieldCheck } from 'lucide-react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import type { SourceEntity } from '../models';

interface DeleteDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  source: SourceEntity | null;
  onConfirmSchedule: (source: SourceEntity) => Promise<void>;
}

export const DeleteDriveModal: React.FC<DeleteDriveModalProps> = ({
  isOpen,
  onClose,
  source,
  onConfirmSchedule,
}) => {
  const [confirmationInput, setConfirmationInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!source) return null;

  const expectedPhrase = `DELETE ${source.displayName}`;
  const isMatch = confirmationInput.trim() === expectedPhrase;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMatch || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onConfirmSchedule(source);
      setConfirmationInput('');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setConfirmationInput('');
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Delete USB Drive (24-Hour Scheduled Removal)"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Warning Banner */}
        <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/80 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3 leading-relaxed">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <span className="font-bold text-amber-950 dark:text-amber-100 block">
              24-Hour Safety Window (100% Undoable)
            </span>
            <p className="text-amber-800 dark:text-amber-300">
              To protect against accidental data loss, deleting this drive is scheduled with a{' '}
              <strong>24-hour grace period</strong>.
            </p>
            <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300 font-medium pt-0.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>All files remain fully intact and you can cancel anytime.</span>
            </div>
          </div>
        </div>

        {/* Drive Info */}
        <div className="p-3 bg-slate-50 dark:bg-[#111111] border border-slate-200 dark:border-[#242424] rounded-lg text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-[#8A8A8A]">Target Drive:</span>
            <span className="font-semibold text-slate-800 dark:text-[#E6E6E6]">{source.displayName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-[#8A8A8A]">Source ID:</span>
            <span className="font-mono text-slate-600 dark:text-[#8A8A8A]">{source.sourceId}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 dark:text-[#8A8A8A]">Total Files:</span>
            <span className="font-semibold text-slate-800 dark:text-[#E6E6E6]">
              {source.totalFilesBackedUp.toLocaleString()} files
            </span>
          </div>
        </div>

        {/* Step 2 Confirmation Input */}
        <div className="space-y-2 pt-1">
          <label className="text-xs font-semibold text-slate-700 dark:text-[#E6E6E6] block">
            Type <span className="font-mono text-rose-600 dark:text-rose-400 select-all font-bold">{expectedPhrase}</span> to confirm:
          </label>
          <Input
            value={confirmationInput}
            onChange={(e) => setConfirmationInput(e.target.value)}
            placeholder={expectedPhrase}
            className="text-xs font-mono"
            autoFocus
          />
        </div>

        {/* Dialog Actions */}
        <div className="pt-3 border-t border-slate-100 dark:border-[#242424] flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            type="submit"
            disabled={!isMatch || isSubmitting}
            isLoading={isSubmitting}
            className="gap-1.5"
          >
            <Clock className="w-4 h-4" />
            Schedule Deletion (24h Window)
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
