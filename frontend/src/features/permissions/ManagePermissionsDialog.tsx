import React, { useState, useEffect } from 'react';
import { Shield, Users, RefreshCw, Trash2, Mail } from 'lucide-react';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useAuth } from '../auth/AuthContext';
import type { FileRecord, FolderRule, VaultConfig, UserProfile, ApprovalRequest } from '../../models';
import { VaultService } from '../../services/firestore/vaultService';
import { ApprovalService } from '../../services/firestore/approvalService';
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
  const { user } = useAuth();
  const toast = useToast();
  const [vaultConfig, setVaultConfig] = useState<VaultConfig | null>(null);
  const [usersMap, setUsersMap] = useState<Map<string, UserProfile>>(new Map());
  const [requestsMap, setRequestsMap] = useState<Map<string, ApprovalRequest>>(new Map());
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
      VaultService.listUsers(vaultId).catch(() => [] as UserProfile[]),
      ApprovalService.listApprovalRequests().catch(() => new Map<string, ApprovalRequest>()),
    ])
      .then(([config, rule, userList, reqMap]) => {
        if (!isMounted) return;
        setVaultConfig(config);
        const uMap = new Map<string, UserProfile>();
        userList.forEach((u) => uMap.set(u.uid, u));
        setUsersMap(uMap);
        setRequestsMap(reqMap);

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

  const friendDirectory = vaultConfig?.friendDirectory || {};
  const userDirectory = (vaultConfig as any)?.userDirectory || {};

  // Gather all eligible collaborator UIDs:
  // 1. UIDs in vaultConfig.authorizedFriends
  // 2. Currently selected friends (if any)
  // 3. Registered friends in friendDirectory / userDirectory
  // 4. Registered users with role 'friend' in usersMap
  const rawFriendUids = Array.from(
    new Set([
      ...(vaultConfig?.authorizedFriends || []),
      ...selectedFriends,
      ...Object.keys(friendDirectory),
      ...Object.entries(userDirectory)
        .filter(([, u]: any) => u.role === 'friend')
        .map(([uUid]) => uUid),
      ...Array.from(usersMap.values())
        .filter((u) => u.role === 'friend')
        .map((u) => u.uid),
    ])
  ).filter((uid) => !vaultConfig?.adminUids?.includes(uid) && uid !== user?.uid);

  const getCollaboratorInfo = (uid: string) => {
    const uProfile = usersMap.get(uid);
    const req = requestsMap.get(uid);
    const dir = friendDirectory[uid];
    const uDir = userDirectory[uid];

    const isPlaceholder = (n?: string | null) =>
      !n || ['User', 'Authorized Friend', 'Authorized Collaborator', 'Google User'].includes(n.trim());

    // Priority 1: Find a real non-placeholder name
    const rawName =
      (!isPlaceholder(uProfile?.displayName) ? uProfile!.displayName : '') ||
      (!isPlaceholder(req?.name) ? req!.name : '') ||
      (!isPlaceholder(uDir?.displayName) ? uDir!.displayName : '') ||
      (!isPlaceholder(dir?.label) ? dir!.label : '') ||
      '';

    // Priority 2: Find a real non-placeholder email
    const rawEmail =
      (uProfile?.email && !uProfile.email.endsWith('@vault.local') ? uProfile.email : '') ||
      (req?.email && !req.email.endsWith('@vault.local') ? req.email : '') ||
      (uDir?.email && !uDir.email.endsWith('@vault.local') ? uDir.email : '') ||
      (dir?.email && !dir.email.endsWith('@vault.local') ? dir.email : '') ||
      '';

    let displayName = rawName;
    if (!displayName || isPlaceholder(displayName)) {
      if (rawEmail) {
        displayName = rawEmail.split('@')[0];
      } else {
        displayName = `Collaborator (${uid.slice(0, 8)})`;
      }
    }

    return {
      uid,
      displayName,
      email: rawEmail,
      photoURL: uProfile?.photoURL || uDir?.photoURL,
      role: uProfile?.role || uDir?.role,
    };
  };

  const collaborators = rawFriendUids
    .map((uid) => getCollaboratorInfo(uid))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

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
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-800 dark:text-[#E6E6E6] flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-slate-400 dark:text-[#8A8A8A]" />
                  Select Specific Collaborators
                </label>
                {collaborators.length > 0 && (
                  <span className="text-[11px] text-slate-500 dark:text-[#8A8A8A]">
                    {selectedFriends.length} of {collaborators.length} selected
                  </span>
                )}
              </div>

              {collaborators.length === 0 ? (
                <div className="p-4 bg-slate-50 dark:bg-[#111111] rounded-lg border border-dashed border-slate-200 dark:border-[#242424] text-center text-slate-400 dark:text-[#8A8A8A]">
                  No friends added to this vault yet. Add users in the Manage Users section.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-[#242424] border border-slate-200 dark:border-[#242424] rounded-lg bg-white dark:bg-[#0A0A0A]">
                  {collaborators.map((c) => {
                    const isSelected = selectedFriends.includes(c.uid);
                    const isCurrentUser = user?.uid === c.uid;

                    return (
                      <label
                        key={c.uid}
                        className={`flex items-center justify-between px-3.5 py-2.5 transition-colors cursor-pointer select-none ${
                          isSelected
                            ? 'bg-brand-50/50 dark:bg-[#1DB954]/10'
                            : 'hover:bg-slate-50 dark:hover:bg-[#181818]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-3">
                          {c.photoURL ? (
                            <img
                              src={c.photoURL}
                              alt={c.displayName}
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                              className="w-8 h-8 rounded-full object-cover border border-slate-200 dark:border-[#242424] shrink-0"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-brand-50 dark:bg-[#181818] border border-brand-200/60 dark:border-[#242424] text-brand-600 dark:text-[#1DB954] flex items-center justify-center font-bold text-xs shrink-0">
                              {c.displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="font-medium text-slate-900 dark:text-[#E6E6E6] text-xs truncate">
                                {c.displayName}
                              </span>
                              {isCurrentUser && (
                                <span className="text-[10px] bg-slate-100 dark:bg-[#242424] text-slate-600 dark:text-[#E6E6E6] font-semibold px-1.5 py-0.5 rounded-full shrink-0">
                                  You
                                </span>
                              )}
                              {c.role === 'admin' && (
                                <span className="text-[10px] text-brand-600 dark:text-[#1DB954] font-medium shrink-0">
                                  • Admin
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-[#8A8A8A] flex items-center gap-1 mt-0.5 truncate">
                              {c.email ? (
                                <>
                                  <Mail className="w-3 h-3 shrink-0 text-slate-400 dark:text-[#8A8A8A]" />
                                  <span className="truncate">{c.email}</span>
                                </>
                              ) : (
                                <span className="font-mono text-[10px] truncate text-slate-400 dark:text-[#8A8A8A]">
                                  UID: {c.uid.slice(0, 12)}...
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleFriend(c.uid)}
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
