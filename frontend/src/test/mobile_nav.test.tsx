import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileNav } from '../components/layout/MobileNav';

// Mock useAuth
vi.mock('../features/auth/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'admin@brightcloud.vault', uid: 'admin-123' },
    role: 'admin',
    isAdmin: true,
  }),
}));

describe('MobileNav component', () => {
  it('renders base tabs and opens more menu with admin options', () => {
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
});
