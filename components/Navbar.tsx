import React from 'react';

interface NavbarProps {
  onLogoClick?: () => void;
  center?: React.ReactNode;
  right?: React.ReactNode;
}

export const Navbar: React.FC<NavbarProps> = ({ onLogoClick, center, right }) => {
  const logoWrapperClasses = onLogoClick
    ? "flex items-center gap-2 cursor-pointer group select-none"
    : "flex items-center gap-2 select-none";

  return (
    <header className="h-14 flex-shrink-0 border-b border-slate-800 bg-slate-900/85 backdrop-blur flex items-center justify-between px-4 sm:px-6 z-20 shadow-sm">
      <div className="flex items-center gap-8">
        <div
          className={logoWrapperClasses}
          onClick={onLogoClick}
        >
          <div className="relative w-8 h-8 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-brand-500 w-8 h-8 group-hover:rotate-180 transition-transform duration-700 ease-in-out">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-lg tracking-tight text-white leading-none">
              SciStudio<span className="text-brand-500">.ai</span>
            </span>
            <span className="text-[10px] text-slate-500 font-mono tracking-widest">
              可交互式科普动画创作平台
            </span>
          </div>
        </div>
        {center && (
          <div className="flex items-center gap-4 text-sm text-slate-300">
            {center}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 relative">
        {right}
      </div>
    </header>
  );
};

