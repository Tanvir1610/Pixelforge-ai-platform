import type { FigmaColor, FigmaPaint } from "./types";

/** Figma stores channels as 0–1 floats; tokens and CSS want hex. */
export function toHex(color: FigmaColor): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`.toUpperCase();
}

export function toRgba(color: FigmaColor, opacity = 1): string {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  const alpha = Math.round(color.a * opacity * 100) / 100;
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${alpha})`;
}

/**
 * First visible solid paint, as a CSS colour.
 *
 * Gradients and image fills return null: they become assets or CSS the
 * generator emits separately, and pretending they are a flat colour would put
 * a wrong value into the design tokens.
 */
export function paintToCss(paints: FigmaPaint[] | undefined): string | null {
  if (!paints?.length) return null;

  const paint = paints.find((candidate) => candidate.visible !== false);
  if (!paint || paint.type !== "SOLID" || !paint.color) return null;

  const opacity = paint.opacity ?? 1;
  const alpha = paint.color.a * opacity;
  return alpha >= 0.999 ? toHex(paint.color) : toRgba(paint.color, opacity);
}
