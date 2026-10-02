import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { AlertCircle, RefreshCw } from 'lucide-react';

export const ProtectedRoute: React.FC = () => {
  const { authState, isLoading, retryRoleResolution } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 dark:bg-black text-slate-900 dark:text-[#E6E6E6] p-4 transition-colors animate-fadeIn">
        <div className="flex flex-col items-center gap-4 text-center">
          <img src="/app-logo.png" alt="Bright Cloud" className="w-12 h-12 object-contain" />
          <div className="flex items-center gap-2.5">
            <div className="w-4 h-4 border-2 border-[#1DB954] border-t-transparent rounded-full animate-spin" />
            <p className="text-xs sm:text-sm font-medium text-slate-600 dark:text-[#8A8A8A]">
              Authenticating vault access...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (authState === 'UNAUTHENTICATED') {
    return <Navigate to="/login" replace />;
  }

  if (authState === 'UNAUTHORIZED') {
    return <Navigate to="/access-denied" replace />;
  }

  return (
    <>
      {authState === 'NETWORK_ERROR' && (
        <div className="bg-amber-50 dark:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800/80 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200 flex items-center justify-between sticky top-0 z-50">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span>Connection unavailable. Some vault data may be temporarily out of sync.</span>
          </div>
          <button
            onClick={() => retryRoleResolution()}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-amber-900 dark:text-amber-100 bg-amber-100 dark:bg-amber-900/80 hover:bg-amber-200 dark:hover:bg-amber-800 rounded transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}
      <Outlet />
    </>
  );
};

export const AdminRoute: React.FC = () => {
  const { isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[50vh] w-full flex flex-col items-center justify-center text-slate-900 dark:text-[#E6E6E6] p-4">
        <div className="w-5 h-5 border-2 border-[#1DB954] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};

export const PublicOnlyRoute: React.FC = () => {
  const { authState, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 dark:bg-black text-slate-900 dark:text-[#E6E6E6] p-4 transition-colors">
        <div className="w-5 h-5 border-2 border-[#1DB954] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authState === 'AUTHENTICATED_ADMIN' || authState === 'AUTHENTICATED_FRIEND') {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
};
