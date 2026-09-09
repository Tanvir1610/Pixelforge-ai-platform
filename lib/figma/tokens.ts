import type { DesignToken, IrNode } from "@/lib/design-ir/types";

/**
 * Token extraction.
 *
 * Values repeated across the design are intentional; values used once are
 * usually incidental. Only recurring values are promoted to tokens, so the
 * generated theme reflects the design system rather than every stray number.
 */
const MIN_USES = 2;

function tally<T>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/** Colours are named by frequency: the most used becomes primary. */
function colorTokens(nodes: IrNode[]): DesignToken[] {
  const used: string[] = [];
  for (const node of nodes) {
    if (node.style.backgroundColor) used.push(node.style.backgroundColor);
    if (node.typography?.color) used.push(node.typography.color);
    if (node.style.borderColor) used.push(node.style.borderColor);
  }

  const ranked = [...tally(used).entries()]
    .filter(([, count]) => count >= MIN_USES)
    .sort((a, b) => b[1] - a[1]);

  const names = ["primary", "secondary", "tertiary", "quaternary"];
  return ranked.map(([value, usageCount], index) => ({
    name: `colors.${names[index] ?? `accent-${index + 1}`}`,
    category: "color" as const,
    value,
    source: "inferred" as const,
    usageCount,
  }));
}

const TYPE_SCALE = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"];

/** Type styles are keyed by size, ascending, so names stay stable across imports. */
function typographyTokens(nodes: IrNode[]): DesignToken[] {
  const styles = nodes
    .map((node) => node.typography)
    .filter((typography): typography is NonNullable<typeof typography> => Boolean(typography));

  const grouped = new Map<string, { count: number; value: NonNullable<IrNode["typography"]> }>();
  for (const style of styles) {
    const key = `${style.fontFamily}|${style.fontSize}|${style.fontWeight}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { count: 1, value: style });
  }

  return [...grouped.values()]
    .filter((entry) => entry.count >= MIN_USES)
    .sort((a, b) => a.value.fontSize - b.value.fontSize)
    .map((entry, index) => ({
      name: `typography.${TYPE_SCALE[index] ?? `size-${index}`}`,
      category: "typography" as const,
      value: {
        fontFamily: entry.value.fontFamily,
        fontSize: entry.value.fontSize,
        fontWeight: entry.value.fontWeight,
        lineHeight: entry.value.lineHeight,
        letterSpacing: entry.value.letterSpacing,
      },
      source: "inferred" as const,
      usageCount: entry.count,
    }));
}

const SPACING_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"];

function spacingTokens(nodes: IrNode[]): DesignToken[] {
  const values: number[] = [];
  for (const node of nodes) {
    if (node.layout.gap > 0) values.push(node.layout.gap);
    const { padding } = node.layout;
    for (const side of [padding.top, padding.right, padding.bottom, padding.left]) {
      if (side > 0) values.push(side);
    }
  }

  return [...tally(values).entries()]
    .filter(([, count]) => count >= MIN_USES)
    .sort((a, b) => a[0] - b[0])
    .map(([value, usageCount], index) => ({
      name: `spacing.${SPACING_NAMES[index] ?? `step-${index}`}`,
      category: "spacing" as const,
      value,
      source: "inferred" as const,
      usageCount,
    }));
}

function radiusTokens(nodes: IrNode[]): DesignToken[] {
  const values = nodes
    .map((node) => node.style.borderRadius)
    .filter((radius): radius is number => typeof radius === "number" && radius > 0);

  const names = ["sm", "md", "lg", "xl", "2xl", "full"];
  return [...tally(values).entries()]
    .filter(([, count]) => count >= MIN_USES)
    .sort((a, b) => a[0] - b[0])
    .map(([value, usageCount], index) => ({
      name: `radius.${names[index] ?? `step-${index}`}`,
      category: "radius" as const,
      value,
      source: "inferred" as const,
      usageCount,
    }));
}

function shadowTokens(nodes: IrNode[]): DesignToken[] {
  const shadows = nodes.flatMap((node) =>
    node.style.effects
      .filter((effect) => effect.type === "drop_shadow")
      .map((effect) => `${effect.x ?? 0}px ${effect.y ?? 0}px ${effect.blur ?? 0}px ${effect.spread ?? 0}px ${effect.color ?? "rgba(0,0,0,0.1)"}`),
  );

  const names = ["sm", "md", "lg", "xl"];
  return [...tally(shadows).entries()]
    .filter(([, count]) => count >= MIN_USES)
    .sort((a, b) => b[1] - a[1])
    .map(([value, usageCount], index) => ({
      name: `shadow.${names[index] ?? `step-${index}`}`,
      category: "shadow" as const,
      value,
      source: "inferred" as const,
      usageCount,
    }));
}

export function extractTokens(nodes: Record<string, IrNode>): DesignToken[] {
  const list = Object.values(nodes);
  return [
    ...colorTokens(list),
    ...typographyTokens(list),
    ...spacingTokens(list),
    ...radiusTokens(list),
    ...shadowTokens(list),
  ];
}
