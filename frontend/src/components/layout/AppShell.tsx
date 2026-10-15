import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';
import { Footer } from './Footer';
import { useAuth } from '../../features/auth/AuthContext';
import { useWebCustomization } from '../../contexts/WebCustomizationContext';
import { MaintenancePage } from '../../features/maintenance/MaintenancePage';
import { ReconciliationService } from '../../services/reconciliationService';
import { Bell, Ban, LogOut } from 'lucide-react';
import { Button } from '../ui/Button';

export const AppShell: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { vaultId, isAdmin, signOut } = useAuth();
  const { resolvedSettings } = useWebCustomization();

  useEffect(() => {
    if (vaultId && isAdmin) {
      ReconciliationService.reconcileStaleReservations(vaultId).catch((err) => {
        console.warn('Background reconciliation notice:', err);
      });
    }
  }, [vaultId, isAdmin]);

  // If maintenance mode is active and current user is not admin
  if (resolvedSettings.maintenanceMode && !isAdmin) {
    return <MaintenancePage />;
  }

  // If normal user has been suspended
  if (resolvedSettings.isSuspended && !isAdmin) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 dark:bg-black text-slate-900 dark:text-[#E6E6E6] p-4 transition-colors">
        <div className="max-w-md w-full bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#242424] rounded-2xl p-6 text-center shadow-lg">
          <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 mx-auto flex items-center justify-center text-rose-600 dark:text-rose-400 mb-4">
            <Ban className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-[#E6E6E6]">
            Access Suspended
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#8A8A8A] mt-2">
            Your vault viewing access has been suspended by the administrator. Contact your vault owner to restore permissions.
          </p>
          <div className="mt-5 pt-4 border-t border-slate-100 dark:border-[#242424] flex justify-center">
            <Button variant="secondary" size="sm" onClick={() => signOut()} className="gap-2 text-xs">
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen h-screen supports-[height:100dvh]:h-dvh w-screen overflow-hidden overflow-x-hidden bg-slate-50 dark:bg-black font-sans antialiased text-slate-900 dark:text-[#E6E6E6] transition-colors duration-150">
      {/* Desktop Sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((prev) => !prev)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-slate-50 dark:bg-black">
        <Header />

        {/* Top Notice / Announcement Banner */}
        {resolvedSettings.banner.enabled && resolvedSettings.banner.text && (
          <div className="bg-brand-500/10 dark:bg-[#1DB954]/15 border-b border-brand-500/20 dark:border-[#1DB954]/30 px-4 py-2 text-xs text-brand-900 dark:text-[#E6E6E6] flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Bell className="w-3.5 h-3.5 text-brand-600 dark:text-[#1DB954] shrink-0" />
              <span className="font-medium truncate">{resolvedSettings.banner.text}</span>
            </div>
          </div>
        )}

        {/* Scrollable container with flex-col: main flex-1 pushes footer to the bottom of the content */}
        <div className="flex-1 overflow-y-auto flex flex-col min-h-0 bg-slate-50 dark:bg-black">
          <main className="flex-1 pb-24 md:pb-6 p-3 sm:p-6 lg:p-8 bg-slate-50 dark:bg-black">
            <Outlet />
          </main>

          {/* Footer at the very bottom of the page content */}
          <Footer />
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav />
    </div>
  );
};
