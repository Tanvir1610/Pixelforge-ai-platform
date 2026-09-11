"use client";

import * as React from "react";
import Link from "next/link";
import { Film, Image as ImageIcon, Layers, Type as TypeIcon, Upload, Zap } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { formatBytes } from "@/lib/utils";
import type { AssetItem } from "@/types";

type Filter = "all" | AssetItem["kind"];

const ICONS: Record<AssetItem["kind"], React.ElementType> = {
  Image: ImageIcon, Icon: Zap, SVG: Layers, Font: TypeIcon, Video: Film,
};

const GRADIENTS = ["from-[#E0E7FF] to-[#F5F3FF]", "from-[#FEF3C7] to-[#FDE68A]", "from-[#DCFCE7] to-[#BBF7D0]"];

/**
 * The asset grid.
 *
 * "Optimise all" used to set a local boolean, after which the screen announced
 * "All images optimised. First load is 1.1 MB lighter" and redrew every size at
 * 35% of its real value. Nothing was optimised; there is no image pipeline in
 * this codebase. Reload the page and the original sizes came back.
 *
 * The oversized-image warning is worth keeping — it is true, and a developer can
 * act on it. It just no longer offers to do the work.
 */
export function AssetManager({ assets }: { assets: AssetItem[] }) {
  const [filter, setFilter] = React.useState<Filter>("all");

  const visible = assets.filter((asset) => filter === "all" || asset.kind === filter);
  const pending = assets.filter((asset) => asset.needsOptimising).length;
  const pendingBytes = assets
    .filter((asset) => asset.needsOptimising)
    .reduce((total, asset) => total + asset.bytes, 0);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Asset type"
          value={filter}
          onChange={setFilter}
          className="border-b-0"
          tabs={[
            { value: "all", label: "All" }, { value: "Image", label: "Images" },
            { value: "Icon", label: "Icons" }, { value: "SVG", label: "SVG" },
            { value: "Font", label: "Fonts" }, { value: "Video", label: "Videos" },
          ]}
        />
        {/* "Upload" had no handler either. Assets arrive with an import, so
            that is where the control belongs. */}
        <Link href="/dashboard/import" className={buttonClasses("secondary", "sm")}>
          <Upload />
          Import more
        </Link>
      </div>

      {pending > 0 && (
        <Banner tone="warning" className="mb-5">
          {pending} {pending === 1 ? "file is" : "files are"} over 150 KB, {formatBytes(pendingBytes)} in
          total. Compressing them before you ship is worth doing — this platform doesn&apos;t do it for
          you yet.
        </Banner>
      )}

      <ul className="grid gap-3.5 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {visible.map((asset, index) => {
          const Icon = ICONS[asset.kind];
          const isImage = asset.kind === "Image";
          return (
            <li key={asset.id} className="overflow-hidden rounded-[10px] border border-border bg-bg-surface">
              <div
                className={`grid h-[110px] place-items-center overflow-hidden ${isImage || asset.kind === "SVG" ? `bg-gradient-to-br ${GRADIENTS[index % GRADIENTS.length]}` : "bg-bg-subtle"}`}
              >
                {/* The real file, not an icon standing in for it. Buckets are
                    private, so this is a short-lived signed URL. */}
                {asset.url && (isImage || asset.kind === "SVG" || asset.kind === "Icon") ? (
                  /* eslint-disable-next-line @next/next/no-img-element --
                     next/image rewrites through the optimiser, which cannot
                     fetch a signed URL that expires in five minutes. */
                  <img
                    src={asset.url}
                    alt={asset.name}
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                ) : asset.kind === "Font" ? (
                  <span className="font-display text-[28px] font-extrabold">Aa</span>
                ) : (
                  <Icon aria-hidden className="h-7 w-7 text-content-secondary" />
                )}
              </div>
              <div className="px-3 py-2.5">
                <b className="block truncate text-caption font-medium" title={asset.name}>{asset.name}</b>
                <small className="font-mono text-[11px] text-content-muted">
                  {asset.kind} · {formatBytes(asset.bytes)} ·{" "}
                  {asset.uses} {asset.uses === 1 ? "use" : "uses"}
                </small>
                {/* "Replace" and "Optimise" did nothing. Download does. */}
                <div className="mt-2 flex gap-1">
                  {asset.url ? (
                    <a
                      href={asset.url}
                      download={asset.name}
                      className={buttonClasses("secondary", "xs")}
                    >
                      Download
                    </a>
                  ) : (
                    <span className="text-[11px] text-content-muted">Not stored</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
