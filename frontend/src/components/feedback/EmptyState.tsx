import React from 'react';
import { FolderOpen } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center max-w-sm mx-auto">
      <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-[#111111] text-slate-400 dark:text-[#8A8A8A] flex items-center justify-center mb-4 border border-slate-200/80 dark:border-[#242424]">
        {icon || <FolderOpen className="w-6 h-6" />}
      </div>
      <h3 className="text-sm font-semibold text-slate-800 dark:text-[#E6E6E6] mb-1">{title}</h3>
      <p className="text-xs text-slate-500 dark:text-[#8A8A8A] mb-5 leading-relaxed">{description}</p>
      {action && <div>{action}</div>}
    </div>
  );
};
