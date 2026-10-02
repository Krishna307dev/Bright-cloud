import { describe, it, expect, beforeEach } from 'vitest';
import { PRESET_AVATARS, getStoredAvatar, setStoredAvatar, clearStoredAvatar } from '../utils/avatars';

describe('Avatar Customization & Storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('provides 10 preset avatars with valid data URLs', () => {
    expect(PRESET_AVATARS).toHaveLength(10);
    for (const preset of PRESET_AVATARS) {
      expect(preset.id).toBeTruthy();
      expect(preset.label).toBeTruthy();
      expect(preset.dataUrl).toContain('data:image/svg+xml');
    }
  });

  it('correctly persists and retrieves avatar in localStorage', () => {
    expect(getStoredAvatar()).toBeNull();

    const selected = PRESET_AVATARS[0].dataUrl;
    setStoredAvatar(selected);

    expect(getStoredAvatar()).toBe(selected);

    clearStoredAvatar();
    expect(getStoredAvatar()).toBeNull();
  });
});
