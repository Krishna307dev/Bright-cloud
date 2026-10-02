import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WebUploadDialog } from '../components/WebUploadDialog';
import { UploadService, type UploadResult } from '../services/uploadService';

// Mock UploadService
vi.mock('../services/uploadService', () => ({
  UploadService: {
    uploadFile: vi.fn(),
  },
}));

describe('Multi-File Upload Dialog & Batch Queue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders input with multiple attribute and supports selecting multiple files', async () => {
    render(
      <WebUploadDialog
        isOpen={true}
        onClose={vi.fn()}
        vaultId="test-vault"
        targetRelativePath="documents/"
      />
    );

    // Verify input element has multiple attribute
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.multiple).toBe(true);

    // Select 3 files at once
    const file1 = new File(['content-1'], 'report.pdf', { type: 'application/pdf' });
    const file2 = new File(['content-2'], 'image.png', { type: 'image/png' });
    const file3 = new File(['content-3'], 'notes.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [file1, file2, file3] } });

    // Verify all 3 files are rendered in the queue
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('image.png')).toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();

    // Verify batch upload button reflects 3 files
    expect(screen.getByText(/Upload 3 Files/i)).toBeInTheDocument();
  });

  it('allows removing an individual file or clearing all files before starting upload', async () => {
    render(
      <WebUploadDialog
        isOpen={true}
        onClose={vi.fn()}
        vaultId="test-vault"
        targetRelativePath="photos/"
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file1 = new File(['content-1'], 'photo1.jpg', { type: 'image/jpeg' });
    const file2 = new File(['content-2'], 'photo2.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [file1, file2] } });

    expect(screen.getByText('photo1.jpg')).toBeInTheDocument();
    expect(screen.getByText('photo2.jpg')).toBeInTheDocument();

    // Remove photo1.jpg using its remove button
    const removeButtons = screen.getAllByTitle('Remove file');
    expect(removeButtons.length).toBe(2);
    fireEvent.click(removeButtons[0]);

    // photo1.jpg should be removed, photo2.jpg remains
    expect(screen.queryByText('photo1.jpg')).toBeNull();
    expect(screen.getByText('photo2.jpg')).toBeInTheDocument();
    expect(screen.getByText(/Upload 1 File/i)).toBeInTheDocument();

    // Click Clear All
    const clearButton = screen.getByText('Clear All');
    fireEvent.click(clearButton);

    expect(screen.queryByText('photo2.jpg')).toBeNull();
  });

  it('processes multiple files sequentially and displays both uploaded and deduplicated stats', async () => {
    const onUploadComplete = vi.fn();

    // File 1 will succeed as newly uploaded file
    // File 2 will be detected as a duplicate (deduplication)
    const mockUpload = vi.spyOn(UploadService, 'uploadFile').mockImplementation(
      async (_vaultId, _path, file, callbacks) => {
        callbacks?.onStage?.('HASHING');
        callbacks?.onProgress?.(50);
        callbacks?.onStage?.('UPLOADING');
        callbacks?.onProgress?.(100);
        callbacks?.onStage?.('FINALIZING');

        if (file.name === 'new_doc.pdf') {
          return {
            status: 'SUCCESS',
            fileId: 'file-123',
            storedName: 'new_doc.pdf',
            version: 0,
            sha256: 'hash-111',
          } as UploadResult;
        } else {
          return {
            status: 'DUPLICATE_SKIPPED',
            fileId: 'file-456',
            storedName: 'existing_doc.pdf',
            version: 0,
            sha256: 'hash-222',
          } as UploadResult;
        }
      }
    );

    render(
      <WebUploadDialog
        isOpen={true}
        onClose={vi.fn()}
        vaultId="test-vault"
        targetRelativePath="archive/"
        onUploadComplete={onUploadComplete}
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file1 = new File(['data1'], 'new_doc.pdf', { type: 'application/pdf' });
    const file2 = new File(['data2'], 'existing_doc.pdf', { type: 'application/pdf' });

    fireEvent.change(fileInput, { target: { files: [file1, file2] } });

    const uploadButton = screen.getByText(/Upload 2 Files/i);
    fireEvent.click(uploadButton);

    await waitFor(() => {
      expect(screen.getByText('Upload Batch Complete')).toBeInTheDocument();
    });

    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Uploaded: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Skipped \(Dedup\): 1/i)).toBeInTheDocument();
    expect(onUploadComplete).toHaveBeenCalled();
  });

  it('continues uploading subsequent files if one file fails', async () => {
    const mockUpload = vi.spyOn(UploadService, 'uploadFile').mockImplementation(
      async (_vaultId, _path, file) => {
        if (file.name === 'corrupted.bin') {
          throw new Error('Simulated B2 connection drop');
        }
        return {
          status: 'SUCCESS',
          fileId: 'file-ok',
          storedName: file.name,
          version: 0,
          sha256: 'hash-ok',
        } as UploadResult;
      }
    );

    render(
      <WebUploadDialog
        isOpen={true}
        onClose={vi.fn()}
        vaultId="test-vault"
        targetRelativePath="files/"
      />
    );

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const failFile = new File(['bad'], 'corrupted.bin');
    const goodFile = new File(['good'], 'success.txt');

    fireEvent.change(fileInput, { target: { files: [failFile, goodFile] } });

    const uploadButton = screen.getByText(/Upload 2 Files/i);
    fireEvent.click(uploadButton);

    await waitFor(() => {
      expect(screen.getByText('Upload Batch Complete')).toBeInTheDocument();
    });

    expect(mockUpload).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Uploaded: 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed: 1/i)).toBeInTheDocument();
    expect(screen.getByText('Simulated B2 connection drop')).toBeInTheDocument();
  });
});
