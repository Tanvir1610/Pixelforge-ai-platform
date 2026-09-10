import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The project's custom type scale, from tailwind.config.ts.
 *
 * tailwind-merge has to be told about these. Out of the box it knows the
 * default `text-sm` / `text-lg` scale, and classifies any other `text-*` it
 * does not recognise as a *colour*. So `text-body-sm` looked like a colour, and
 * because the size class is concatenated after the variant class in the button
 * recipe, it silently removed `text-white`.
 *
 * The result was a button with no colour class at all, inheriting the page's
 * near-black body text: white-on-dark became black-on-black. Every button at
 * size xs, sm or md rendered with an invisible label — the "Import" and
 * "Upgrade" controls looked like solid black rectangles. Only `lg` escaped it,
 * because `text-[15px]` is an arbitrary value that tailwind-merge reads
 * correctly as a size.
 */
const FONT_SIZES = [
  "display", "display-sm", "h1", "h2", "h3",
  "body-lg", "body", "body-sm", "caption", "code",
];

const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: FONT_SIZES }] } },
});

/** Merge conditional class names, de-duplicating conflicting Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a byte count the way the asset manager displays it. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
