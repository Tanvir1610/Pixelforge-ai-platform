import * as React from "react";
import { AlertTriangle, Check, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "warning" | "error" | "success";

const TONES: Record<Tone, string> = {
  info: "bg-accent-soft border-[#C7D2FE] text-[#312E81]",
  warning: "bg-warning-soft border-[#FDE68A] text-[#78350F]",
  error: "bg-error-soft border-[#FECACA] text-[#7F1D1D]",
  success: "bg-success-soft border-[#BBF7D0] text-[#14532D]",
};

const ICONS: Record<Tone, React.ElementType> = {
  info: Info, warning: AlertTriangle, error: AlertTriangle, success: Check,
};

export function Banner({ tone = "info", children, action, className }: {
  tone?: Tone; children: React.ReactNode; action?: React.ReactNode; className?: string;
}) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex items-start gap-2.5 rounded-[10px] border p-3 text-body-sm", TONES[tone], className)}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}
