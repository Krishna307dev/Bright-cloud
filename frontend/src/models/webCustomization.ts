export type AccentColor = 'emerald' | 'blue' | 'amber' | 'indigo' | 'violet' | 'neutral';
export type ThemePreference = 'dark' | 'light' | 'system';

export interface TabVisibilityConfig {
  explorer: boolean;
  shared: boolean;
  sources: boolean;
  activity: boolean;
  preferences: boolean;
}

export interface WebCustomizationConfig {
  siteName: string;
  logoUrl?: string;
  accentColor: AccentColor;
  defaultTheme: ThemePreference;
  banner: {
    enabled: boolean;
    text: string;
    expiresAt?: Date | string | null;
  };
  visibleTabs: TabVisibilityConfig;
  defaultLandingDrive: string;
  maintenanceMode: boolean;
  uploadRules: {
    allowWebUploads: boolean;
    maxFileSizeMb: number;
    allowedFileTypes: string[];
  };
  downloadRules: {
    allowDownloads: boolean;
    allowShareLinks: boolean;
  };
  updatedAt?: Date;
  updatedBy?: string;
}

export const DEFAULT_WEB_CONFIG: WebCustomizationConfig = {
  siteName: 'Bright Cloud',
  logoUrl: '',
  accentColor: 'emerald',
  defaultTheme: 'system',
  banner: {
    enabled: false,
    text: '',
    expiresAt: null,
  },
  visibleTabs: {
    explorer: true,
    shared: true,
    sources: true,
    activity: false,
    preferences: true,
  },
  defaultLandingDrive: 'auto',
  maintenanceMode: false,
  uploadRules: {
    allowWebUploads: false,
    maxFileSizeMb: 500,
    allowedFileTypes: ['*'],
  },
  downloadRules: {
    allowDownloads: true,
    allowShareLinks: true,
  },
};

export interface UserCustomSettings {
  visibleTabs?: Partial<TabVisibilityConfig>;
  allowedDrives?: string[];
  canUpload?: boolean;
  canDownload?: boolean;
  canShare?: boolean;
  storageLimitMb?: number;
  themeLock?: ThemePreference;
  bannerMessage?: string;
  suspended?: boolean;
  updatedAt?: Date;
}

export interface ResolvedUserSettings {
  siteName: string;
  logoUrl: string;
  accentColor: AccentColor;
  theme: ThemePreference;
  banner: {
    enabled: boolean;
    text: string;
  };
  visibleTabs: TabVisibilityConfig;
  allowedDrives?: string[];
  canUpload: boolean;
  canDownload: boolean;
  canShare: boolean;
  storageLimitMb?: number;
  maintenanceMode: boolean;
  isSuspended: boolean;
}

/**
 * Resolves effective user settings with deterministic priority:
 * 1. Admin bypass: admins are never locked out by maintenance mode, suspension, or tab hiding.
 * 2. Per-user override: if explicitly set on user profile, it wins.
 * 3. Global configuration: if set in settings/webConfig.
 * 4. Hardcoded defaults: DEFAULT_WEB_CONFIG.
 */
