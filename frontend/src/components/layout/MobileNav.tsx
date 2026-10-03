import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Folder,
  Share2,
  Activity,
  MoreHorizontal,
  HardDrive,
  Settings,
  Users,
  ShieldCheck,
  X,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../../features/auth/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';

export const MobileNav: React.FC = () => {
  const { isAdmin } = useAuth();
  const { mode, setMode, isDark } = useTheme();
  const [showMore, setShowMore] = useState(false);
  const location = useLocation();

  const mainItems = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { label: 'Explorer', path: '/files', icon: Folder },
    { label: 'Shared', path: '/shared', icon: Share2 },
    { label: 'Activity', path: '/activity', icon: Activity },
  ];

  const moreItems = [
    { label: 'USB Sources', path: '/sources', icon: HardDrive },
    { label: 'Preferences', path: '/settings', icon: Settings },
    ...(isAdmin
      ? [
          { label: 'Manage Users', path: '/users', icon: Users },
          { label: 'Vault Security', path: '/settings/vault', icon: ShieldCheck },
        ]
      : []),
  ];

  const isMoreActive = moreItems.some((item) => location.pathname === item.path);

  return (
    <>
      {/* Slide-up Drawer for "More" Navigation */}
      {showMore && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/60 dark:bg-black/70 backdrop-blur-xs animate-fadeIn"
            onClick={() => setShowMore(false)}
          />

          {/* Bottom Sheet Card */}
          <div className="relative bg-white dark:bg-[#0A0A0A] border-t border-slate-200 dark:border-[#242424] rounded-t-2xl p-5 pb-8 shadow-2xl z-10 animate-slideUp">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100 dark:border-[#242424]">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-[#8A8A8A]">
                More Destinations
              </span>
              <button
                onClick={() => setShowMore(false)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-[#E6E6E6] hover:bg-slate-100 dark:hover:bg-[#181818] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {moreItems.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setShowMore(false)}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-3 p-3 rounded-xl border text-xs font-semibold transition-all',
                      isActive
                        ? 'bg-brand-50 dark:bg-[#1DB954]/15 text-brand-600 dark:text-[#1DB954] border-brand-300 dark:border-[#1DB954]/30'
                        : 'bg-slate-50 dark:bg-[#111111] text-slate-700 dark:text-[#E6E6E6] border-slate-200/80 dark:border-[#242424] hover:bg-slate-100 dark:hover:bg-[#181818]'
                    )
                  }
                >
                  <item.icon className="w-4 h-4 text-brand-500 dark:text-[#1DB954] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              ))}
            </div>

            {/* Theme Appearance Selector */}
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#242424] flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 dark:text-[#8A8A8A]">
                Theme Appearance
              </span>
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
                  <Sun className="w-4 h-4" />
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
                  <Moon className="w-4 h-4" />
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
                  <Monitor className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Bottom Nav Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 min-h-[56px] pb-[env(safe-area-inset-bottom)] bg-white/95 dark:bg-[#0A0A0A]/95 backdrop-blur-md border-t border-slate-200 dark:border-[#242424] z-40 flex items-center justify-around px-1 shadow-lg select-none">
        {mainItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              clsx(
                'flex flex-col items-center justify-center w-full min-h-[56px] py-1 gap-1 text-[11px] font-medium transition-colors',
                isActive
                  ? 'text-brand-600 dark:text-[#1DB954] font-semibold'
                  : 'text-slate-400 dark:text-[#8A8A8A] hover:text-slate-700 dark:hover:text-[#E6E6E6]'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={clsx(
                    'w-[22px] h-[22px] transition-transform',
                    isActive && 'scale-105 text-brand-500 dark:text-[#1DB954]'
                  )}
                />
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}

        {/* 5th Tab: "More" Action Button */}
        <button
          type="button"
          onClick={() => setShowMore((prev) => !prev)}
          className={clsx(
            'flex flex-col items-center justify-center w-full min-h-[56px] py-1 gap-1 text-[11px] font-medium transition-colors',
            isMoreActive || showMore
              ? 'text-brand-600 dark:text-[#1DB954] font-semibold'
              : 'text-slate-400 dark:text-[#8A8A8A] hover:text-slate-700 dark:hover:text-[#E6E6E6]'
          )}
        >
          <MoreHorizontal
            className={clsx(
              'w-[22px] h-[22px] transition-transform',
              (isMoreActive || showMore) && 'scale-105 text-brand-500 dark:text-[#1DB954]'
            )}
          />
          <span>More</span>
        </button>
      </nav>
    </>
  );
};
