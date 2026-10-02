import React from 'react';
import { Link } from 'react-router-dom';
import { LogOut, User as UserIcon, Sun, Moon, Monitor } from 'lucide-react';
import { useAuth } from '../../features/auth/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../ui/Button';

import { getStoredAvatar } from '../../utils/avatars';

interface HeaderProps {
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ breadcrumbs, actions }) => {
  const { user, logout } = useAuth();
  const { mode, setMode, isDark } = useTheme();
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(() => getStoredAvatar());

  React.useEffect(() => {
    const handleAvatarUpdate = () => {
      setAvatarUrl(getStoredAvatar());
    };
    window.addEventListener('brightcloud_avatar_updated', handleAvatarUpdate);
    return () => window.removeEventListener('brightcloud_avatar_updated', handleAvatarUpdate);
  }, []);

  return (
    <header className="h-16 bg-white dark:bg-[#0A0A0A] border-b border-slate-200 dark:border-[#242424] px-4 sm:px-6 flex items-center justify-between z-20 shrink-0">
      {/* Left: Breadcrumbs / Title */}
      <div className="flex items-center gap-3 min-w-0">
        <Link to="/" className="md:hidden shrink-0 hover:opacity-90 transition-opacity">
          <img src="/app-logo.png" alt="Bright Cloud" className="w-7 h-7 object-contain" />
        </Link>
        {breadcrumbs ? (
          <div className="min-w-0">{breadcrumbs}</div>
        ) : (
          <h1 className="text-base font-semibold text-slate-800 dark:text-[#E6E6E6] tracking-tight truncate flex items-center gap-2">
            Bright Cloud Web Viewer
          </h1>
        )}
      </div>

      {/* Right: Actions & User Info */}
      <div className="flex items-center gap-3 shrink-0">
        {actions && <div className="flex items-center gap-2">{actions}</div>}

        {/* Modrinth-style 3-way Theme Selector (Light, Dark, System) */}
        <div className="flex items-center bg-slate-100 dark:bg-[#111111] p-0.5 rounded-lg border border-slate-200/80 dark:border-[#242424]">
          <button
            type="button"
            onClick={() => setMode('light')}
            className={`p-1.5 rounded-md transition-all ${
              mode === 'light'
                ? 'bg-white text-brand-600 shadow-xs'
                : 'text-slate-400 hover:text-slate-700 dark:hover:text-[#E6E6E6]'
            }`}
            title="Light Theme"
            aria-label="Light Theme"
          >
            <Sun className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMode('dark')}
            className={`p-1.5 rounded-md transition-all ${
              mode === 'dark'
                ? 'bg-[#181818] text-[#1DB954] shadow-xs'
                : 'text-slate-400 hover:text-slate-700 dark:hover:text-[#E6E6E6]'
            }`}
            title="Dark Theme (OLED)"
            aria-label="Dark Theme (OLED)"
          >
            <Moon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMode('system')}
            className={`p-1.5 rounded-md transition-all ${
              mode === 'system'
                ? isDark
                  ? 'bg-[#181818] text-[#1DB954] shadow-xs'
                  : 'bg-white text-brand-600 shadow-xs'
                : 'text-slate-400 hover:text-slate-700 dark:hover:text-[#E6E6E6]'
            }`}
            title={`System Theme (${isDark ? 'Dark' : 'Light'})`}
            aria-label={`System Theme (${isDark ? 'Dark' : 'Light'})`}
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="h-5 w-px bg-slate-200 dark:bg-[#242424] hidden sm:block" />

        {/* User Info & Avatar */}
        <div className="flex items-center gap-2.5">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={user?.displayName || 'User'}
              className="w-8 h-8 rounded-full border border-brand-300 dark:border-[#242424] object-cover shadow-xs"
            />
          ) : user?.photoURL ? (
            <img
              src={user.photoURL}
              alt={user.displayName || 'User'}
              className="w-8 h-8 rounded-full border border-slate-200 dark:border-[#242424] object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-brand-50 dark:bg-[#181818] border border-brand-200 dark:border-[#242424] text-brand-600 dark:text-[#E6E6E6] flex items-center justify-center font-semibold text-xs">
              {user?.displayName ? (
                user.displayName.charAt(0).toUpperCase()
              ) : (
                <UserIcon className="w-4 h-4 text-brand-500 dark:text-[#1DB954]" />
              )}
            </div>
          )}

          <div className="hidden lg:flex flex-col text-left">
            <span className="text-xs font-semibold text-slate-800 dark:text-[#E6E6E6] leading-tight truncate max-w-[140px]">
              {user?.displayName || 'User'}
            </span>
            <span className="text-[11px] text-slate-400 dark:text-[#8A8A8A] leading-none truncate max-w-[140px]">
              {user?.email}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            title="Sign out of Bright Cloud"
            className="p-1.5 text-slate-400 dark:text-[#8A8A8A] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};
