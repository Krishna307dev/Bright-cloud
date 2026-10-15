import React from 'react';
import { Wrench, LogOut } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useWebCustomization } from '../../contexts/WebCustomizationContext';
import { Button } from '../../components/ui/Button';

export const MaintenancePage: React.FC = () => {
  const { signOut } = useAuth();
  const { resolvedSettings } = useWebCustomization();

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 dark:bg-black text-slate-900 dark:text-[#E6E6E6] p-4 transition-colors animate-fadeIn select-none">
      <div className="max-w-md w-full bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#242424] rounded-2xl p-6 sm:p-8 text-center shadow-lg">
        <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-[#181818] border border-slate-200 dark:border-[#282828] mx-auto flex items-center justify-center text-slate-700 dark:text-[#E6E6E6] mb-4">
          <Wrench className="w-6 h-6 text-brand-600 dark:text-[#1DB954]" />
        </div>

        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-[#E6E6E6]">
          {resolvedSettings.siteName || 'Bright Cloud'}
        </h1>
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mt-1">
          Maintenance Mode Active
        </p>

        <p className="text-sm text-slate-600 dark:text-[#8A8A8A] mt-3 leading-relaxed">
          The system administrator has temporarily enabled maintenance mode. Normal access is suspended while updates are being performed.
        </p>

        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-[#242424] flex justify-center">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => signOut()}
            className="gap-2 text-xs text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6]"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
};
