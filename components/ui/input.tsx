import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, icon, trailing, disabled, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        // 44px on touch, the design's 38px from sm up: below that the control is
        // smaller than the recommended tap target.
        "flex h-11 w-full items-center gap-2 rounded-md border border-border bg-bg-surface px-3 shadow-sm transition sm:h-[38px]",
        "focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgba(99,102,241,.2)]",
        invalid && "border-error shadow-[0_0_0_3px_rgba(239,68,68,.15)]",
        disabled && "bg-bg-subtle text-content-muted",
        className,
      )}
    >
      {icon && <span className="shrink-0 text-content-muted [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
      <input
        ref={ref}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        // 16px on small screens is not a style choice: iOS Safari zooms the
        // viewport when a focused input is under 16px, which throws the layout
        // off and leaves the page scrolled sideways.
        className="min-w-0 flex-1 bg-transparent text-base text-content outline-none placeholder:text-content-muted disabled:cursor-not-allowed sm:text-body"
        {...props}
      />
      {trailing && <span className="shrink-0 text-content-muted">{trailing}</span>}
    </div>
  );
});

export function Field({
  label, help, error, htmlFor, children, action,
}: {
  label: string; help?: string; error?: string; htmlFor: string;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-body-sm font-medium">{label}</label>
        {action}
      </div>
      {children}
      {error ? (
        <p className="text-caption text-error-text">{error}</p>
      ) : help ? (
        <p className="text-caption text-content-muted">{help}</p>
      ) : null}
    </div>
  );
}
