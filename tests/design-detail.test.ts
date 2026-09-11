import { describe, expect, it } from "vitest";
import {
  baseUnit, describeLayout, summariseInteractions, summariseResponsive,
  type BehaviourRow, type LayoutRow,
} from "@/lib/repositories/design-detail";
import { toWorkspaceProject } from "@/lib/presenters/project";
import type { ProjectRow } from "@/lib/db/database.types";

/**
 * The understanding screen's layout, interaction, responsive and asset panels
 * were hard-coded fixtures. These cover the readers that replaced them — in
 * particular that an absence stays an absence, which is the whole point.
 */
function layoutRow(overrides: Partial<LayoutRow> = {}): LayoutRow {
  return {
    id: "n1", name: "Hero", ir_type: "frame", semantic_role: null, depth: 1,
    parent_id: "root", order_index: 0, y: 0, width: 1440, height: 520,
    layout_mode: null, layout_gap: null,
    padding_top: null, padding_right: null, padding_bottom: null, padding_left: null,
    align_items: null, justify_content: null, sizing_vertical: null,
    font_size: null, line_height: null,
    ...overrides,
  };
}

function behaviourRow(overrides: Partial<BehaviourRow> = {}): BehaviourRow {
  return { id: "n1", name: "Button", semantic_role: "button", interactions: [], responsive_hints: null, ...overrides };
}

describe("describeLayout", () => {
  it("reports auto layout the way a developer would ask for it", () => {
    expect(
      describeLayout(layoutRow({ layout_mode: "vertical", layout_gap: 24, padding_top: 96, padding_bottom: 96, padding_left: 80, padding_right: 80 })),
    ).toBe("vertical, gap 24 · padding 96 80");
  });

  it("writes all four sides when the padding is not symmetric", () => {
    expect(
      describeLayout(layoutRow({ padding_top: 10, padding_right: 20, padding_bottom: 30, padding_left: 40 })),
    ).toBe("padding 10 20 30 40");
  });

  it("gives the frame's dimensions at the root and not below it", () => {
    expect(describeLayout(layoutRow({ depth: 0, width: 1440, height: 3820 }))).toContain("1440 × 3820");
    expect(describeLayout(layoutRow({ depth: 1, width: 1440, height: 520 }))).not.toContain("1440 ×");
  });

  it("reports type as size over leading", () => {
    expect(describeLayout(layoutRow({ font_size: 64, line_height: 68 }))).toBe("64/68");
  });

  it("omits a gap of zero rather than writing 'gap 0'", () => {
    expect(describeLayout(layoutRow({ layout_mode: "horizontal", layout_gap: 0 }))).toBe("horizontal");
  });

  /** A node with nothing set describes nothing, rather than inventing detail. */
  it("says nothing about a node that has nothing to say", () => {
    expect(describeLayout(layoutRow())).toBe("");
  });
});

describe("baseUnit", () => {
  it("finds the scale a 4px design is built on", () => {
    expect(baseUnit([4, 8, 12, 16, 24, 32, 80])).toBe(4);
  });

  it("finds a coarser scale when the design uses one", () => {
    expect(baseUnit([8, 16, 24, 48])).toBe(8);
  });

  /** Arbitrary values have no rhythm, and "base unit 1px" would be noise. */
  it("reports nothing when the values share no meaningful divisor", () => {
    expect(baseUnit([7, 13, 22])).toBeNull();
  });

  it("reports nothing from a single value, which cannot establish a scale", () => {
    expect(baseUnit([16])).toBeNull();
  });
});

