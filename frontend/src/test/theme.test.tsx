import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';

const TestConsumer: React.FC = () => {
  const { mode, setMode, isDark } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="isDark">{isDark ? 'dark' : 'light'}</span>
      <button onClick={() => setMode('light')}>Set Light</button>
      <button onClick={() => setMode('dark')}>Set Dark</button>
      <button onClick={() => setMode('system')}>Set System</button>
    </div>
  );
};

describe('ThemeContext & ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to dark mode and persists user preference', () => {
    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(screen.getByTestId('isDark').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // Switch to light
    act(() => {
      screen.getByText('Set Light').click();
    });

    expect(screen.getByTestId('mode').textContent).toBe('light');
    expect(screen.getByTestId('isDark').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('brightcloud-theme')).toBe('light');

    // Switch to dark
    act(() => {
      screen.getByText('Set Dark').click();
    });

    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(screen.getByTestId('isDark').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('brightcloud-theme')).toBe('dark');

    // Switch to system
    act(() => {
      screen.getByText('Set System').click();
    });

    expect(screen.getByTestId('mode').textContent).toBe('system');
    expect(localStorage.getItem('brightcloud-theme')).toBe('system');
  });

  it('restores stored theme from localStorage on initial render', () => {
    localStorage.setItem('brightcloud-theme', 'dark');

    render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(screen.getByTestId('isDark').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
