import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Home, ArrowLeft, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { Button } from '../../components/ui/Button';
import { Footer } from '../../components/layout/Footer';
import { usePageTitle } from '../../hooks/usePageTitle';

export const NotFoundPage: React.FC = () => {
  usePageTitle('Page Not Found');
  const navigate = useNavigate();
  const { mode, setMode, isDark } = useTheme();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-black font-sans antialiased text-slate-900 dark:text-[#E6E6E6] transition-colors duration-150">
      {/* Top Header Bar */}
      <div className="w-full px-4 sm:px-6 py-4 flex items-center justify-between shrink-0">
        <Link to="/" className="flex items-center gap-2">
          <img src="/app-logo.png" alt="Bright Cloud" className="w-6 h-6 object-contain" />
          <span className="text-xs font-semibold tracking-tight text-slate-900 dark:text-[#E6E6E6]">
            Bright Cloud
          </span>
        </Link>

        {/* Top-Right Theme Selector */}
        <div className="flex items-center bg-slate-100 dark:bg-[#111111] p-0.5 rounded-lg border border-slate-200/80 dark:border-[#242424] z-20">
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
        <div className="max-w-md w-full bg-white dark:bg-[#0A0A0A] rounded-2xl border border-slate-200 dark:border-[#242424] p-8 shadow-modal text-center animate-fadeIn">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-50 dark:bg-[#111111] text-brand-500 dark:text-[#1DB954] border border-transparent dark:border-[#242424] mb-6 shadow-xs">
            <span className="text-2xl font-bold tracking-tighter">404</span>
          </div>

          <h1 className="text-xl font-bold text-slate-900 dark:text-[#E6E6E6] mb-2">
            Page Not Found
          </h1>
          <p className="text-sm text-slate-500 dark:text-[#8A8A8A] mb-8 leading-relaxed">
            The storage location or route you requested does not exist or may have been moved.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              variant="secondary"
              onClick={() => navigate(-1)}
              className="w-full sm:w-auto"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Go Back
            </Button>
            <Button
              variant="primary"
              onClick={() => navigate('/')}
              className="w-full sm:w-auto"
            >
              <Home className="w-4 h-4 mr-2" />
              Go to Dashboard
            </Button>
          </div>
        </div>
      </main>

      {/* Footer placed at the very bottom of the page content */}
      <Footer />
    </div>
  );
};
