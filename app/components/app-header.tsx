import type { ReactNode } from "react";

type AppHeaderProps = {
  title: string;
  eyebrow: string;
  subtitle?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  actionsLabel?: string;
  maxWidthClass?: string;
  sticky?: boolean;
  className?: string;
};

export function AppHeader({
  title,
  eyebrow,
  subtitle,
  leading,
  actions,
  actionsLabel = "Page actions",
  maxWidthClass = "max-w-360",
  sticky = true,
  className = "",
}: AppHeaderProps) {
  return (
    <header
      className={`${sticky ? "sticky top-0" : "relative"} z-30 shrink-0 border-b border-slate-200/80 bg-white/95 px-4 py-3 text-slate-950 backdrop-blur-xl sm:px-6 ${className}`}
    >
      <div
        className={`mx-auto flex w-full ${maxWidthClass} flex-wrap items-center justify-between gap-x-5 gap-y-3`}
      >
        <div className="flex min-w-0 items-center gap-3">
          {leading}
          <span
            className="h-8 w-1 shrink-0 rounded-full bg-indigo-600"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600">
              {eyebrow}
            </p>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h1 className="truncate text-base font-semibold leading-5 tracking-tight sm:text-lg">
                {title}
              </h1>
              {subtitle && (
                <p className="max-w-72 truncate text-xs text-slate-500">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
        </div>

        {actions && (
          <nav
            className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
            aria-label={actionsLabel}
          >
            {actions}
          </nav>
        )}
      </div>
    </header>
  );
}
