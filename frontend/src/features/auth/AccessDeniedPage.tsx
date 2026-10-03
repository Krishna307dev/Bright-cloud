import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, LogOut, RefreshCw, Sun, Moon, Monitor, Send, CheckCircle2 } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/Button';
import { Footer } from '../../components/layout/Footer';
import { RequestApprovalModal } from './RequestApprovalModal';
import { ApprovalService } from '../../services/firestore/approvalService';
import { VaultService } from '../../services/firestore/vaultService';
import type { ApprovalRequest } from '../../models';
import { usePageTitle } from '../../hooks/usePageTitle';
import { formatDate } from '../../utils/format';

export const AccessDeniedPage: React.FC = () => {
  usePageTitle('Access Denied');
  const { user, role, error, refreshRole, logout, isLoading, isAdmin, isFriend, vaultId } = useAuth();
  const { mode, setMode, isDark } = useTheme();
  const navigate = useNavigate();

  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [existingRequest, setExistingRequest] = useState<ApprovalRequest | null>(null);

  useEffect(() => {
    if (isAdmin || isFriend || role?.toUpperCase() === 'ADMIN' || role?.toUpperCase() === 'FRIEND') {
      navigate('/', { replace: true });
    }
  }, [isAdmin, isFriend, role, navigate]);

  // Ensure unapproved signed-in user is always registered as pending in Firestore
  // and load any existing approval request
  useEffect(() => {
    if (user && vaultId) {
      VaultService.syncUserProfile(vaultId, user, 'pending').catch(() => {});
      ApprovalService.getApprovalRequest(user.uid).then((req) => {
        if (req) setExistingRequest(req);
      });
    }
  }, [user, vaultId]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-black font-sans antialiased text-slate-900 dark:text-[#E6E6E6] transition-colors duration-150">
      {/* Top Header / Actions Bar */}
      <div className="w-full px-4 sm:px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <img src="/app-logo.png" alt="Bright Cloud" className="w-6 h-6 object-contain" />
          <span className="text-xs font-semibold tracking-tight text-slate-900 dark:text-[#E6E6E6]">
            Bright Cloud
          </span>
        </div>

        {/* Top-Right Theme Selector */}
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
      </div>

      {/* Main Content: flex-1 ensures layout pushes footer to bottom without fixed/sticky */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white dark:bg-[#0A0A0A] rounded-2xl border border-slate-200 dark:border-[#242424] shadow-modal p-6 sm:p-8 space-y-6 text-center animate-fadeIn">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-50 dark:bg-[#111111] border border-amber-200/80 dark:border-[#242424] flex items-center justify-center text-amber-600 dark:text-amber-400 shadow-xs">
            <ShieldAlert className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-[#E6E6E6] tracking-tight">
              Vault Access Restricted
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-[#8A8A8A] leading-relaxed">
              Your Google Account is signed in, but has not been authorized to access this Bright Cloud Vault.
            </p>
          </div>

          {/* User Card */}
          <div className="bg-slate-50 dark:bg-[#111111] border border-slate-200/70 dark:border-[#242424] rounded-xl p-4 text-left">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-[#8A8A8A] mb-1">
              Authenticated Account
            </div>
            <div className="text-sm font-semibold text-slate-800 dark:text-[#E6E6E6] truncate">
              {user?.displayName || 'User'}
            </div>
            <div className="text-xs text-slate-500 dark:text-[#8A8A8A] truncate font-mono mt-0.5">
              {user?.email || 'Unknown email'}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-[#242424] flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-[#8A8A8A]">Authorization Status:</span>
              <span className="font-semibold text-amber-700 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-950/60 px-2 py-0.5 rounded text-[11px]">
                {role === 'UNAUTHORIZED' ? 'Pending Approval' : role}
              </span>
            </div>
          </div>

          {/* Existing Request Status Banner */}
          {existingRequest && (
            <div className="p-3.5 bg-emerald-50/80 dark:bg-[#1DB954]/10 border border-emerald-200/80 dark:border-[#1DB954]/25 rounded-xl text-left flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-[#1DB954] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-emerald-800 dark:text-[#1DB954]">
                  Approval Request Submitted
                </div>
                <div className="text-[11px] text-slate-500 dark:text-[#8A8A8A]">
                  Submitted on {formatDate(existingRequest.createdAt)}. Status:{' '}
                  <span className="font-medium text-slate-700 dark:text-[#E6E6E6] capitalize">
                    {existingRequest.status}
                  </span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg text-rose-700 dark:text-rose-300 text-xs text-left leading-relaxed">
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2.5 pt-1">
            {/* Request Approval Button */}
            <Button
              variant="primary"
              className="w-full justify-center gap-2 py-2.5 text-xs font-semibold"
              onClick={() => setIsApprovalModalOpen(true)}
            >
              <Send className="w-4 h-4" />
              {existingRequest ? 'Update Approval Request' : 'Request Approval'}
            </Button>

            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                variant="secondary"
                className="flex-1 justify-center gap-2 text-xs"
                onClick={refreshRole}
                disabled={isLoading}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-brand-600 dark:text-[#1DB954]' : ''}`} />
                Check Status
              </Button>
              <Button
                variant="ghost"
                className="flex-1 justify-center gap-2 text-xs text-slate-600 dark:text-[#8A8A8A] hover:text-rose-600 dark:hover:text-rose-400"
                onClick={logout}
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer placed at the very bottom of the page content */}
      <Footer />

      {/* Request Approval Modal */}
      <RequestApprovalModal
        isOpen={isApprovalModalOpen}
        onClose={() => setIsApprovalModalOpen(false)}
        user={user}
        existingRequest={existingRequest}
        onSuccess={(req) => setExistingRequest(req)}
      />
    </div>
  );
};
