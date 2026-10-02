import React, { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

interface CreateFolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPath: string;
  onConfirmCreate: (folderName: string) => Promise<void>;
}

export const CreateFolderModal: React.FC<CreateFolderModalProps> = ({
  isOpen,
  onClose,
  currentPath,
  onConfirmCreate,
}) => {
  const [folderName, setFolderName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanName = folderName.trim();
  const isValid = cleanName.length > 0 && !/[/\\?#*]/.test(cleanName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || isSubmitting) return;

    try {
      setIsSubmitting(true);
      setError(null);
      await onConfirmCreate(cleanName);
      setFolderName('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create folder');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setFolderName('');
    setError(null);
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Folder"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="text-xs text-slate-600 dark:text-[#8A8A8A]">
          Folder will be created in{' '}
          <span className="font-semibold text-slate-800 dark:text-[#E6E6E6] font-mono">
            /{currentPath || ''}
          </span>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-700 dark:text-[#E6E6E6] block">
            Folder Name:
          </label>
          <Input
            value={folderName}
            onChange={(e) => {
              setFolderName(e.target.value);
              setError(null);
            }}
            placeholder="e.g. Invoices, Projects, Documents"
            disabled={isSubmitting}
            autoFocus
          />
          {error && (
            <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{error}</p>
          )}
          {folderName && !isValid && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              Folder name cannot contain slashes (/ or \) or special characters (?, #, *).
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#242424]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!isValid || isSubmitting}
            isLoading={isSubmitting}
            className="gap-1.5"
          >
            <FolderPlus className="w-4 h-4" />
            Create Folder
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
