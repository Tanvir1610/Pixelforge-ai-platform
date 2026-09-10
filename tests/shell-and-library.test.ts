import { describe, expect, it } from "vitest";
import { creditsResetLabel, initialsFrom } from "@/lib/presenters/shell";
import { assetTotals, deploymentStatus, relativeTime } from "@/lib/repositories/library";
import type { AssetItem } from "@/types";

/**
 * The dashboard chrome and the library screens rendered fixed sample data
 * regardless of who was signed in. These cover the pure parts of what replaced
 * it — the derivations that decide what a real account is told about itself.
 */

describe("avatar initials", () => {
  /** Every account used to get a hardcoded "TA". */
  it("uses the first and last initial of a full name", () => {
    expect(initialsFrom("Tanvir Ahmad Vhora", "x@y.com")).toBe("TV");
    expect(initialsFrom("Ada Lovelace", "x@y.com")).toBe("AL");
  });

  it("uses the first two letters of a single name", () => {
    expect(initialsFrom("Prince", "x@y.com")).toBe("PR");
  });

  it("falls back to the email when there is no name", () => {
    expect(initialsFrom(null, "vhoratanvir1610@gmail.com")).toBe("VH");
    expect(initialsFrom("   ", "sam@example.com")).toBe("SA");
  });

  it("never returns an empty string", () => {
    expect(initialsFrom(null, "")).toBe("?");
  });
});

describe("credits reset date", () => {
  /**
   * Usage is summed from the first of the current month, so the reset date is
   * the first of the next one. Derived from the same rule rather than stated
   * separately, so the bar and the date beside it cannot disagree.
   */
  it("is the first of the following month", () => {
    expect(creditsResetLabel(new Date(2026, 8, 10))).toBe("1 October");
    expect(creditsResetLabel(new Date(2026, 0, 31))).toBe("1 February");
  });

  it("rolls over the year", () => {
    expect(creditsResetLabel(new Date(2026, 11, 15))).toBe("1 January");
  });
});

describe("deployment status", () => {
  it("maps run statuses onto the three the list renders", () => {
    expect(deploymentStatus("completed")).toBe("ready");
    expect(deploymentStatus("failed")).toBe("failed");
    expect(deploymentStatus("cancelled")).toBe("failed");
    expect(deploymentStatus("running")).toBe("building");
    expect(deploymentStatus("queued")).toBe("building");
  });

  /** An unknown status must not read as a successful deploy. */
  it("does not report an unknown status as ready", () => {
    expect(deploymentStatus("something-new")).not.toBe("ready");
  });
});

describe("relative time", () => {
  const now = new Date("2026-09-10T12:00:00Z").getTime();

  it("describes recent events in the units the screen uses", () => {
    expect(relativeTime("2026-09-10T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-09-10T11:58:00Z", now)).toBe("2m ago");
    expect(relativeTime("2026-09-10T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-09-08T12:00:00Z", now)).toBe("2d ago");
  });

  /** Clock skew must not produce "-3m ago". */
  it("clamps a future timestamp rather than going negative", () => {
    expect(relativeTime("2026-09-10T12:05:00Z", now)).toBe("just now");
  });
});

describe("asset totals", () => {
  const assets: AssetItem[] = [
    { id: "1", name: "hero.jpg", kind: "Image", bytes: 400_000, uses: 2, needsOptimising: true },
    { id: "2", name: "logo.svg", kind: "SVG", bytes: 4_000, uses: 9 },
  ];

  it("sums what is actually there", () => {
    const totals = assetTotals(assets);
    expect(totals.count).toBe(2);
    expect(totals.bytes).toBe(404_000);
  });

  it("only estimates a saving on files that need optimising", () => {
    const totals = assetTotals(assets);
    // 400,000 * 0.65 + 4,000 — the SVG is already as small as it gets.
    expect(totals.optimisedBytes).toBe(264_000);
    expect(totals.optimisedBytes).toBeLessThan(totals.bytes);
  });

  it("reports zeroes for an empty workspace rather than dividing by nothing", () => {
    expect(assetTotals([])).toEqual({ count: 0, bytes: 0, optimisedBytes: 0 });
  });
});
