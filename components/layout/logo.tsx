import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({ inverse = false, markOnly = false, className }: {
  inverse?: boolean; markOnly?: boolean; className?: string;
}) {
  return (
    <Link href="/" className={cn("inline-flex items-center gap-2.5 font-display text-[16px] font-bold tracking-[-0.01em]", inverse && "text-white", className)}>
      <span className={cn("grid h-7 w-7 place-items-center rounded-md", inverse ? "bg-white" : "bg-bg-dark")}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill={inverse ? "#111" : "#fff"} aria-hidden>
          <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13l7 7h-7z" />
        </svg>
      </span>
      {!markOnly && <span>PixelForge AI</span>}
      <span className="sr-only">PixelForge AI home</span>
    </Link>
  );
}
