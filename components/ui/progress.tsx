import { cn } from "@/lib/utils";

export function Progress({ value, className, barClassName, label }: {
  value: number; className?: string; barClassName?: string; label?: string;
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progress"}
      className={cn("h-1.5 overflow-hidden rounded-full bg-bg-subtle", className)}
    >
      <div
        className={cn("h-full rounded-full bg-accent transition-[width] duration-500 ease-out", barClassName)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