describe("summariseInteractions", () => {
  it("collects the triggers found on a node", () => {
    const summary = summariseInteractions([
      behaviourRow({
        name: "Primary button",
        interactions: [{ trigger: "hover" }, { trigger: "press" }, { trigger: "focus" }],
      }),
    ]);

    expect(summary).toHaveLength(1);
    expect(summary[0].triggers).toEqual(["hover", "press", "focus"]);
    expect(summary[0].inferred).toBe(false);
  });

  it("marks a node inferred only when every interaction on it was", () => {
    // Looked up by name, because the summary is ordered richest-first rather
    // than in the order the rows arrived.
    const summary = summariseInteractions([
      behaviourRow({ id: "a", name: "Input", interactions: [{ trigger: "focus", inferred: true }] }),
      behaviourRow({
        id: "b", name: "Link",
        interactions: [{ trigger: "hover", inferred: true }, { trigger: "click" }],
      }),
    ]);
    const find = (label: string) => summary.find((entry) => entry.label === label)!;

    expect(find("Input").inferred).toBe(true);
    expect(find("Link").inferred).toBe(false);
    // Richest first: Link has two triggers, Input one.
    expect(summary.map((entry) => entry.label)).toEqual(["Link", "Input"]);
  });

  it("keeps one row per element, the richest example of each", () => {
    const summary = summariseInteractions([
      behaviourRow({ id: "a", name: "Button", interactions: [{ trigger: "hover" }] }),
      behaviourRow({ id: "b", name: "Button", interactions: [{ trigger: "hover" }, { trigger: "focus" }] }),
    ]);

    expect(summary).toHaveLength(1);
    expect(summary[0].triggers).toHaveLength(2);
  });

  /**
   * The fixture listed four interaction rows for every design. A static frame
   * genuinely has none, and saying so is the correct answer.
   */
  it("returns nothing for a design with no interactions", () => {
    expect(summariseInteractions([behaviourRow(), behaviourRow({ id: "b" })])).toEqual([]);
  });

  it("ignores a malformed interactions value rather than throwing", () => {
    expect(summariseInteractions([behaviourRow({ interactions: "not an array" as never })])).toEqual([]);
    expect(summariseInteractions([behaviourRow({ interactions: [{}] as never })])).toEqual([]);
  });
});

describe("summariseResponsive", () => {
  it("reads a column collapse widest-first", () => {
    const [rule] = summariseResponsive([
      behaviourRow({
        name: "Feature grid",
        responsive_hints: { columnsByBreakpoint: { 390: 1, 1440: 3, 768: 2 } },
      }),
    ]);

    expect(rule.rule).toBe("3 → 2 → 1 columns");
    expect(rule.derived).toBe(true);
  });

  it("reports a hidden-below rule with its width", () => {
    const [rule] = summariseResponsive([
      behaviourRow({ name: "Sidebar", responsive_hints: { hiddenBelowWidth: 768 } }),
    ]);
    expect(rule.rule).toBe("Hidden below 768px");
  });

  it("reports a collapse rule with its width", () => {
    const [rule] = summariseResponsive([
      behaviourRow({ name: "Navbar", responsive_hints: { collapsesAtWidth: 700 } }),
    ]);
    expect(rule.rule).toBe("Collapses below 700px");
  });

  it("returns nothing when the design carries no hints", () => {
    expect(summariseResponsive([behaviourRow(), behaviourRow({ id: "b" })])).toEqual([]);
  });

  it("ignores a single-entry column map, which describes no change", () => {
    expect(
      summariseResponsive([behaviourRow({ responsive_hints: { columnsByBreakpoint: { 1440: 3 } } })]),
    ).toEqual([]);
  });
});

/**
 * The workspace screens built their view model as `{ ...sampleProject, id, name }`,
 * so a user's project reported the fixture's framework, styling and 97% match.
 */
describe("toWorkspaceProject", () => {
  const row: ProjectRow = {
    id: "p1", organization_id: "o1", name: "Acme site", slug: "acme-site",
    description: null, status: "draft", framework: "vue", styling: "vanilla_css",
    typescript: false, responsive: true, host_provider: "none", match_score: null,
    thumbnail_path: null, created_by: "u1",
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", deleted_at: null,
  };

  it("uses the project's own framework and styling", () => {
    const project = toWorkspaceProject(row);
    expect(project.framework).toBe("Vue");
    expect(project.styling).toBe("Vanilla CSS");
  });

  /** The fixture supplied 97, which was then rendered as a measured result. */
  it("has no match score until something measured one", () => {
    expect(toWorkspaceProject(row).matchScore).toBeUndefined();
    expect(toWorkspaceProject({ ...row, match_score: 84.4 }).matchScore).toBe(84);
  });

  it("does not borrow the sample's tagline as a description", () => {
    expect(toWorkspaceProject(row).headline).toBe("");
    expect(toWorkspaceProject({ ...row, description: "Our site" }).headline).toBe("Our site");
  });

  it("describes what the project actually has", () => {
    expect(toWorkspaceProject(row).meta).toBe("No design imported yet");
    expect(toWorkspaceProject(row, { pages: 3 }).meta).toBe("3 frames imported · not generated");
    expect(toWorkspaceProject(row, { pages: 3, generatedFiles: 12 }).meta).toBe("12 files generated");
  });

  it("maps the statuses the view layer has no word for", () => {
    expect(toWorkspaceProject({ ...row, status: "analysing" }).status).toBe("generating");
    expect(toWorkspaceProject({ ...row, status: "importing" }).status).toBe("generating");
    expect(toWorkspaceProject({ ...row, status: "live" }).status).toBe("live");
  });
});
