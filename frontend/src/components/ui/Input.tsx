import React, { forwardRef } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="flex flex-col gap-1.5 w-full">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-slate-700 dark:text-[#E6E6E6] select-none">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={twMerge(
            clsx(
              'w-full px-3 py-2 text-sm bg-white dark:bg-[#111111] border rounded-md transition-colors placeholder:text-slate-400 dark:placeholder:text-[#8A8A8A] focus:outline-none focus:ring-2 focus:ring-offset-1 dark:focus:ring-offset-black',
              error
                ? 'border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 focus:border-rose-500 focus:ring-rose-500'
                : 'border-slate-300 dark:border-[#242424] text-slate-900 dark:text-[#E6E6E6] focus:border-brand-500 dark:focus:border-[#1DB954] focus:ring-brand-500 dark:focus:ring-[#1DB954]',
              className
            )
          )}
          {...props}
        />
        {error ? (
          <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-slate-500 dark:text-[#8A8A8A]">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
