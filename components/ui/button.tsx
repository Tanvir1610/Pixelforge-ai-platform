import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "dark" | "secondary" | "ghost" | "danger" | "outlineDanger" | "onDark";
type Size = "xs" | "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-white shadow-[inset_0_1px_0_rgba(255,255,255,.12),0_1px_2px_rgba(99,102,241,.3)] hover:bg-accent-hover",
  dark: "bg-bg-dark text-white hover:bg-bg-dark-2",
  secondary: "bg-bg-surface border-border text-content shadow-sm hover:bg-bg-subtle",
  ghost: "bg-transparent text-content-secondary hover:bg-bg-subtle hover:text-content",
  danger: "bg-error text-white hover:brightness-95",
  outlineDanger: "bg-bg-surface border-[#FECACA] text-error-text hover:bg-error-soft",
  onDark: "bg-bg-dark-3 text-white hover:brightness-125",
};

const SIZES: Record<Size, string> = {
  xs: "h-[26px] px-2 text-caption rounded-sm",
  sm: "h-[30px] px-2.5 text-body-sm rounded-sm",
  md: "h-9 px-3.5 text-body rounded-md",
  lg: "h-11 px-5 text-[15px] rounded-[10px]",
  icon: "h-8 w-8 rounded-sm",
};

/** Shared class recipe, so a Link can be styled as a button without nesting one inside the other. */
export function buttonClasses(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(
    "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap border border-transparent font-medium leading-none transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
    "[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
    VARIANTS[variant], SIZES[size], className,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

/**
 * The single button primitive. When loading, the label stays in the DOM so the
 * control never changes width and assistive tech keeps its accessible name.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading = false, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap border border-transparent font-medium leading-none transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
        "[&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>{children}</span>
      {loading && (
        <span
          aria-hidden
          className={cn(
            "absolute h-3.5 w-3.5 animate-[spin_.8s_linear_infinite] rounded-full border-2",
            variant === "secondary" || variant === "ghost"
              ? "border-border border-t-content"
              : "border-white/40 border-t-white",
          )}
        />
      )}
    </button>
  );
});
