import { describe, it, expect } from 'vitest';
import {
  resolveUserSettings,
  DEFAULT_WEB_CONFIG,
  WebCustomizationConfig,
  UserCustomSettings,
} from '../models/webCustomization';

describe('Web Customization - resolveUserSettings', () => {
  it('returns default config when both global and user settings are null', () => {
    const res = resolveUserSettings(null, null, false);
    expect(res.siteName).toBe(DEFAULT_WEB_CONFIG.siteName);
    expect(res.accentColor).toBe(DEFAULT_WEB_CONFIG.accentColor);
    expect(res.theme).toBe(DEFAULT_WEB_CONFIG.defaultTheme);
    expect(res.banner.enabled).toBe(false);
    expect(res.visibleTabs).toEqual(DEFAULT_WEB_CONFIG.visibleTabs);
    expect(res.canUpload).toBe(DEFAULT_WEB_CONFIG.uploadRules.allowWebUploads);
    expect(res.canDownload).toBe(DEFAULT_WEB_CONFIG.downloadRules.allowDownloads);
    expect(res.canShare).toBe(DEFAULT_WEB_CONFIG.downloadRules.allowShareLinks);
    expect(res.maintenanceMode).toBe(false);
    expect(res.isSuspended).toBe(false);
  });

  describe('Admin Bypass Rules', () => {
    it('always enables all tabs, uploads, downloads, and shares for admins', () => {
      const globalConfig: Partial<WebCustomizationConfig> = {
        visibleTabs: {
          explorer: false,
          shared: false,
          sources: false,
          activity: false,
          preferences: false,
        },
        uploadRules: {
          allowWebUploads: false,
          maxFileSizeMb: 10,
          allowedFileTypes: [],
        },
        downloadRules: {
          allowDownloads: false,
          allowShareLinks: false,
        },
        maintenanceMode: true,
      };

      const userOverrides: UserCustomSettings = {
        suspended: true,
        canUpload: false,
        canDownload: false,
        canShare: false,
        visibleTabs: { explorer: false },
      };

      const adminRes = resolveUserSettings(globalConfig, userOverrides, true);

      expect(adminRes.maintenanceMode).toBe(false);
      expect(adminRes.isSuspended).toBe(false);
      expect(adminRes.canUpload).toBe(true);
      expect(adminRes.canDownload).toBe(true);
      expect(adminRes.canShare).toBe(true);
      expect(adminRes.visibleTabs.explorer).toBe(true);
      expect(adminRes.visibleTabs.shared).toBe(true);
      expect(adminRes.visibleTabs.sources).toBe(true);
      expect(adminRes.visibleTabs.activity).toBe(true);
      expect(adminRes.visibleTabs.preferences).toBe(true);
      expect(adminRes.allowedDrives).toBeUndefined();
    });
  });

  describe('Normal User Restrictions & Inheritance', () => {
    it('respects maintenance mode and suspension for normal users', () => {
      const globalConfig: Partial<WebCustomizationConfig> = {
        maintenanceMode: true,
      };

      const res = resolveUserSettings(globalConfig, null, false);
      expect(res.maintenanceMode).toBe(true);
      expect(res.isSuspended).toBe(false);

      const suspendedRes = resolveUserSettings(globalConfig, { suspended: true }, false);
      expect(suspendedRes.isSuspended).toBe(true);
    });

    it('inherits global settings when user has no overrides', () => {
      const globalConfig: Partial<WebCustomizationConfig> = {
        siteName: 'Acme Cloud Vault',
        accentColor: 'violet',
        defaultTheme: 'dark',
        visibleTabs: {
          explorer: true,
          shared: false,
          sources: false,
          activity: true,
          preferences: true,
        },
        uploadRules: {
          allowWebUploads: false,
          maxFileSizeMb: 50,
          allowedFileTypes: ['pdf'],
        },
        downloadRules: {
          allowDownloads: true,
          allowShareLinks: false,
        },
      };

      const res = resolveUserSettings(globalConfig, null, false);
      expect(res.siteName).toBe('Acme Cloud Vault');
      expect(res.accentColor).toBe('violet');
      expect(res.theme).toBe('dark');
      expect(res.visibleTabs.shared).toBe(false);
      expect(res.visibleTabs.sources).toBe(false);
      expect(res.visibleTabs.activity).toBe(true);
      expect(res.canUpload).toBe(false);
      expect(res.canDownload).toBe(true);
      expect(res.canShare).toBe(false);
    });

    it('allows per-user overrides to supersede global config', () => {
      const globalConfig: Partial<WebCustomizationConfig> = {
        visibleTabs: {
          explorer: true,
          shared: false,
          sources: false,
          activity: false,
          preferences: true,
        },
        uploadRules: {
          allowWebUploads: false,
          maxFileSizeMb: 10,
          allowedFileTypes: [],
        },
      };

      const userOverrides: UserCustomSettings = {
        visibleTabs: {
          shared: true,
        },
        canUpload: true,
        allowedDrives: ['drive-1', 'drive-2'],
        storageLimitMb: 500,
        themeLock: 'light',
      };

      const res = resolveUserSettings(globalConfig, userOverrides, false);
      expect(res.visibleTabs.shared).toBe(true);
      expect(res.visibleTabs.sources).toBe(false);
      expect(res.canUpload).toBe(true);
      expect(res.allowedDrives).toEqual(['drive-1', 'drive-2']);
      expect(res.storageLimitMb).toBe(500);
      expect(res.theme).toBe('light');
    });

    it('handles banner expiration correctly', () => {
      const pastDate = new Date(Date.now() - 3600 * 1000).toISOString();
      const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();

      const expiredConfig: Partial<WebCustomizationConfig> = {
        banner: {
          enabled: true,
          text: 'Maintenance scheduled',
          expiresAt: pastDate,
        },
      };

      const resExpired = resolveUserSettings(expiredConfig, null, false);
      expect(resExpired.banner.enabled).toBe(false);

      const activeConfig: Partial<WebCustomizationConfig> = {
        banner: {
          enabled: true,
          text: 'Welcome notice',
          expiresAt: futureDate,
        },
      };

      const resActive = resolveUserSettings(activeConfig, null, false);
      expect(resActive.banner.enabled).toBe(true);
      expect(resActive.banner.text).toBe('Welcome notice');

      // User personalized banner message overrides global notice even if global expired
      const userBannerRes = resolveUserSettings(
        expiredConfig,
        { bannerMessage: 'Personal message for user' },
        false
      );
      expect(userBannerRes.banner.enabled).toBe(true);
      expect(userBannerRes.banner.text).toBe('Personal message for user');
    });
  });
});
