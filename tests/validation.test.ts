import { describe, expect, it } from "vitest";
import {
  createProjectSchema, fieldErrors, figmaUrlSchema, passwordSchema, signUpSchema, toSlug,
} from "@/lib/validation/schemas";

describe("validation schemas", () => {
  it("rejects a password that is long but has no number or symbol", () => {
    expect(passwordSchema.safeParse("abcdefghijkl").success).toBe(false);
    expect(passwordSchema.safeParse("abcdefghij1").success).toBe(true);
  });

  it("rejects short passwords", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
  });

  it("trims and validates sign-up input", () => {
    const result = signUpSchema.safeParse({
      fullName: "  Tanvir Ahmad  ",
      email: " tanvir@basalt.studio ",
      password: "correct-horse-1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fullName).toBe("Tanvir Ahmad");
      expect(result.data.email).toBe("tanvir@basalt.studio");
    }
  });

  it("applies project defaults so a bare name is enough", () => {
    const result = createProjectSchema.safeParse({ name: "Northwind" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.framework).toBe("nextjs");
      expect(result.data.styling).toBe("tailwind");
      expect(result.data.typescript).toBe(true);
    }
  });

  it("accepts real Figma URLs and rejects lookalikes", () => {
    expect(figmaUrlSchema.safeParse("https://figma.com/design/8kQ2/Northwind").success).toBe(true);
    expect(figmaUrlSchema.safeParse("https://www.figma.com/file/8kQ2/Northwind").success).toBe(true);
    expect(figmaUrlSchema.safeParse("https://figma.com.evil.test/design/8kQ2/X").success).toBe(false);
    expect(figmaUrlSchema.safeParse("https://example.com/design/8kQ2").success).toBe(false);
  });

  it("reports one message per field", () => {
    const result = signUpSchema.safeParse({ fullName: "", email: "nope", password: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(Object.keys(errors).sort()).toEqual(["email", "fullName", "password"]);
    }
  });
});

describe("toSlug", () => {
  it("produces a URL-safe slug with a disambiguating suffix", () => {
    const slug = toSlug("Northwind Marketing Site!");
    expect(slug).toMatch(/^northwind-marketing-site-[a-z0-9]{4}$/);
  });

  it("falls back when the name has no usable characters", () => {
    expect(toSlug("!!!")).toMatch(/^project-[a-z0-9]{4}$/);
  });

  it("does not exceed the database length constraint", () => {
    expect(toSlug("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});
