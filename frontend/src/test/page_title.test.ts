import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePageTitle } from '../hooks/usePageTitle';

describe('usePageTitle hook', () => {
  beforeEach(() => {
    document.title = 'Bright Cloud';
  });

  it('sets document title with subtitle prefix', () => {
    const { unmount } = renderHook(() => usePageTitle('Files'));
    expect(document.title).toBe('Files · Bright Cloud');

    unmount();
    expect(document.title).toBe('Bright Cloud');
  });

  it('defaults to Bright Cloud when no subtitle is passed', () => {
    renderHook(() => usePageTitle());
    expect(document.title).toBe('Bright Cloud');
  });
});
