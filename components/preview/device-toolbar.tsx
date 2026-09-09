"use client";

import { Maximize2, Monitor, RotateCw, Smartphone, SquareArrowOutUpRight, Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Tooltip } from "@/components/ui/tooltip";
import type { DeviceKey } from "@/types";

const ZOOMS = ["50", "75", "100"] as const;
export type Zoom = (typeof ZOOMS)[number];

export function DeviceToolbar({
  device, onDeviceChange, zoom, onZoomChange, onRefresh, showLabels = true,
}: {
  device: DeviceKey; onDeviceChange: (device: DeviceKey) => void;
  zoom: Zoom; onZoomChange: (zoom: Zoom) => void; onRefresh?: () => void; showLabels?: boolean;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg-surface px-4">
      <Segmented
        label="Preview device"
        value={device}
        onChange={onDeviceChange}
        options={[
          { value: "desktop", label: showLabels ? "Desktop" : "", icon: <Monitor /> },
          { value: "tablet", label: showLabels ? "Tablet" : "", icon: <Tablet /> },
          { value: "mobile", label: showLabels ? "Mobile" : "", icon: <Smartphone /> },
        ]}
      />
      <div className="flex items-center gap-2">
        <Segmented
          label="Preview zoom"
          value={zoom}
          onChange={onZoomChange}
          options={ZOOMS.map((z) => ({ value: z, label: `${z}%` }))}
        />
        <Tooltip label="Rebuild preview">
          <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Rebuild preview">
            <RotateCw />
          </Button>
        </Tooltip>
        <Tooltip label="Fullscreen">
          <Button variant="ghost" size="icon" aria-label="Fullscreen preview">
            <Maximize2 />
          </Button>
        </Tooltip>
        <Button variant="secondary" size="sm">
          <SquareArrowOutUpRight />
          Open preview
        </Button>
      </div>
    </div>
  );
}
