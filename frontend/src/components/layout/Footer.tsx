import React from 'react';
import { Link } from 'react-router-dom';

export const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-0 px-4 sm:px-6 py-3 border-t border-slate-200 dark:border-[#242424] text-xs text-slate-500 dark:text-[#8A8A8A] bg-white dark:bg-[#0A0A0A] shrink-0 select-none w-full">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-700 dark:text-[#E6E6E6]">
          © {currentYear} Bright Cloud
        </span>
        <span className="text-slate-300 dark:text-[#242424]">•</span>
        <span>Secure Vault Storage</span>
      </div>
      <div className="flex items-center gap-4">
        <Link
          to="/contact-developer"
          className="text-slate-400 dark:text-[#8A8A8A] hover:text-slate-600 dark:hover:text-[#E6E6E6] transition-colors font-medium"
        >
          Contact Developer
        </Link>
      </div>
    </footer>
  );
};
