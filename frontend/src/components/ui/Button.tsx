import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed select-none';

  const variants = {
    primary:
      'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 dark:bg-[#1DB954] dark:hover:bg-[#1AA34A] dark:active:bg-[#15803D] dark:text-black dark:font-semibold focus:ring-brand-500 dark:focus:ring-[#1DB954] shadow-sm',
    secondary:
      'bg-white dark:bg-[#111111] text-slate-700 dark:text-[#E6E6E6] border border-slate-300 dark:border-[#242424] hover:bg-slate-50 dark:hover:bg-[#181818] active:bg-slate-100 dark:active:bg-[#181818] focus:ring-slate-400 dark:focus:ring-[#1DB954] shadow-sm',
    danger:
      'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800 dark:bg-rose-700 dark:hover:bg-rose-600 focus:ring-rose-500 shadow-sm',
    ghost:
      'text-slate-600 dark:text-[#8A8A8A] hover:text-slate-900 dark:hover:text-[#E6E6E6] hover:bg-slate-100 dark:hover:bg-[#181818] active:bg-slate-200 dark:active:bg-[#181818] focus:ring-slate-300 dark:focus:ring-[#242424]',
  };

  const sizes = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5',
    md: 'text-sm px-3.5 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  };

  return (
    <button
      className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      )}
      {children}
    </button>
  );
};
