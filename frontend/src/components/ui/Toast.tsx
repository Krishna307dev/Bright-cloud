import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { clsx } from 'clsx';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration?: number) => {
      const id = Math.random().toString(36).substring(2, 9);
      const effectiveDuration =
        duration ?? (type === 'success' ? 3000 : type === 'error' ? 6000 : 4000);

      setToasts((prev) => [...prev, { id, type, message, duration: effectiveDuration }]);

      if (effectiveDuration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, effectiveDuration);
      }
    },
    [removeToast]
  );

  const success = useCallback(
    (msg: string, dur?: number) => showToast(msg, 'success', dur),
    [showToast]
  );
  const error = useCallback(
    (msg: string, dur?: number) => showToast(msg, 'error', dur),
    [showToast]
  );
  const info = useCallback(
    (msg: string, dur?: number) => showToast(msg, 'info', dur),
    [showToast]
  );
  const warning = useCallback(
    (msg: string, dur?: number) => showToast(msg, 'warning', dur),
    [showToast]
  );

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, warning }}>
      {children}
      {/* Toast Render Viewport (clears mobile bottom navigation bar) */}
      <div
        aria-live="polite"
        className="fixed bottom-20 md:bottom-4 right-4 left-4 sm:left-auto z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none select-none"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' || toast.type === 'warning' ? 'alert' : 'status'}
            className={clsx(
              'pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-modal transition-all animate-slideUp text-sm',
              toast.type === 'success' &&
                'bg-white dark:bg-[#0A0A0A] border-emerald-200 dark:border-[#1DB954]/40 text-slate-800 dark:text-[#E6E6E6]',
              toast.type === 'error' &&
                'bg-white dark:bg-[#0A0A0A] border-rose-200 dark:border-rose-900/60 text-slate-800 dark:text-[#E6E6E6]',
              toast.type === 'warning' &&
                'bg-white dark:bg-[#0A0A0A] border-amber-200 dark:border-amber-900/60 text-slate-800 dark:text-[#E6E6E6]',
              toast.type === 'info' &&
                'bg-white dark:bg-[#0A0A0A] border-slate-200 dark:border-[#242424] text-slate-800 dark:text-[#E6E6E6]'
            )}
          >
            {toast.type === 'success' && (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-[#1DB954] shrink-0 mt-0.5" />
            )}
            {toast.type === 'error' && (
              <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            )}
            {toast.type === 'warning' && (
              <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
            )}
            {toast.type === 'info' && (
              <Info className="w-5 h-5 text-brand-500 dark:text-[#1DB954] shrink-0 mt-0.5" />
            )}

            <div className="flex-1 text-xs leading-relaxed font-medium">
              {toast.message}
            </div>

            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-[#E6E6E6] p-0.5 rounded transition-colors"
              aria-label="Dismiss toast"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
