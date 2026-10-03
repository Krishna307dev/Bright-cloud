import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, MessageSquare, Sun, Moon, Monitor, ExternalLink } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { Footer } from '../../components/layout/Footer';
import { usePageTitle } from '../../hooks/usePageTitle';

export const INSTAGRAM_URL = import.meta.env.VITE_INSTAGRAM_URL || 'https://www.instagram.com/hydrogen_1x/';
export const DISCORD_URL = import.meta.env.VITE_DISCORD_URL || 'https://discord.gg/6Hug4FAMHj';

export const ContactDeveloperPage: React.FC = () => {
  usePageTitle('Contact Developer');
  const { mode, setMode, isDark } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen supports-[height:100dvh]:min-h-dvh flex flex-col bg-slate-50 dark:bg-black font-sans antialiased text-slate-900 dark:text-[#E6E6E6] transition-colors duration-150">
      {/* Top Header Bar */}
      <header className="px-4 sm:px-6 py-4 flex items-center justify-between border-b border-slate-200/80 dark:border-[#242424] bg-white/70 dark:bg-[#0A0A0A]/70 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6] p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#181818] transition-colors"
            title="Go Back"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="h-4 w-px bg-slate-200 dark:bg-[#242424] hidden sm:block" />
          <Link to="/" className="flex items-center gap-2">
            <img src="/app-logo.png" alt="Bright Cloud" className="w-6 h-6 object-contain" />
            <span className="text-xs font-semibold tracking-tight text-slate-900 dark:text-[#E6E6E6]">
              Bright Cloud
            </span>
          </Link>
        </div>

        {/* 3-way Theme Selector */}
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
      </header>

      {/* Main Content Area: flex-1 ensures footer pushed to bottom */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-md bg-white dark:bg-[#0A0A0A] rounded-2xl border border-slate-200 dark:border-[#242424] shadow-modal p-5 sm:p-8 space-y-6 text-center animate-fadeIn">
          {/* Badge Icon */}
          <div className="mx-auto w-14 h-14 rounded-2xl bg-brand-50 dark:bg-[#111111] border border-brand-100 dark:border-[#242424] flex items-center justify-center text-brand-600 dark:text-[#1DB954] shadow-xs">
            <MessageSquare className="w-7 h-7" />
          </div>

          {/* Heading */}
          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-[#E6E6E6]">
              Contact Developer
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-[#8A8A8A] leading-relaxed max-w-sm mx-auto">
              Need vault access, want to report an issue, or have feedback? Reach out directly via Instagram or Discord.
            </p>
          </div>

          {/* Two Official Buttons */}
          <div className="space-y-3 pt-2">
            {/* Instagram Button */}
            <a
              href={INSTAGRAM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-white dark:bg-[#111111] hover:bg-slate-50 dark:hover:bg-[#181818] border border-slate-200 dark:border-[#242424] text-slate-800 dark:text-[#E6E6E6] font-medium text-sm transition-all shadow-xs group"
            >
              <div className="flex items-center gap-3">
                {/* Official Instagram SVG */}
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#FD5949] via-[#D6249F] to-[#285AEB] flex items-center justify-center text-white shrink-0 shadow-xs">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className="font-semibold text-slate-900 dark:text-[#E6E6E6]">Instagram</div>
                  <div className="text-xs text-slate-500 dark:text-[#8A8A8A]">Direct message on Instagram</div>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-[#E6E6E6] transition-colors" />
            </a>

            {/* Discord Button */}
            <a
              href={DISCORD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-between px-4 py-3.5 rounded-xl bg-white dark:bg-[#111111] hover:bg-slate-50 dark:hover:bg-[#181818] border border-slate-200 dark:border-[#242424] text-slate-800 dark:text-[#E6E6E6] font-medium text-sm transition-all shadow-xs group"
            >
              <div className="flex items-center gap-3">
                {/* Official Discord SVG */}
                <div className="w-8 h-8 rounded-lg bg-[#5865F2] flex items-center justify-center text-white shrink-0 shadow-xs">
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                </div>
                <div className="text-left">
                  <div className="font-semibold text-slate-900 dark:text-[#E6E6E6]">Discord</div>
                  <div className="text-xs text-slate-500 dark:text-[#8A8A8A]">Join Discord or message directly</div>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-[#E6E6E6] transition-colors" />
            </a>
          </div>

          <div className="pt-2">
            <Link
              to="/"
              className="text-xs text-brand-600 dark:text-[#1DB954] hover:underline font-medium"
            >
              Return to Vault Home
            </Link>
          </div>
        </div>
      </main>

      {/* Footer placed at the very bottom of the page */}
      <Footer />
    </div>
  );
};
