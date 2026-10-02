import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const Table: React.FC<React.TableHTMLAttributes<HTMLTableElement>> = ({
  className,
  children,
  ...props
}) => (
  <div className="w-full overflow-x-auto rounded-lg border border-slate-200 dark:border-[#242424] bg-white dark:bg-[#0A0A0A]">
    <table
      className={twMerge(clsx('w-full text-left text-sm text-slate-700 dark:text-[#E6E6E6]', className))}
      {...props}
    >
      {children}
    </table>
  </div>
);

export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className,
  children,
  ...props
}) => (
  <thead
    className={twMerge(
      clsx('bg-slate-50 dark:bg-[#111111] border-b border-slate-200 dark:border-[#242424] text-xs font-semibold text-slate-500 dark:text-[#8A8A8A] uppercase tracking-wider', className)
    )}
    {...props}
  >
    {children}
  </thead>
);

export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({
  className,
  children,
  ...props
}) => (
  <tbody className={twMerge(clsx('divide-y divide-slate-100 dark:divide-[#242424]', className))} {...props}>
    {children}
  </tbody>
);

export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({
  className,
  children,
  ...props
}) => (
  <tr
    className={twMerge(
      clsx('hover:bg-slate-50/80 dark:hover:bg-[#181818] transition-colors group cursor-default', className)
    )}
    {...props}
  >
    {children}
  </tr>
);

export const TableHead: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({
  className,
  children,
  ...props
}) => (
  <th
    className={twMerge(
      clsx('px-4 py-3 select-none text-slate-500 dark:text-[#8A8A8A] font-semibold text-xs', className)
    )}
    {...props}
  >
    {children}
  </th>
);

export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({
  className,
  children,
  ...props
}) => (
  <td className={twMerge(clsx('px-4 py-3 align-middle text-sm dark:text-[#E6E6E6]', className))} {...props}>
    {children}
  </td>
);
