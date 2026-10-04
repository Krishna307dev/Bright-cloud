import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ManagePermissionsDialog } from '../features/permissions/ManagePermissionsDialog';
import { VaultService } from '../services/firestore/vaultService';
import { ApprovalService } from '../services/firestore/approvalService';
import type { VaultConfig, UserProfile, ApprovalRequest } from '../models';

vi.mock('../services/firebase', () => ({
  db: {},
  auth: {
    currentUser: {
      uid: 'admin-1',
      email: 'admin@vault.local',
      displayName: 'Admin User',
    },
  },
  VAULT_ID: 'default',
}));

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      uid: 'admin-1',
      email: 'admin@vault.local',
      displayName: 'Admin User',
    },
    vaultId: 'default',
    isAdmin: true,
  }),
}));

vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { PropagationEngine } from '../services/firestore/propagationEngine';

describe('ManagePermissionsDialog - Collaborator Names & Avatars', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders actual user names, emails, and avatars instead of generic "Authorized Collaborator"', async () => {
    const mockVaultConfig: VaultConfig = {
      vaultId: 'default',
      adminUids: ['admin-1'],
      authorizedFriends: ['user-friend-1', 'user-friend-2'],
      friendDirectory: {
        'user-friend-1': {
          label: '', // empty label to test fallback to userProfile/approvalRequest
          email: '',
          addedAt: '2026-10-01T00:00:00Z',
        },
      },
      vaultName: 'Test Vault',
    };

    const mockUsers: UserProfile[] = [
      {
        uid: 'user-friend-1',
        email: 'rohan.gupta@example.com',
        displayName: 'Rohan Gupta',
        photoURL: 'https://lh3.googleusercontent.com/a/rohan-avatar',
        lastLogin: new Date(),
        role: 'friend',
      },
      {
        uid: 'user-friend-2',
        email: 'priya.patel@example.com',
        displayName: 'Priya Patel',
        lastLogin: new Date(),
        role: 'friend',
      },
    ];

    const mockApprovals = new Map<string, ApprovalRequest>();

    vi.spyOn(VaultService, 'getVaultConfig').mockResolvedValue(mockVaultConfig);
    vi.spyOn(VaultService, 'listUsers').mockResolvedValue(mockUsers);
    vi.spyOn(ApprovalService, 'listApprovalRequests').mockResolvedValue(mockApprovals);
    vi.spyOn(PropagationEngine, 'getFolderRule').mockResolvedValue(null);

    render(
      <ManagePermissionsDialog
        isOpen={true}
        onClose={vi.fn()}
        vaultId="default"
        sourceId="usb-1"
        relativePath="Documents/TestFolder"
      />
    );

    // Wait for permissions and collaborators to load
    await waitFor(() => {
      expect(screen.queryByText(/loading permissions/i)).not.toBeInTheDocument();
    });

    // Verify "Authorized Collaborator" is NOT rendered
    expect(screen.queryByText('Authorized Collaborator')).not.toBeInTheDocument();

    // Verify real user names are displayed
    expect(screen.getByText('Rohan Gupta')).toBeInTheDocument();
    expect(screen.getByText('Priya Patel')).toBeInTheDocument();

    // Verify real user emails are displayed
    expect(screen.getByText('rohan.gupta@example.com')).toBeInTheDocument();
    expect(screen.getByText('priya.patel@example.com')).toBeInTheDocument();

    // Verify avatar image is rendered for user with photoURL
    const avatarImg = screen.getByAltText('Rohan Gupta');
    expect(avatarImg).toBeInTheDocument();
    expect(avatarImg).toHaveAttribute('src', 'https://lh3.googleusercontent.com/a/rohan-avatar');

    // Verify initial circle is rendered for user without photoURL
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('renders all users and search bar even when isPublicToFriends is true, and filters in real-time', async () => {
    const mockVaultConfig: VaultConfig = {
      vaultId: 'default',
      adminUids: ['admin-1'],
      authorizedFriends: ['user-friend-1'],
      vaultName: 'Test Vault',
    };

    const mockUsers: UserProfile[] = [
      {
        uid: 'user-friend-1',
        email: 'akshay167091@gmail.com',
        displayName: 'AKSHAY AGARWAL',
        lastLogin: new Date(),
        role: 'friend',
      },
      {
        uid: 'user-friend-2',
        email: 'satyendrameghwal81@gmail.com',
        displayName: 'Satyendra Meghwal',
        lastLogin: new Date(),
        role: 'friend',
      },
      {
        uid: 'user-pending-1',
        email: 'gauravthkaur01@gmail.com',
        displayName: 'Gaurav',
        lastLogin: new Date(),
        role: 'pending',
      },
    ];

    vi.spyOn(VaultService, 'getVaultConfig').mockResolvedValue(mockVaultConfig);
    vi.spyOn(VaultService, 'listUsers').mockResolvedValue(mockUsers);
    vi.spyOn(ApprovalService, 'listApprovalRequests').mockResolvedValue(new Map());
    vi.spyOn(PropagationEngine, 'getFolderRule').mockResolvedValue(null);

    const mockFile: any = {
      fileId: 'file-101',
      sourceId: 'usb-1',
      relativePath: 'Docs/',
      originalName: 'Class 10th Assertion Reason.pdf',
      isPublicToFriends: true,
      allowedFriends: [],
    };

    render(
      <ManagePermissionsDialog
        isOpen={true}
        onClose={vi.fn()}
        vaultId="default"
        sourceId="usb-1"
        relativePath="Docs/"
        file={mockFile}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText(/loading permissions/i)).not.toBeInTheDocument();
    });

    // Public toggle is checked
    const publicCheckbox = screen.getByRole('checkbox', { name: /public to all friends/i });
    expect(publicCheckbox).toBeChecked();

    // Explanatory banner is present
    expect(screen.getByText(/public policy active/i)).toBeInTheDocument();

    // User list is STILL visible
    expect(screen.getByText('AKSHAY AGARWAL')).toBeInTheDocument();
    expect(screen.getByText('Satyendra Meghwal')).toBeInTheDocument();
    expect(screen.getByText('Gaurav')).toBeInTheDocument();

    // Search bar is present and functional
    const searchInput = screen.getByPlaceholderText(/search users by name or email/i);
    expect(searchInput).toBeInTheDocument();

    // Filter by "Satyendra"
    fireEvent.change(searchInput, { target: { value: 'Satyendra' } });

    expect(screen.getByText('Satyendra Meghwal')).toBeInTheDocument();
    expect(screen.queryByText('AKSHAY AGARWAL')).not.toBeInTheDocument();
    expect(screen.queryByText('Gaurav')).not.toBeInTheDocument();
  });
});
