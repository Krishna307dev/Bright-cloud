import { useState, useCallback } from 'react';
import { B2AuthorizerClient } from '../services/b2Authorizer';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../features/auth/AuthContext';
import { ActivityService } from '../services/firestore/activityService';

export function useDownload() {
  const { user } = useAuth();
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<{ isOpen: boolean; title: string; message: string } | null>(null);
  const toast = useToast();

  const closeErrorModal = useCallback(() => {
    setErrorModal(null);
  }, []);

  const downloadFile = useCallback(
    async (vaultId: string, fileId: string, storedName: string, sourceId?: string, relativePath?: string) => {
      try {
        setDownloadingFileId(fileId);
        setError(null);
        toast.info(`Preparing secure download for ${storedName}...`);

        // Fire-and-forget user activity log for download
        if (user?.uid) {
          ActivityService.logAccess({
            userId: user.uid,
            userDisplayName: user.displayName,
            email: user.email,
            vaultId,
            sourceId: sourceId || '',
            fileId,
            fileName: storedName,
            relativePath: relativePath || '',
            action: 'download',
          }).catch(() => {});
        }

        await B2AuthorizerClient.triggerDownload(vaultId, fileId, storedName);

        toast.success(`Download started for ${storedName}`);
      } catch (err: unknown) {
        const errorMsg =
          err instanceof Error
            ? err.message
            : 'Download failed. Please check network connection or permissions.';
        setError(errorMsg);
        toast.error(`Download error: ${errorMsg}`);

        if (errorMsg.includes('File not available in cloud storage')) {
          setErrorModal({
            isOpen: true,
            title: 'File Unavailable in Storage',
            message: `The file '${storedName}' is not available in Backblaze B2 cloud storage. System cache files (.database_uuid, .thumbnails) or skipped files do not have stored content blocks.`,
          });
        } else {
          setErrorModal({
            isOpen: true,
            title: 'Download Failed',
            message: errorMsg,
          });
        }
      } finally {
        setDownloadingFileId(null);
      }
    },
    [toast]
  );

  return {
    downloadFile,
    isDownloading: (fileId: string) => downloadingFileId === fileId,
    downloadingFileId,
    error,
    errorModal,
    closeErrorModal,
  };
}
