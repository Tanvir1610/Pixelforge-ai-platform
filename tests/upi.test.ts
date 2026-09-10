import { afterEach, describe, expect, it } from "vitest";
import {
  buildUpiUri, getUpiPayee, isUpiConfigured, isValidUpiReference, isValidVpa,
  normaliseUpiReference, UpiNotConfiguredError, upiNoteFor,
} from "@/lib/payments/upi";

/**
 * UPI has no callback, so everything the application can get wrong here it gets
 * wrong silently: a malformed URI produces a QR that fails to open, and a
 * mis-scaled amount produces a hundredfold overcharge that nothing rejects.
 */

const PAYEE = { vpa: "someone@okhdfcbank", name: "A Payee Name" };

const originalVpa = process.env.UPI_PAYEE_VPA;
const originalName = process.env.UPI_PAYEE_NAME;

afterEach(() => {
  if (originalVpa === undefined) delete process.env.UPI_PAYEE_VPA;
  else process.env.UPI_PAYEE_VPA = originalVpa;
  if (originalName === undefined) delete process.env.UPI_PAYEE_NAME;
  else process.env.UPI_PAYEE_NAME = originalName;
});

describe("VPA validation", () => {
  it("accepts real-world UPI ids", () => {
    for (const vpa of ["someone@okhdfcbank", "user.name@oksbi", "abc-123@paytm", "a_b@ybl"]) {
      expect(isValidVpa(vpa), vpa).toBe(true);
    }
  });

  it("rejects anything that is not handle@psp", () => {
    for (const vpa of ["", "nohandle", "@psp", "user@", "user@@psp", "user @ok", "user@9psp"]) {
      expect(isValidVpa(vpa), vpa).toBe(false);
    }
  });
});

describe("payee configuration", () => {
  it("is absent until both variables are set", () => {
    delete process.env.UPI_PAYEE_VPA;
    delete process.env.UPI_PAYEE_NAME;
    expect(getUpiPayee()).toBeNull();
    expect(isUpiConfigured()).toBe(false);

    process.env.UPI_PAYEE_VPA = PAYEE.vpa;
    expect(getUpiPayee()).toBeNull();
  });

  it("reads both from the environment", () => {
    process.env.UPI_PAYEE_VPA = PAYEE.vpa;
    process.env.UPI_PAYEE_NAME = PAYEE.name;
    expect(getUpiPayee()).toEqual(PAYEE);
  });

  /** A typo here sends money to a VPA that may or may not exist. */
  it("refuses a malformed VPA rather than building a URI from it", () => {
    process.env.UPI_PAYEE_VPA = "not-a-vpa";
    process.env.UPI_PAYEE_NAME = PAYEE.name;
    expect(() => getUpiPayee()).toThrow(UpiNotConfiguredError);
    expect(isUpiConfigured()).toBe(false);
  });
});

describe("UPI intent", () => {
  it("puts the amount in rupees, not minor units", () => {
    const uri = buildUpiUri({ payee: PAYEE, amountMinor: 249_900, note: "x" });
    // 249900 paise is 2499.00 rupees. Sending "249900" would be a 100x charge.
    expect(uri).toContain("am=2499.00");
    expect(uri).not.toContain("am=249900");
  });

  it("always uses two decimal places", () => {
    expect(buildUpiUri({ payee: PAYEE, amountMinor: 100, note: "x" })).toContain("am=1.00");
    expect(buildUpiUri({ payee: PAYEE, amountMinor: 150, note: "x" })).toContain("am=1.50");
  });

  it("carries the payee, currency and note", () => {
    const uri = buildUpiUri({ payee: PAYEE, amountMinor: 100, note: "PixelForge Pro abcd1234" });
    expect(uri.startsWith("upi://pay?")).toBe(true);
    expect(uri).toContain(`pa=${encodeURIComponent(PAYEE.vpa)}`);
    expect(uri).toContain("cu=INR");
    expect(uri).toContain("PixelForge");
  });

  /** URLSearchParams encodes a space as "+", which some UPI apps take literally. */
  it("percent-encodes spaces rather than using plus", () => {
    const uri = buildUpiUri({ payee: PAYEE, amountMinor: 100, note: "two words" });
    expect(uri).toContain("%20");
    expect(uri).not.toContain("+");
  });

  it("refuses an amount that is not a positive integer", () => {
    for (const amount of [0, -100, 1.5, Number.NaN]) {
      expect(() => buildUpiUri({ payee: PAYEE, amountMinor: amount, note: "x" })).toThrow();
    }
  });

  it("keeps the note within the field's limit", () => {
    const uri = buildUpiUri({ payee: PAYEE, amountMinor: 100, note: "y".repeat(200) });
    const note = new URL(uri.replace("upi://", "https://")).searchParams.get("tn") ?? "";
    expect(note.length).toBeLessThanOrEqual(50);
  });

  it("builds a note that identifies the order", () => {
    expect(upiNoteFor("Pro", "abcd1234-0000-0000-0000-000000000000")).toContain("abcd1234");
  });
});

describe("UPI reference", () => {
  it("accepts a 12-digit UTR", () => {
    expect(isValidUpiReference("123456789012")).toBe(true);
  });

  /** Apps show it with labels and spacing; rejecting that is a bad checkout. */
  it("tolerates how payment apps present it", () => {
    for (const input of ["  123456789012 ", "UTR: 123456789012", "1234 5678 9012", "utr-123456789012"]) {
      expect(isValidUpiReference(input), input).toBe(true);
      expect(normaliseUpiReference(input)).toBe("123456789012");
    }
  });

  it("rejects the wrong length or non-digits", () => {
    for (const input of ["", "12345678901", "1234567890123", "12345678901a", "abcdefghijkl"]) {
      expect(isValidUpiReference(input), input).toBe(false);
    }
  });
});
