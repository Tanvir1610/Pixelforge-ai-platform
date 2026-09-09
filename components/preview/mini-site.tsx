import { cn } from "@/lib/utils";
import type { DeviceKey } from "@/types";

/**
 * A scaled-down render of the *generated* website. This is the single source of
 * truth for anything showing a customer's site — Figma canvas, live preview,
 * project thumbnail, comparison panes — so all of them stay consistent and the
 * responsive columns are driven by the same `device` prop the toolbars set.
 */
export function MiniSite({
  brand, headline, device = "desktop", dark = false, className,
}: {
  brand: string; headline: string; device?: DeviceKey; dark?: boolean; className?: string;
}) {
  const columns = device === "desktop" ? 3 : device === "tablet" ? 2 : 1;
  const line = dark ? "bg-[#333]" : "bg-border";

  return (
    <div
      className={cn(
        "h-full w-full px-[18px] py-3.5 text-[10px]",
        dark ? "bg-bg-dark text-white" : "bg-bg-surface text-content",
        className,
      )}
    >
      <div className="mb-[22px] flex items-center justify-between">
        <b className="font-display text-[11px]">{brand}</b>
        <div className="flex items-center gap-1.5">
          {device === "desktop" && (
            <>
              <span className={cn("inline-block h-[7px] w-[38px] rounded-[3px]", line)} />
              <span className={cn("inline-block h-[7px] w-[38px] rounded-[3px]", line)} />
            </>
          )}
          {device !== "mobile" && <span className={cn("inline-block h-[7px] w-[38px] rounded-[3px]", line)} />}
          <span className={cn("inline-block h-4 w-12 rounded-[4px]", dark ? "bg-accent" : "bg-bg-dark")} />
        </div>
      </div>

      <h5
        className={cn(
          "mb-2 font-display font-extrabold leading-[1.1] tracking-[-0.02em]",
          device === "desktop" ? "max-w-[60%] text-[22px]" : device === "tablet" ? "max-w-[80%] text-[18px]" : "text-[16px]",
        )}
      >
        {headline}
      </h5>

      <div className={cn("mb-[5px] h-[6px] rounded-[3px]", line, device === "mobile" ? "w-[90%]" : "w-[55%]")} />
      <div className={cn("mb-3.5 h-[6px] rounded-[3px]", line, device === "mobile" ? "w-[70%]" : "w-[40%]")} />

      <div className="mb-[22px] flex gap-1.5">
        <span className={cn("block h-[18px] rounded-[4px] bg-accent", device === "mobile" ? "w-full" : "w-14")} />
        {device !== "mobile" && (
          <span className={cn("block h-[18px] w-14 rounded-[4px] border", dark ? "border-[#333] bg-bg-dark-2" : "border-border bg-bg-surface")} />
        )}
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className={cn(
              "rounded-[6px] border p-1.5",
              device === "mobile" ? "h-[34px]" : "h-[52px]",
              dark ? "border-[#333]" : "border-border",
            )}
          >
            <span className={cn("mb-1.5 block h-3.5 w-3.5 rounded-[4px]", dark ? "bg-accent/25" : "bg-accent-soft")} />
            <span className={cn("block h-[5px] w-[70%] rounded-[3px]", line)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Wraps MiniSite in a fixed box and scales it to fit — avoids per-usage transform maths. */
export function ScaledSite({
  scale, width = 420, height = 300, className, children,
}: {
  scale: number; width?: number; height?: number; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ height }}>
      <div
        className="origin-top-left"
        style={{ width: width / scale, height: height / scale, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
