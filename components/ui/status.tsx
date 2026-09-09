import { Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskState } from "@/types";

/** The single status dot used by analysis steps, generation tasks and deploy steps. */
export function StatusDot({ state, className }: { state: TaskState; className?: string }) {
  const base = "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full [&_svg]:h-3 [&_svg]:w-3";
  if (state === "done")
    return (
      <span className={cn(base, "bg-success-soft text-success-text", className)}>
        <Check aria-label="Complete" strokeWidth={3} />
      </span>
    );
  if (state === "active")
    return (
      <span className={cn(base, "bg-accent-soft text-accent", className)}>
        <Loader2 aria-label="In progress" className="animate-[spin_1s_linear_infinite]" />
      </span>
    );
  if (state === "failed")
    return (
      <span className={cn(base, "bg-error-soft text-error-text", className)}>
        <X aria-label="Failed" strokeWidth={3} />
      </span>
    );
  return <span aria-label="Not started" className={cn(base, "bg-bg-subtle", className)} />;
}
