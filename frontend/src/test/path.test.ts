import { describe, it, expect } from 'vitest';
import {
  canonicalizePath,
  getParentPath,
  isDescendantOf,
  generateRuleId,
} from '../utils/path';

describe('Path Utilities & Strict Directory-Boundary Matching', () => {
  it('canonicalizePath ensures directory paths end with /', () => {
    expect(canonicalizePath('Documents/Pro')).toBe('Documents/Pro/');
    expect(canonicalizePath('/Documents/Pro/')).toBe('Documents/Pro/');
    expect(canonicalizePath('')).toBe('');
    expect(canonicalizePath('/')).toBe('');
    expect(canonicalizePath('a//b///c')).toBe('a/b/c/');
  });

  it('isDescendantOf strictly respects directory boundaries', () => {
    const parentRule = 'Documents/Pro/';

    // True descendants:
    expect(isDescendantOf('Documents/Pro/Notes/', parentRule)).toBe(true);
    expect(isDescendantOf('Documents/Pro/Deep/Nested/Folder/', parentRule)).toBe(true);

    // False positives (Collisions that MUST NOT match):
    expect(isDescendantOf('Documents/Projects/', parentRule)).toBe(false);
    expect(isDescendantOf('Documents/ProgramFiles/', parentRule)).toBe(false);
    expect(isDescendantOf('Documents/Profile/', parentRule)).toBe(false);
    expect(isDescendantOf('Other/Pro/', parentRule)).toBe(false);
  });

  it('getParentPath correctly finds ancestor directories', () => {
    expect(getParentPath('Documents/Pro/Notes/')).toBe('Documents/Pro/');
    expect(getParentPath('Documents/Pro/')).toBe('Documents/');
    expect(getParentPath('Documents/')).toBe('');
    expect(getParentPath('')).toBeNull();
  });

  it('generateRuleId creates deterministic encoded rule IDs', () => {
    const id1 = generateRuleId('source-123', 'Documents/Pro/');
    const id2 = generateRuleId('source-123', 'Documents/Pro');
    expect(id1).toBe(id2);
    expect(id1).toContain('source-123');
    expect(id1).not.toContain('/');
  });
});
