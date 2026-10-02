import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RequestApprovalModal } from '../features/auth/RequestApprovalModal';
import { ApprovalService } from '../services/firestore/approvalService';

// Mock Toast
vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('RequestApprovalModal Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockUser = {
    uid: 'test-user-uid',
    email: 'unauthorized@example.com',
    displayName: 'Test Applicant',
  };

  it('renders form fields with placeholder and limits referral input to 100 chars', () => {
    render(
      <RequestApprovalModal
        isOpen={true}
        onClose={vi.fn()}
        user={mockUser}
      />
    );

    expect(screen.getByText(/request vault access/i)).toBeDefined();

    // Name field
    const nameInput = screen.getByPlaceholderText(/e\.g\. John Doe/i) as HTMLInputElement;
    expect(nameInput).toBeDefined();
    expect(nameInput.value).toBe('Test Applicant');

    // Reason textarea
    const reasonInput = screen.getByPlaceholderText(/explain why you are requesting access/i) as HTMLTextAreaElement;
    expect(reasonInput).toBeDefined();

    // ReferredBy input with exact placeholder
    const referredByInput = screen.getByPlaceholderText(
      'e.g. Name of the person who told you about this website'
    ) as HTMLInputElement;
    expect(referredByInput).toBeDefined();
    expect(referredByInput.maxLength).toBe(100);
  });

  it('submits form data to ApprovalService and invokes onSuccess', async () => {
    const submitSpy = vi.spyOn(ApprovalService, 'submitApprovalRequest').mockResolvedValueOnce({
      uid: 'test-user-uid',
      email: 'unauthorized@example.com',
      name: 'Test Applicant',
      reason: 'Need access to backup files',
      referredBy: 'Jane Doe',
      status: 'pending',
      createdAt: new Date(),
    });

    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <RequestApprovalModal
        isOpen={true}
        onClose={onClose}
        user={mockUser}
        onSuccess={onSuccess}
      />
    );

    const reasonInput = screen.getByPlaceholderText(/explain why you are requesting access/i);
    const referredByInput = screen.getByPlaceholderText('e.g. Name of the person who told you about this website');

    fireEvent.change(reasonInput, { target: { value: 'Need access to backup files' } });
    fireEvent.change(referredByInput, { target: { value: 'Jane Doe' } });

    const submitBtn = screen.getByRole('button', { name: /submit request/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(submitSpy).toHaveBeenCalledWith({
        uid: 'test-user-uid',
        email: 'unauthorized@example.com',
        name: 'Test Applicant',
        reason: 'Need access to backup files',
        referredBy: 'Jane Doe',
      });
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('pre-populates existing request for resubmission', () => {
    const existing = {
      uid: 'test-user-uid',
      email: 'unauthorized@example.com',
      name: 'Existing Applicant',
      reason: 'Previously submitted reason',
      referredBy: 'Bob Smith',
      status: 'pending' as const,
      createdAt: new Date(),
    };

    render(
      <RequestApprovalModal
        isOpen={true}
        onClose={vi.fn()}
        user={mockUser}
        existingRequest={existing}
      />
    );

    expect(screen.getByText(/update approval request/i)).toBeDefined();
    expect((screen.getByPlaceholderText(/e\.g\. John Doe/i) as HTMLInputElement).value).toBe('Existing Applicant');
    expect((screen.getByPlaceholderText(/explain why you are requesting access/i) as HTMLTextAreaElement).value).toBe('Previously submitted reason');
    expect((screen.getByPlaceholderText('e.g. Name of the person who told you about this website') as HTMLInputElement).value).toBe('Bob Smith');
    expect(screen.getByRole('button', { name: /update request/i })).toBeDefined();
  });
});
