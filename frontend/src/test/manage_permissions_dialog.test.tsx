import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
});
