import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'brand' | 'neutral' | 'success' | 'warning' | 'danger';
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  className,
  variant = 'neutral',
  size = 'md',
  ...props
}) => {
  const baseStyles = 'inline-flex items-center font-medium rounded-full select-none';

  const variants = {
    brand: 'bg-brand-50 dark:bg-[#1DB954]/15 text-brand-700 dark:text-[#1DB954] border border-brand-200 dark:border-[#1DB954]/30',
    neutral: 'bg-slate-100 dark:bg-[#181818] text-slate-700 dark:text-[#E6E6E6] border border-slate-200 dark:border-[#242424]',
    success: 'bg-emerald-50 dark:bg-[#1DB954]/15 text-emerald-700 dark:text-[#1DB954] border border-emerald-200 dark:border-[#1DB954]/30',
    warning: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/40',
    danger: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40',
  };

  const sizes = {
    sm: 'text-[11px] px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-0.5 gap-1.5',
  };

  return (
    <span className={twMerge(clsx(baseStyles, variants[variant], sizes[size], className))} {...props}>
      {children}
    </span>
  );
};
