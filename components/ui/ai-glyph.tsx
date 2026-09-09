import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/** The AI mark. Pulsing is reserved for work that is genuinely in flight. */
export function AiGlyph({ size = "sm", pulse = false, className }: {
  size?: "sm" | "lg"; pulse?: boolean; className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center bg-gradient-to-br from-accent to-accent-secondary text-white",
        size === "lg" ? "h-7 w-7 rounded-md" : "h-5 w-5 rounded-sm",
        pulse && "animate-pulse-ring",
        className,
      )}
    >
      <Sparkles className={size === "lg" ? "h-4 w-4" : "h-3 w-3"} />
    </span>
  );
}
