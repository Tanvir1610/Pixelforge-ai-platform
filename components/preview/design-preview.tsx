import type { FramePreview, PreviewNode } from "@/lib/repositories/design-read";
import { cn } from "@/lib/utils";

/**
 * Draws the imported frame from its own geometry.
 *
 * The analysis screen used to show a fabricated marketing page while the
 * progress list beside it reported a real run. Everything here comes from
 * `design_nodes`: position, size, fill, radius and text, as ingested.
 *
 * It is a wireframe, not a rendering. Images, vectors, shadows and real fonts
 * are not reproduced, so it reads as a structural view rather than pretending
 * to be a screenshot — which is the honest thing for it to be, and stops anyone
 * mistaking it for visual QA.
 */
function nodeStyle(node: PreviewNode): React.CSSProperties {
  const isText = node.type === "text" && Boolean(node.text);

  return {
    position: "absolute",
    left: `${node.x}px`,
    top: `${node.y}px`,
    width: `${node.width}px`,
    height: `${node.height}px`,
    background: node.background ?? undefined,
    borderRadius: node.borderRadius ? `${node.borderRadius}px` : undefined,
    // A hairline stands in for an unpainted container, so structure stays
    // visible where the design has no fill of its own.
    boxShadow: node.borderColor
      ? `inset 0 0 0 1px ${node.borderColor}`
      : node.background
        ? undefined
        : "inset 0 0 0 1px rgba(17,17,17,.07)",
    color: isText ? (node.textColor ?? "#111") : undefined,
    fontSize: isText && node.fontSize ? `${node.fontSize}px` : undefined,
    fontWeight: isText && node.fontWeight ? node.fontWeight : undefined,
    lineHeight: isText ? 1.2 : undefined,
    overflow: "hidden",
    whiteSpace: isText ? "pre-wrap" : undefined,
  };
}

export function DesignPreview({
  frame,
  maxWidth = 900,
  maxHeight = 460,
  className,
}: {
  frame: FramePreview;
  maxWidth?: number;
  maxHeight?: number;
  className?: string;
}) {
  // Scaled to fit rather than sized in CSS, so every child keeps the exact
  // proportions it has in the file.
  const scale = Math.min(maxWidth / frame.width, maxHeight / frame.height, 1);

  return (
    <div
      className={cn("relative overflow-hidden rounded-md bg-white shadow-lg", className)}
      style={{ width: frame.width * scale, height: frame.height * scale }}
      role="img"
      aria-label={`Structural preview of the frame ${frame.name}, ${frame.width} by ${frame.height} pixels`}
    >
      <div
        style={{
          width: frame.width,
          height: frame.height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "relative",
        }}
      >
        {frame.nodes.map((node) => (
          <div key={node.id} style={nodeStyle(node)}>
            {node.type === "text" && node.text ? node.text.slice(0, 120) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
