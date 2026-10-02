import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  message = 'Loading...',
  size = 'md',
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 gap-3 text-slate-500 dark:text-[#8A8A8A] animate-fadeIn">
      <Loader2 className={`${sizeClasses[size]} animate-spin text-brand-500 dark:text-[#1DB954]`} />
      {message && <p className="text-xs font-medium text-slate-500 dark:text-[#8A8A8A]">{message}</p>}
    </div>
  );
};
