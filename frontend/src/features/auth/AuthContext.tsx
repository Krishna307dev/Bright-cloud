import React, { createContext, useContext, useEffect, useState, useTransition } from 'react';
import {
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { auth, googleProvider, VAULT_ID } from '../../services/firebase';
import { VaultService } from '../../services/firestore/vaultService';
import { B2AuthorizerClient } from '../../services/b2Authorizer';
import type { AuthStateCategory } from '../../utils/error';

export interface AuthContextType {
  currentUser: User | null;
  user: User | null;
  authState: AuthStateCategory;
  role: string;
  error: string | null;
  isAdmin: boolean;
  isFriend: boolean;
  isLoading: boolean;
  vaultId: string;
  signInWithGoogle: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  logout: () => Promise<void>;
  retryRoleResolution: () => Promise<void>;
  refreshRole: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authState, setAuthState] = useState<AuthStateCategory>('UNAUTHENTICATED');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [, startTransition] = useTransition();

  const resolveRole = async (user: User) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const state = await VaultService.resolveUserRole(VAULT_ID, user);
      // Automatically record / update user profile in vaults/{vaultId}/users/{uid}
      const role = state === 'AUTHENTICATED_ADMIN' ? 'admin' : state === 'AUTHENTICATED_FRIEND' ? 'friend' : undefined;
      await VaultService.syncUserProfile(VAULT_ID, user, role);

      // Asynchronously register to authorizer backend so Admin always sees them under Pending Approval
      B2AuthorizerClient.registerUser({
        displayName: user.displayName || undefined,
        photoURL: user.photoURL || undefined,
      }).catch(() => {});

      startTransition(() => {
        setAuthState(state);
        if (state === 'UNAUTHORIZED') {
          setAuthError('Your Google account is not on the collaborator whitelist for this vault.');
        } else if (state === 'NETWORK_ERROR') {
          setAuthError('Network connection issue. Retrying vault access...');
        }
        setIsLoading(false);
      });
    } catch (err: any) {
      startTransition(() => {
        setAuthState('NETWORK_ERROR');
        setAuthError(err.message || 'Network error resolving role.');
        setIsLoading(false);
      });
    }
  };

  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__setDevAuth = (user: any, state: AuthStateCategory) => {
        if (user) {
          sessionStorage.setItem('__dev_auth', JSON.stringify({ user, state }));
        } else {
          sessionStorage.removeItem('__dev_auth');
        }
        setCurrentUser(user);
        setAuthState(state);
        setIsLoading(false);
      };

      const devStored = sessionStorage.getItem('__dev_auth');
      if (devStored) {
        try {
          const parsed = JSON.parse(devStored);
          setCurrentUser(parsed.user);
          setAuthState(parsed.state);
          setIsLoading(false);
          return;
        } catch {
          sessionStorage.removeItem('__dev_auth');
        }
      }
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (import.meta.env.DEV && sessionStorage.getItem('__dev_auth')) {
        return;
      }
      setCurrentUser(user);
      if (user) {
        await resolveRole(user);
      } else {
        setAuthState('UNAUTHENTICATED');
        setAuthError(null);
        setIsLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user) {
        await resolveRole(cred.user);
      }
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        setIsLoading(false);
        return;
      }
      setAuthState('NETWORK_ERROR');
      setAuthError(err.message || 'Google sign-in failed.');
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    if (import.meta.env.DEV) {
      sessionStorage.removeItem('__dev_auth');
    }
    setIsLoading(true);
    await firebaseSignOut(auth);
    setCurrentUser(null);
    setAuthState('UNAUTHENTICATED');
    setAuthError(null);
    setIsLoading(false);
  };

  const retryRoleResolution = async () => {
    if (currentUser) {
      await resolveRole(currentUser);
    }
  };

  const roleLabel =
    authState === 'AUTHENTICATED_ADMIN'
      ? 'Admin'
      : authState === 'AUTHENTICATED_FRIEND'
      ? 'Friend'
      : authState === 'UNAUTHORIZED'
      ? 'Unauthorized'
      : 'Guest';

  const value: AuthContextType = {
    currentUser,
    user: currentUser,
    authState,
    role: roleLabel,
    error: authError,
    isAdmin: authState === 'AUTHENTICATED_ADMIN',
    isFriend: authState === 'AUTHENTICATED_FRIEND',
    isLoading,
    vaultId: VAULT_ID,
    signInWithGoogle,
    loginWithGoogle: signInWithGoogle,
    signOut,
    logout: signOut,
    retryRoleResolution,
    refreshRole: retryRoleResolution,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
