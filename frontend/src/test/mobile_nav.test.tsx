import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileNav } from '../components/layout/MobileNav';

// Mock useAuth dynamically
let mockAuthValue = {
  user: { email: 'admin@brightcloud.vault', uid: 'admin-123' },
  role: 'admin',
  isAdmin: true,
};

vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

describe('MobileNav component', () => {
  it('renders base tabs and opens more menu with admin options when admin', () => {
    mockAuthValue = {
      user: { email: 'admin@brightcloud.vault', uid: 'admin-123' },
      role: 'admin',
      isAdmin: true,
    };

    render(
      <MemoryRouter initialEntries={['/']}>
        <MobileNav />
      </MemoryRouter>
    );

    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Explorer')).toBeDefined();
    expect(screen.getByText('Shared')).toBeDefined();
    expect(screen.getByText('Activity')).toBeDefined();
    expect(screen.getByText('More')).toBeDefined();

    // Click "More" button
    fireEvent.click(screen.getByText('More'));

    // Verify more menu opens
    expect(screen.getByText('USB Sources')).toBeDefined();
    expect(screen.getByText('Preferences')).toBeDefined();
    expect(screen.getByText('Manage Users')).toBeDefined();
    expect(screen.getByText('Vault Security')).toBeDefined();
  });

  it('hides Activity and admin links for normal/non-admin users', () => {
    mockAuthValue = {
      user: { email: 'friend@gmail.com', uid: 'friend-456' },
      role: 'friend',
      isAdmin: false,
    };

    render(
      <MemoryRouter initialEntries={['/']}>
        <MobileNav />
      </MemoryRouter>
    );

    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Explorer')).toBeDefined();
    expect(screen.getByText('Shared')).toBeDefined();
    expect(screen.getByText('USB Sources')).toBeDefined();
    expect(screen.getByText('More')).toBeDefined();

    // Verify Activity is NOT rendered anywhere
    expect(screen.queryByText('Activity')).toBeNull();

    // Click "More" button
    fireEvent.click(screen.getByText('More'));

    // Preferences should be present
    expect(screen.getByText('Preferences')).toBeDefined();

    // Admin links must NOT be present
    expect(screen.queryByText('Manage Users')).toBeNull();
    expect(screen.queryByText('Vault Security')).toBeNull();
  });
});
