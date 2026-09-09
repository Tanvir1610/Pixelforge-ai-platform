import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "warning" | "error" | "dark";

const TONES: Record<Tone, string> = {
  neutral: "bg-bg-subtle text-content-secondary border-border",
  accent: "bg-accent-soft text-[#4338CA]",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  error: "bg-error-soft text-error-text",
  dark: "bg-bg-dark text-white",
};

export function Badge({
  tone = "neutral", dot = false, className, children, ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent px-2 text-caption font-medium",
        TONES[tone], className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
