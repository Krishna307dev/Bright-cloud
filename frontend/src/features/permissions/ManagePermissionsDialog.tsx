import React, { useState, useEffect } from 'react';
import { Shield, Users, RefreshCw, Trash2 } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import type { FileRecord, FolderRule, VaultConfig } from '../../models';
import { VaultService } from '../../services/firestore/vaultService';
import { FileService } from '../../services/firestore/fileService';
import { PropagationEngine } from '../../services/firestore/propagationEngine';

interface ManagePermissionsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  vaultId: string;
  sourceId: string;
  relativePath: string;
  file?: FileRecord | null;
  onUpdated?: () => void;
}

export const ManagePermissionsDialog: React.FC<ManagePermissionsDialogProps> = ({
  isOpen,
  onClose,
  vaultId,
  sourceId,
  relativePath,
  file,
  onUpdated,
}) => {
  const toast = useToast();
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null);
  const [existingRule, setExistingRule] = useState<FolderRule | null>(null);
  const [isPublicToFriends, setIsPublicToFriends] = useState(false);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [forceResetOverrides, setForceResetOverrides] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [propagationProgress, setPropagationProgress] = useState<{
    processed: number;
    total: number;
  } | null>(null);

  const isFolder = !file;

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setIsLoading(true);
    setPropagationProgress(null);

    Promise.all([
      VaultService.getVaultConfig(vaultId),
      isFolder ? PropagationEngine.getFolderRule(vaultId, sourceId, relativePath) : Promise.resolve(null),
    ])
      .then(([config, rule]) => {
        if (!isMounted) return;
        setVaultConfig(config);

        if (file) {
          setIsPublicToFriends(file.isPublicToFriends ?? false);
          setSelectedFriends(file.allowedFriends ?? []);
        } else if (rule && !rule.isDeleted) {
          setExistingRule(rule);
          setIsPublicToFriends(rule.isPublicToFriends ?? false);
          setSelectedFriends(rule.allowedFriends ?? []);
        } else {
          setExistingRule(null);
          setIsPublicToFriends(false);
          setSelectedFriends([]);
        }
      })
      .catch((err) => {
        if (isMounted) toast.error(`Failed to load permissions: ${err.message}`);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, vaultId, sourceId, relativePath, file, isFolder, toast]);

  const toggleFriend = (uid: string) => {
    setSelectedFriends((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      if (file) {
        // Single file custom override
        await FileService.updateFilePermissions(
          vaultId,
          file.fileId,
          isPublicToFriends,
          selectedFriends
        );
        toast.success(`Updated permissions for ${file.originalName}`);
      } else {
        // Folder Rule Propagation
        await PropagationEngine.propagateFolderRule(
          vaultId,
          sourceId,
          relativePath,
          {
            isPublicToFriends,
            allowedFriends: selectedFriends,
          },
          {
            forceResetOverrides,
            onProgress: (processed: number, total: number) => {
              setPropagationProgress({ processed, total });
            },
          }
        );
        toast.success(`Successfully applied folder rule to ${relativePath || 'root'}`);
      }

      if (onUpdated) onUpdated();
      onClose();
    } catch (err: any) {
      console.error('[ManagePermissionsDialog] Error applying rule:', err);
      const msg = err?.message || 'Unknown error';
      if (msg.includes('requires an index')) {
        toast.error('Firestore index is provisioning. Please retry in a moment.');
      } else {
        toast.error(`Permission error: ${msg}`);
      }
    } finally {
      setIsSaving(false);
      setPropagationProgress(null);
    }
  };

  const handleDeleteRule = async () => {
    if (!existingRule) return;
    try {
      setIsSaving(true);
      await PropagationEngine.tombstoneFolderRule(
        vaultId,
        sourceId,
        relativePath,
        {
          onProgress: (processed: number, total: number) => {
            setPropagationProgress({ processed, total });
          },
        }
      );
      toast.success(`Removed rule for ${relativePath || 'root'}. Reconciled to ancestor policy.`);
      if (onUpdated) onUpdated();
      onClose();
    } catch (err: any) {
      toast.error(`Error deleting rule: ${err.message}`);
    } finally {
      setIsSaving(false);
      setPropagationProgress(null);
    }
  };

  const friendsList = vaultConfig?.authorizedFriends || [];
  const friendDirectory = vaultConfig?.friendDirectory || {};

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => !isSaving && onClose()}
      title={
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-brand-500" />
          <span>{isFolder ? 'Folder Access Rule' : 'File Access Override'}</span>
        </div>
      }
      description={
        isFolder
          ? `Configure friend access permissions for folder: /${relativePath || ''}`
          : `Set explicit custom permissions for: ${file.originalName}`
      }
      footer={
        <div className="flex items-center justify-between w-full">
          <div>
            {isFolder && existingRule && !existingRule.isDeleted && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteRule}
                disabled={isSaving}
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                Remove Rule
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              isLoading={isSaving}
            >
              {isFolder ? 'Apply Folder Rule' : 'Save File Override'}
            </Button>
          </div>
        </div>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center p-8 gap-2 text-slate-400 dark:text-[#8A8A8A]">
          <RefreshCw className="w-5 h-5 animate-spin text-brand-500 dark:text-[#1DB954]" />
          <span>Loading permissions...</span>
        </div>
      ) : (
        <div className="space-y-5 text-xs text-slate-700 dark:text-[#E6E6E6]">
          {/* Public Access Toggle */}
          <div className="p-3.5 bg-slate-50 dark:bg-[#111111] border border-slate-200/80 dark:border-[#242424] rounded-lg flex items-center justify-between">
            <div className="space-y-0.5 max-w-[280px]">
              <span className="font-semibold text-slate-800 dark:text-[#E6E6E6] text-xs block">
                Public to all Friends
              </span>
              <p className="text-[11px] text-slate-500 dark:text-[#8A8A8A] leading-normal">
                Any authorized friend in your vault will be granted read and download access.
              </p>
            </div>
            <input
              type="checkbox"
              id="isPublicToFriends"
              checked={isPublicToFriends}
              onChange={(e) => setIsPublicToFriends(e.target.checked)}
              className="w-4 h-4 text-brand-600 dark:accent-[#1DB954] rounded border-slate-300 dark:border-[#242424] dark:bg-[#181818] focus:ring-brand-500 cursor-pointer"
            />
          </div>

          {/* Collaborator Whitelist Checkboxes */}
          {!isPublicToFriends && (
            <div className="space-y-2">
              <label className="font-semibold text-slate-800 dark:text-[#E6E6E6] flex items-center gap-1.5">
                <Users className="w-4 h-4 text-slate-400 dark:text-[#8A8A8A]" />
                Select Specific Collaborators
              </label>

              {friendsList.length === 0 ? (
                <div className="p-4 bg-slate-50 dark:bg-[#111111] rounded-lg border border-dashed border-slate-200 dark:border-[#242424] text-center text-slate-400 dark:text-[#8A8A8A]">
                  No friends added to this vault yet. Add users in the Manage Users section.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-[#242424] border border-slate-200 dark:border-[#242424] rounded-lg bg-white dark:bg-[#0A0A0A]">
                  {friendsList.map((uid) => {
                    const info = friendDirectory[uid];
                    const displayName = info?.label || info?.email || 'Authorized Collaborator';
                    const secondaryText = info?.email && info?.label ? info.email : null;
                    const isSelected = selectedFriends.includes(uid);

                    return (
                      <label
                        key={uid}
                        className="flex items-center justify-between px-3.5 py-2.5 hover:bg-slate-50 dark:hover:bg-[#181818] cursor-pointer select-none"
                      >
                        <div className="min-w-0 pr-3">
                          <p className="font-medium text-slate-800 dark:text-[#E6E6E6] text-xs truncate">
                            {displayName}
                          </p>
                          {secondaryText && (
                            <p className="text-[11px] text-slate-400 dark:text-[#8A8A8A] truncate">
                              {secondaryText}
                            </p>
                          )}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleFriend(uid)}
                          className="w-4 h-4 text-brand-600 dark:accent-[#1DB954] rounded border-slate-300 dark:border-[#242424] dark:bg-[#181818] focus:ring-brand-500 cursor-pointer shrink-0"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Folder Propagation Options */}
          {isFolder && (
            <div className="p-3.5 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/40 rounded-lg space-y-2">
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="forceResetOverrides"
                  checked={forceResetOverrides}
                  onChange={(e) => setForceResetOverrides(e.target.checked)}
                  className="w-4 h-4 text-brand-600 dark:accent-[#1DB954] rounded border-slate-300 dark:border-[#242424] dark:bg-[#181818] focus:ring-brand-500 mt-0.5 cursor-pointer"
                />
                <label htmlFor="forceResetOverrides" className="cursor-pointer">
                  <span className="font-semibold text-slate-800 dark:text-[#E6E6E6] text-xs block">
                    Reset custom file permissions (enforce on all files)
                  </span>
                  <p className="text-[11px] text-slate-600 dark:text-[#8A8A8A] leading-normal mt-0.5">
                    When checked, removes per-file custom overrides on all descendant files, realigning every file to this folder rule.
                  </p>
                </label>
              </div>
            </div>
          )}

          {/* Active Propagation Progress */}
          {propagationProgress && (
            <div className="p-3 bg-brand-50 dark:bg-[#111111] border border-brand-200 dark:border-[#242424] rounded-lg space-y-1.5 animate-fadeIn">
              <div className="flex justify-between text-xs font-semibold text-brand-700 dark:text-[#1DB954]">
                <span>Propagating permissions...</span>
                <span>
                  {propagationProgress.processed} / {propagationProgress.total} files
                </span>
              </div>
              <div className="w-full h-2 bg-brand-100 dark:bg-[#181818] rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-500 dark:bg-[#1DB954] transition-all duration-300"
                  style={{
                    width: `${
                      propagationProgress.total > 0
                        ? (propagationProgress.processed / propagationProgress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
};
