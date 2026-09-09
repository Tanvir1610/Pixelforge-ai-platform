"use client";

import * as React from "react";

/** CSS-only tooltip driven by hover and focus, so keyboard users get it too. */
export function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-dropdown -translate-x-1/2 whitespace-nowrap rounded-sm bg-bg-dark px-2.5 py-1.5 text-caption text-white opacity-0 shadow-md transition-opacity group-hover/tt:opacity-100 group-focus-within/tt:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
