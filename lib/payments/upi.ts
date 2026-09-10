/**
 * UPI collection.
 *
 * A plain VPA has no callback and no per-order identity, so this module does
 * only what UPI can honestly do: build a payment intent the payer's app can
 * open with the right amount already filled in, and validate the reference they
 * read back off it afterwards. Deciding whether money actually arrived is a
 * human step — see `verify_upi_payment` in migration 0017.
 */

export interface UpiPayee {
  vpa: string;
  name: string;
}

/**
 * A VPA is `handle@psp`.
 *
 * Checked because it goes into a payment URI: a malformed one produces a QR
 * that silently fails to open, or opens against the wrong payee.
 */
const VPA_PATTERN = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

export function isValidVpa(vpa: string): boolean {
  return VPA_PATTERN.test(vpa.trim());
}

export class UpiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpiNotConfiguredError";
  }
}

/**
 * The payee, from the environment.
 *
 * Never hardcoded: this repository is public, and a VPA plus an account holder's
 * legal name is exactly the pair that should not be in it. It also means moving
 * from a personal VPA to a merchant one is a setting rather than a deploy.
 */
export function getUpiPayee(): UpiPayee | null {
  const vpa = process.env.UPI_PAYEE_VPA?.trim();
  const name = process.env.UPI_PAYEE_NAME?.trim();

  if (!vpa || !name) return null;
  if (!isValidVpa(vpa)) {
    throw new UpiNotConfiguredError(`UPI_PAYEE_VPA is not a valid UPI id: "${vpa}".`);
  }
  return { vpa, name };
}

export function isUpiConfigured(): boolean {
  try {
    return getUpiPayee() !== null;
  } catch {
    return false;
  }
}

/**
 * Builds the `upi://pay` intent.
 *
 * Amount is in rupees with exactly two decimals, which is what the spec wants —
 * minor units here would be read as a hundredfold overcharge.
 *
 * The note carries our order id so the payment is traceable in a statement.
 * Most PSP apps show it, some truncate it, none guarantee it survives, which is
 * exactly why the reference is still collected from the payer afterwards.
 */
export function buildUpiUri(params: {
  payee: UpiPayee;
  amountMinor: number;
  note: string;
}): string {
  if (!Number.isInteger(params.amountMinor) || params.amountMinor <= 0) {
    throw new Error(`A UPI amount must be a positive integer in minor units, received ${params.amountMinor}.`);
  }

  const query = new URLSearchParams({
    pa: params.payee.vpa,
    pn: params.payee.name,
    am: (params.amountMinor / 100).toFixed(2),
    cu: "INR",
    tn: params.note.slice(0, 50),
  });

  // URLSearchParams encodes a space as "+", which some UPI apps take literally.
  return `upi://pay?${query.toString().replace(/\+/g, "%20")}`;
}

/**
 * A UPI reference (UTR/RRN) is 12 digits.
 *
 * Some apps show it with spaces or a "UTR:" prefix, so it is normalised before
 * the length is judged — rejecting a correct reference because it was pasted
 * with a label is a bad way to end a checkout.
 */
export function normaliseUpiReference(input: string): string {
  return input.trim().replace(/^utr[:\s-]*/i, "").replace(/[\s-]/g, "");
}

export function isValidUpiReference(input: string): boolean {
  return /^\d{12}$/.test(normaliseUpiReference(input));
}

/** Short, stable note for the payer's statement. */
export function upiNoteFor(planDisplayName: string, orderId: string): string {
  return `PixelForge ${planDisplayName} ${orderId.slice(0, 8)}`;
}
