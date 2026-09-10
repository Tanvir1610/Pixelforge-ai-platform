"use client";

import * as React from "react";
import { Film, Image as ImageIcon, Layers, Type as TypeIcon, Upload, User, Zap } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { formatBytes } from "@/lib/utils";
import type { AssetItem } from "@/types";

type Filter = "all" | AssetItem["kind"];

const ICONS: Record<AssetItem["kind"], React.ElementType> = {
  Image: ImageIcon, Icon: Zap, SVG: Layers, Font: TypeIcon, Video: Film,
};

const GRADIENTS = ["from-[#E0E7FF] to-[#F5F3FF]", "from-[#FEF3C7] to-[#FDE68A]", "from-[#DCFCE7] to-[#BBF7D0]"];

export function AssetManager({ assets }: { assets: AssetItem[] }) {
  const [filter, setFilter] = React.useState<Filter>("all");
  const [optimised, setOptimised] = React.useState(false);

  const visible = assets.filter((asset) => filter === "all" || asset.kind === filter);
  const pending = assets.filter((asset) => asset.needsOptimising).length;

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
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setOptimised(true)} disabled={optimised}>
            <Zap />
            Optimise all
          </Button>
          <Button variant="primary" size="sm">
            <Upload />
            Upload
          </Button>
        </div>
      </div>

      {!optimised && pending > 0 && (
        <Banner
          tone="warning"
          className="mb-5"
          action={
            <Button variant="secondary" size="xs" onClick={() => setOptimised(true)}>Optimise now</Button>
          }
        >
          {pending} images are larger than 300 KB. Optimising them cuts first load by about 1.1 MB.
        </Banner>
      )}
      {optimised && <Banner tone="success" className="mb-5">All images optimised. First load is 1.1 MB lighter.</Banner>}

      <ul className="grid gap-3.5 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {visible.map((asset, index) => {
          const Icon = ICONS[asset.kind];
          const isImage = asset.kind === "Image";
          return (
            <li key={asset.id} className="overflow-hidden rounded-[10px] border border-border bg-bg-surface">
              <div
                className={`grid h-[110px] place-items-center ${isImage ? `bg-gradient-to-br ${GRADIENTS[index % GRADIENTS.length]}` : "bg-bg-subtle"}`}
              >
                {asset.kind === "Font" ? (
                  <span className="font-display text-[28px] font-extrabold">Aa</span>
                ) : (
                  <Icon aria-hidden className="h-7 w-7 text-content-secondary" />
                )}
              </div>
              <div className="px-3 py-2.5">
                <b className="block truncate text-caption font-medium" title={asset.name}>{asset.name}</b>
                <small className="font-mono text-[11px] text-content-muted">
                  {asset.kind} · {formatBytes(optimised && asset.needsOptimising ? asset.bytes * 0.35 : asset.bytes)} ·{" "}
                  {asset.uses} {asset.uses === 1 ? "use" : "uses"}
                </small>
                <div className="mt-2 flex gap-1">
                  <Button variant="secondary" size="xs">Replace</Button>
                  <Button variant="ghost" size="xs">
                    {asset.needsOptimising && !optimised ? "Optimise" : "Download"}
                  </Button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
