import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useAuth } from '../features/auth/AuthContext';
import {
  DEFAULT_WEB_CONFIG,
  resolveUserSettings,
  type WebCustomizationConfig,
  type UserCustomSettings,
  type ResolvedUserSettings,
} from '../models/webCustomization';
import { WebCustomizationService } from '../services/firestore/webCustomizationService';

interface WebCustomizationContextType {
  globalConfig: WebCustomizationConfig;
  resolvedSettings: ResolvedUserSettings;
  isLoading: boolean;
  updateGlobalConfig: (updates: Partial<WebCustomizationConfig>) => Promise<void>;
  resetGlobalConfig: () => Promise<void>;
  updateUserOverrides: (targetUid: string, overrides: Partial<UserCustomSettings>, targetEmail?: string) => Promise<void>;
  resetUserOverrides: (targetUid: string, targetEmail?: string) => Promise<void>;
  setUserSuspended: (targetUid: string, suspended: boolean, targetEmail?: string) => Promise<void>;
}

const WebCustomizationContext = createContext<WebCustomizationContextType | undefined>(undefined);

export const WebCustomizationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { vaultId, isAdmin, user } = useAuth();

  const [globalConfig, setGlobalConfig] = useState<WebCustomizationConfig>(DEFAULT_WEB_CONFIG);
  const [currentUserOverrides, setCurrentUserOverrides] = useState<UserCustomSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 1. Subscribe to Global Web Customization Config
  useEffect(() => {
    if (!vaultId) {
      setGlobalConfig(DEFAULT_WEB_CONFIG);
      setIsLoading(false);
      return;
    }

    const unsubscribe = WebCustomizationService.subscribeWebConfig(vaultId, (cfg) => {
      setGlobalConfig(cfg);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [vaultId]);

  // 2. Subscribe to Current User Profile (for per-user overrides)
  useEffect(() => {
    if (!vaultId || !user?.uid) {
      setCurrentUserOverrides(null);
      return;
    }

    const userRef = doc(db, 'vaults', vaultId, 'users', user.uid);
    const unsubscribe = onSnapshot(
      userRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setCurrentUserOverrides(data.customSettings || null);
        } else {
          setCurrentUserOverrides(null);
        }
      },
      (err) => {
        console.warn('WebCustomizationContext: user overrides subscription error:', err);
      }
    );

    return () => unsubscribe();
  }, [vaultId, user?.uid]);

  // 3. Resolve effective settings
  const resolvedSettings = useMemo(() => {
    return resolveUserSettings(globalConfig, currentUserOverrides, isAdmin);
  }, [globalConfig, currentUserOverrides, isAdmin]);

  // 4. Dynamically apply site accent and document attributes
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('data-accent', resolvedSettings.accentColor);

    // Dynamic site title prefix
    if (resolvedSettings.siteName && resolvedSettings.siteName !== 'Bright Cloud') {
      if (document.title.includes('Bright Cloud')) {
        document.title = document.title.replace('Bright Cloud', resolvedSettings.siteName);
      }
    }
  }, [resolvedSettings.accentColor, resolvedSettings.siteName]);

  const updateGlobalConfig = async (updates: Partial<WebCustomizationConfig>) => {
    if (!vaultId) return;
    await WebCustomizationService.updateWebConfig(
      vaultId,
      updates,
      user?.uid ? { uid: user.uid, email: user.email || 'admin' } : undefined
    );
  };

  const resetGlobalConfig = async () => {
    if (!vaultId) return;
    await WebCustomizationService.resetWebConfig(
      vaultId,
      user?.uid ? { uid: user.uid, email: user.email || 'admin' } : undefined
    );
  };

  const updateUserOverrides = async (
    targetUid: string,
    overrides: Partial<UserCustomSettings>,
    targetEmail?: string
  ) => {
    if (!vaultId) return;
    await WebCustomizationService.updateUserOverrides(
      vaultId,
      targetUid,
      overrides,
      user?.uid ? { uid: user.uid, email: user.email || 'admin' } : undefined,
      targetEmail
    );
  };

  const resetUserOverrides = async (targetUid: string, targetEmail?: string) => {
    if (!vaultId) return;
    await WebCustomizationService.resetUserOverrides(
      vaultId,
      targetUid,
      user?.uid ? { uid: user.uid, email: user.email || 'admin' } : undefined,
      targetEmail
    );
  };

  const setUserSuspended = async (
    targetUid: string,
    suspended: boolean,
    targetEmail?: string
  ) => {
    if (!vaultId) return;
    await WebCustomizationService.setUserSuspended(
      vaultId,
      targetUid,
      suspended,
      user?.uid ? { uid: user.uid, email: user.email || 'admin' } : undefined,
      targetEmail
    );
  };

  return (
    <WebCustomizationContext.Provider
      value={{
        globalConfig,
        resolvedSettings,
        isLoading,
        updateGlobalConfig,
        resetGlobalConfig,
        updateUserOverrides,
        resetUserOverrides,
        setUserSuspended,
      }}
    >
      {children}
    </WebCustomizationContext.Provider>
  );
};

export const useWebCustomization = (): WebCustomizationContextType => {
  const context = useContext(WebCustomizationContext);
  if (!context) {
    return {
      globalConfig: DEFAULT_WEB_CONFIG,
      resolvedSettings: resolveUserSettings(DEFAULT_WEB_CONFIG, null, false),
      isLoading: false,
      updateGlobalConfig: async () => {},
      resetGlobalConfig: async () => {},
      updateUserOverrides: async () => {},
      resetUserOverrides: async () => {},
      setUserSuspended: async () => {},
    };
  }
  return context;
};
