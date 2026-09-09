import { cn } from "@/lib/utils";

export function Avatar({ initials, size = "md", className }: {
  initials: string; size?: "sm" | "md"; className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#C7D2FE] to-[#818CF8] font-semibold text-[#312E81]",
        size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-caption",
        className,
      )}
    >
      {initials}
    </span>
  );
}
