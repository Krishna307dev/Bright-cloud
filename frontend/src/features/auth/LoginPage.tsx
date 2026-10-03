import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, AlertCircle, Sun, Moon, Monitor } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/Button';
import { Footer } from '../../components/layout/Footer';
import { usePageTitle } from '../../hooks/usePageTitle';

export const LoginPage: React.FC = () => {
  usePageTitle('Sign In');
  const { user, loginWithGoogle, isLoading } = useAuth();
  const { mode, setMode, isDark } = useTheme();
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  // If already authenticated with active role, redirect to dashboard
  if (!isLoading && user) {
    return <Navigate to="/" replace />;
  }

  const handleGoogleSignIn = async () => {
    try {
      setAuthError(null);
      setIsSubmitting(true);
      await loginWithGoogle();
      navigate('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed with Google';
      setAuthError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen supports-[height:100dvh]:min-h-dvh flex flex-col bg-slate-50 dark:bg-black font-sans antialiased text-slate-900 dark:text-[#E6E6E6] transition-colors duration-150">
      {/* Top Header with Brand and Theme Selector */}
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

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white dark:bg-[#0A0A0A] rounded-2xl border border-slate-200 dark:border-[#242424] shadow-modal p-5 sm:p-8 space-y-6 animate-fadeIn">
          {/* Authentic Floating Logo */}
          <div className="text-center space-y-2">
            <div className="mx-auto w-16 h-16 flex items-center justify-center mb-2">
              <img
                src="/app-logo.png"
                alt="Bright Cloud Logo"
                className="w-14 h-14 object-contain filter drop-shadow-sm select-none"
              />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#E6E6E6]">
              Sign in to Bright Cloud
            </h1>
            <p className="text-xs text-slate-500 dark:text-[#8A8A8A] leading-relaxed">
              Decentralized, air-gapped personal cloud storage backup viewer and media vault.
            </p>
          </div>

          {/* Error Banner */}
          {authError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-300 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {/* Social Auth Action */}
          <div className="space-y-3 pt-2">
            <Button
              variant="secondary"
              className="w-full justify-center gap-3 py-3 rounded-xl border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#111111] hover:bg-slate-50 dark:hover:bg-[#181818] shadow-xs transition-all"
              onClick={handleGoogleSignIn}
              isLoading={isSubmitting}
            >
              {/* Official Google SVG */}
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span className="font-semibold text-slate-700 dark:text-[#E6E6E6]">Continue with Google</span>
              <ArrowRight className="w-4 h-4 text-slate-400 dark:text-[#8A8A8A] ml-auto" />
            </Button>
          </div>

          {/* Footer info */}
          <div className="pt-4 border-t border-slate-100 dark:border-[#242424] text-center text-[11px] text-slate-400 dark:text-[#8A8A8A]">
            Encrypted transfer via Backblaze B2 & Cloudflare SigV4
          </div>
        </div>
      </main>

      {/* Footer placed at the very bottom of the page content */}
      <Footer />
    </div>
  );
};
