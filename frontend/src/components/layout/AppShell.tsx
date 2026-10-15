import React, { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';
import { Footer } from './Footer';
import { useAuth } from '../../features/auth/AuthContext';
import { ReconciliationService } from '../../services/reconciliationService';

export const AppShell: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { vaultId, isAdmin } = useAuth();

  useEffect(() => {
    if (vaultId && isAdmin) {
      ReconciliationService.reconcileStaleReservations(vaultId).catch((err) => {
        console.warn('Background reconciliation notice:', err);
      });
    }
  }, [vaultId, isAdmin]);

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
