import type { FigmaFileResponse, FigmaNode } from "@/lib/figma/types";

/**
 * A small but realistic Figma file: one page, one 1440 desktop frame, with a
 * navbar, a hero and a three-card feature grid. Values mirror what the API
 * actually returns — absolute coordinates, 0–1 colour channels, auto layout.
 */
const white = { r: 1, g: 1, b: 1, a: 1 };
const ink = { r: 0.067, g: 0.067, b: 0.067, a: 1 };
const accent = { r: 0.388, g: 0.4, b: 0.945, a: 1 };
const border = { r: 0.898, g: 0.906, b: 0.922, a: 1 };

function text(
  id: string, name: string, x: number, y: number, width: number, height: number,
  size: number, weight: number, characters: string,
): FigmaNode {
  return {
    id, name, type: "TEXT",
    absoluteBoundingBox: { x, y, width, height },
    characters,
    fills: [{ type: "SOLID", color: ink }],
    style: {
      fontFamily: "Inter", fontSize: size, fontWeight: weight,
      lineHeightPx: Math.round(size * 1.2), letterSpacing: 0, textAlignHorizontal: "LEFT",
    },
    constraints: { horizontal: "LEFT", vertical: "TOP" },
  };
}

function card(id: string, x: number): FigmaNode {
  return {
    id, name: "Feature card", type: "FRAME",
    absoluteBoundingBox: { x, y: 700, width: 400, height: 180 },
    layoutMode: "VERTICAL", itemSpacing: 12,
    paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24,
    layoutSizingHorizontal: "FILL", layoutSizingVertical: "HUG",
    cornerRadius: 12,
    fills: [{ type: "SOLID", color: white }],
    strokes: [{ type: "SOLID", color: border }],
    strokeWeight: 1,
    effects: [{
      type: "DROP_SHADOW", visible: true, radius: 12, spread: -2,
      color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 4 },
    }],
    constraints: { horizontal: "LEFT", vertical: "TOP" },
    children: [
      text(id + "-title", "Card title", x + 24, 724, 200, 24, 18, 600, "Fast by default"),
      text(id + "-body", "Card body", x + 24, 760, 352, 40, 14, 400, "Static output, no runtime."),
    ],
  };
}

export const DESKTOP_FRAME: FigmaNode = {
  id: "1:2", name: "Home / Desktop", type: "FRAME",
  absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 1000 },
  layoutMode: "VERTICAL", itemSpacing: 0,
  fills: [{ type: "SOLID", color: white }],
  constraints: { horizontal: "LEFT", vertical: "TOP" },
  children: [
    {
      id: "1:3", name: "Navbar", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 64 },
      layoutMode: "HORIZONTAL", itemSpacing: 24,
      paddingTop: 0, paddingRight: 80, paddingBottom: 0, paddingLeft: 80,
      primaryAxisAlignItems: "SPACE_BETWEEN", counterAxisAlignItems: "CENTER",
      constraints: { horizontal: "LEFT_RIGHT", vertical: "TOP" },
      children: [
        text("1:4", "Logo", 80, 20, 120, 24, 16, 700, "Northwind"),
        text("1:5", "Nav link", 1100, 22, 60, 20, 14, 500, "Pricing"),
        text("1:6", "Nav link", 1180, 22, 60, 20, 14, 500, "Docs"),
      ],
    },
    {
      id: "1:7", name: "Hero", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 64, width: 1440, height: 520 },
      layoutMode: "VERTICAL", itemSpacing: 20,
      paddingTop: 96, paddingRight: 80, paddingBottom: 96, paddingLeft: 80,
      constraints: { horizontal: "LEFT_RIGHT", vertical: "TOP" },
      children: [
        text("1:8", "Heading", 80, 160, 800, 140, 64, 800, "Ship your ideas without the rebuild."),
        text("1:9", "Body", 80, 320, 600, 54, 17, 400, "Northwind turns field research into decisions."),
        {
          id: "1:10", name: "Get started", type: "FRAME",
          absoluteBoundingBox: { x: 80, y: 400, width: 160, height: 44 },
          layoutMode: "HORIZONTAL",
          paddingTop: 12, paddingRight: 20, paddingBottom: 12, paddingLeft: 20,
          cornerRadius: 8,
          fills: [{ type: "SOLID", color: accent }],
          constraints: { horizontal: "LEFT", vertical: "TOP" },
          children: [text("1:11", "Label", 100, 412, 120, 20, 14, 500, "Get started")],
        },
      ],
    },
    {
      id: "1:12", name: "Grid", type: "FRAME",
      absoluteBoundingBox: { x: 0, y: 660, width: 1440, height: 260 },
      layoutMode: "HORIZONTAL", itemSpacing: 24,
      paddingTop: 40, paddingRight: 80, paddingBottom: 40, paddingLeft: 80,
      constraints: { horizontal: "LEFT_RIGHT", vertical: "TOP" },
      children: [card("1:13", 80), card("1:14", 504), card("1:15", 928)],
    },
    {
      id: "1:16", name: "Hidden promo", type: "FRAME", visible: false,
      absoluteBoundingBox: { x: 0, y: 920, width: 1440, height: 80 },
      children: [text("1:17", "Promo", 80, 940, 200, 20, 14, 400, "Should not appear")],
    },
    {
      // Zero-area artifact Figma leaves behind; must be dropped. A full-width
      // 1px rule would be a divider and is deliberately NOT filtered.
      id: "1:18", name: "stray point", type: "RECTANGLE",
      absoluteBoundingBox: { x: 0, y: 999, width: 1, height: 1 },
      fills: [{ type: "SOLID", color: border }],
    },
  ],
};

export const FILE: FigmaFileResponse = {
  name: "Northwind",
  version: "3145",
  lastModified: "2026-01-01T09:00:00Z",
  document: {
    id: "0:0", name: "Document", type: "DOCUMENT",
    children: [{ id: "0:1", name: "Page 1", type: "CANVAS", children: [DESKTOP_FRAME] }],
  },
  components: {},
  styles: {},
};
