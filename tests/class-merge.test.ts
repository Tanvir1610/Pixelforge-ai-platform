import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";

/**
 * `cn` must not let a font size eat a text colour.
 *
 * tailwind-merge knows the default `text-sm` / `text-lg` scale and treats any
 * other `text-*` as a colour. This project's scale is custom — `text-body-sm`,
 * `text-caption` — so those looked like colours, and because the button recipe
 * appends the size after the variant, they removed `text-white` from every
 * button at size xs, sm and md.
 *
 * Nothing failed and nothing warned: the button simply had no colour class and
 * inherited the page's near-black body text, so a white label on a black button
 * became black on black. The "Import" and "Upgrade" controls rendered as solid
 * rectangles with no visible text at all.
 */
describe("class merging", () => {
  it("keeps a text colour when a custom font size follows it", () => {
    const merged = cn("text-white", "text-body-sm");
    expect(merged).toContain("text-white");
    expect(merged).toContain("text-body-sm");
  });

  it("keeps both for every size in the scale", () => {
    for (const size of ["display", "h1", "h2", "h3", "body-lg", "body", "body-sm", "caption", "code"]) {
      const merged = cn("text-white", `text-${size}`);
      expect(merged, `text-${size} dropped the colour`).toContain("text-white");
    }
  });

  it("still collapses two genuinely conflicting colours", () => {
    expect(cn("text-white", "text-content")).not.toContain("text-white");
  });

  it("still collapses two genuinely conflicting sizes", () => {
    const merged = cn("text-body", "text-caption");
    expect(merged).toContain("text-caption");
    expect(merged).not.toContain("text-body ");
  });
});

describe("button recipe", () => {
  /** The regression, at the level the user actually sees it. */
  it("gives every dark and primary button a visible label colour", () => {
    for (const size of ["xs", "sm", "md", "lg"] as const) {
      expect(buttonClasses("dark", size), `dark/${size} has no text colour`).toContain("text-white");
      expect(buttonClasses("primary", size), `primary/${size} has no text colour`).toContain("text-white");
      expect(buttonClasses("danger", size), `danger/${size} has no text colour`).toContain("text-white");
    }
  });

  it("keeps the size class as well as the colour", () => {
    expect(buttonClasses("dark", "sm")).toContain("text-body-sm");
    expect(buttonClasses("dark", "md")).toContain("text-body");
  });

  it("lets a caller override the colour deliberately", () => {
    expect(buttonClasses("dark", "md", "text-accent")).not.toContain("text-white");
  });
});