export function resolveUserSettings(
  globalConfig: Partial<WebCustomizationConfig> | null | undefined,
  userOverrides: UserCustomSettings | null | undefined,
  isAdmin: boolean
): ResolvedUserSettings {
  const g = {
    ...DEFAULT_WEB_CONFIG,
    ...(globalConfig || {}),
    visibleTabs: {
      ...DEFAULT_WEB_CONFIG.visibleTabs,
      ...(globalConfig?.visibleTabs || {}),
    },
    banner: {
      ...DEFAULT_WEB_CONFIG.banner,
      ...(globalConfig?.banner || {}),
    },
    uploadRules: {
      ...DEFAULT_WEB_CONFIG.uploadRules,
      ...(globalConfig?.uploadRules || {}),
    },
    downloadRules: {
      ...DEFAULT_WEB_CONFIG.downloadRules,
      ...(globalConfig?.downloadRules || {}),
    },
  };

  // Check banner expiry
  let isBannerActive = g.banner.enabled && Boolean(g.banner.text?.trim());
  if (isBannerActive && g.banner.expiresAt) {
    const expiry = typeof g.banner.expiresAt === 'string'
      ? new Date(g.banner.expiresAt).getTime()
      : g.banner.expiresAt instanceof Date
      ? g.banner.expiresAt.getTime()
      : 0;
    if (expiry > 0 && Date.now() > expiry) {
      isBannerActive = false;
    }
  }

  const effectiveBannerText = userOverrides?.bannerMessage?.trim() || g.banner.text;
  const hasUserBanner = Boolean(userOverrides?.bannerMessage?.trim());

  if (isAdmin) {
    return {
      siteName: g.siteName || 'Bright Cloud',
      logoUrl: g.logoUrl || '',
      accentColor: g.accentColor || 'emerald',
      theme: userOverrides?.themeLock || g.defaultTheme || 'system',
      banner: {
        enabled: hasUserBanner || isBannerActive,
        text: effectiveBannerText,
      },
      visibleTabs: {
        explorer: true,
        shared: true,
        sources: true,
        activity: true,
        preferences: true,
      },
      allowedDrives: undefined,
      canUpload: true,
      canDownload: true,
      canShare: true,
      storageLimitMb: undefined,
      maintenanceMode: false,
      isSuspended: false,
    };
  }

  // Normal user
  const isSuspended = Boolean(userOverrides?.suspended);
  const maintenanceMode = Boolean(g.maintenanceMode);

  const canUpload = userOverrides?.canUpload !== undefined
    ? userOverrides.canUpload
    : g.uploadRules.allowWebUploads;

  const canDownload = userOverrides?.canDownload !== undefined
    ? userOverrides.canDownload
    : g.downloadRules.allowDownloads;

  const canShare = userOverrides?.canShare !== undefined
    ? userOverrides.canShare
    : g.downloadRules.allowShareLinks;

  const visibleTabs: TabVisibilityConfig = {
    explorer: userOverrides?.visibleTabs?.explorer ?? g.visibleTabs.explorer,
    shared: userOverrides?.visibleTabs?.shared ?? g.visibleTabs.shared,
    sources: userOverrides?.visibleTabs?.sources ?? g.visibleTabs.sources,
    activity: userOverrides?.visibleTabs?.activity ?? g.visibleTabs.activity,
    preferences: userOverrides?.visibleTabs?.preferences ?? g.visibleTabs.preferences,
  };

  return {
    siteName: g.siteName || 'Bright Cloud',
    logoUrl: g.logoUrl || '',
    accentColor: g.accentColor || 'emerald',
    theme: userOverrides?.themeLock || g.defaultTheme || 'system',
    banner: {
      enabled: hasUserBanner || isBannerActive,
      text: effectiveBannerText,
    },
    visibleTabs,
    allowedDrives: Array.from(new Set(['WEB_UPLOADS', ...(userOverrides?.allowedDrives || [])])),
    canUpload,
    canDownload,
    canShare,
    storageLimitMb: userOverrides?.storageLimitMb,
    maintenanceMode,
    isSuspended,
  };
}

export type AdminAuditAction =
  | 'UPDATE_GLOBAL_CONFIG'
  | 'RESET_GLOBAL_CONFIG'
  | 'UPDATE_USER_OVERRIDE'
  | 'RESET_USER_OVERRIDE'
  | 'CHANGE_USER_ROLE'
  | 'SUSPEND_USER'
  | 'ACTIVATE_USER'
  | 'APPROVE_USER'
  | 'REJECT_USER';

export interface AdminAuditRecord {
  id: string;
  adminUid: string;
  adminEmail: string;
  action: AdminAuditAction;
  targetUid?: string;
  targetEmail?: string;
  details: string;
  timestamp: Date;
}
