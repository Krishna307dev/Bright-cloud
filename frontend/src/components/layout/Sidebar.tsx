import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
  Folder,
  HardDrive,
  Share2,
  Activity,
  Users,
  Settings,
  ShieldCheck,
  UserCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../../features/auth/AuthContext';
import { Badge } from '../ui/Badge';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed, onToggleCollapse }) => {
  const { user, role, isAdmin } = useAuth();

  const navItems = [
    { label: 'Explorer', path: '/files', icon: Folder },
    { label: 'Shared', path: '/shared', icon: Share2 },
    { label: 'USB Sources', path: '/sources', icon: HardDrive },
    ...(isAdmin
      ? [
          { label: 'Activity', path: '/activity', icon: Activity },
          { label: 'Manage Users', path: '/users', icon: Users },
        ]
      : []),
    { label: 'Preferences', path: '/settings', icon: Settings },
    ...(isAdmin
      ? [{ label: 'Vault Security', path: '/settings/vault', icon: ShieldCheck }]
      : []),
  ];

  return (
    <aside
      aria-label="Main navigation"
      className={clsx(
        'hidden md:flex flex-col bg-white dark:bg-[#0A0A0A] border-r border-slate-200 dark:border-[#242424] transition-all duration-300 z-30 select-none shrink-0',
        collapsed ? 'w-20' : 'w-60'
      )}
    >
      {/* Brand Header */}
      <div className="h-16 px-4 border-b border-slate-100 dark:border-[#242424] flex items-center justify-between">
        <Link to="/files" className="flex items-center gap-3 overflow-hidden group hover:opacity-90 transition-opacity">
          <img src="/app-logo.png" alt="Bright Cloud" className="w-8 h-8 shrink-0 object-contain" />
          {!collapsed && (
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-sm text-slate-900 dark:text-[#E6E6E6] tracking-tight truncate group-hover:text-brand-500 dark:group-hover:text-[#1DB954] transition-colors">
                Bright Cloud
              </span>
              <span className="text-[10px] text-slate-400 dark:text-[#8A8A8A] font-medium truncate uppercase tracking-wider">
                Web Viewer
              </span>
            </div>
          )}
        </Link>
        <button
          onClick={onToggleCollapse}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-[#E6E6E6] p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-[#181818] transition-colors"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Role Badge Indicator */}
      <div className="px-3.5 py-3 border-b border-slate-100/80 dark:border-[#242424]">
        {!collapsed ? (
          <div className="flex items-center justify-between bg-slate-50 dark:bg-[#111111] px-3 py-2 rounded-lg border border-slate-200/60 dark:border-[#242424]">
            <div className="flex items-center gap-2 truncate">
              {isAdmin ? (
                <ShieldCheck className="w-4 h-4 text-brand-500 dark:text-[#1DB954] shrink-0" />
              ) : (
                <UserCheck className="w-4 h-4 text-emerald-600 dark:text-[#1DB954] shrink-0" />
              )}
              <div className="truncate">
                <p className="text-xs font-semibold text-slate-800 dark:text-[#E6E6E6] leading-none truncate">
                  {isAdmin ? 'Administrator' : 'Friend / Viewer'}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-[#8A8A8A] truncate mt-0.5">
                  {user?.email || 'Authenticated'}
                </p>
              </div>
            </div>
            <Badge variant={isAdmin ? 'brand' : 'success'} size="sm">
              {role}
            </Badge>
          </div>
        ) : (
          <div className="flex justify-center" title={`${role}: ${user?.email}`}>
            <Badge variant={isAdmin ? 'brand' : 'success'} size="sm">
              {isAdmin ? 'A' : 'F'}
            </Badge>
          </div>
        )}
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-all group',
                isActive
                  ? 'bg-brand-50 dark:bg-[#1DB954]/15 text-brand-600 dark:text-[#1DB954] font-semibold'
                  : 'text-slate-600 dark:text-[#8A8A8A] hover:bg-slate-100 dark:hover:bg-[#181818] hover:text-slate-900 dark:hover:text-[#E6E6E6]',
                collapsed && 'justify-center px-0'
              )
            }
            title={collapsed ? item.label : undefined}
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={clsx(
                    'w-4 h-4 shrink-0 transition-colors',
                    isActive ? 'text-brand-500 dark:text-[#1DB954]' : 'text-slate-400 dark:text-[#8A8A8A] group-hover:text-slate-600 dark:group-hover:text-[#E6E6E6]'
                  )}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};
