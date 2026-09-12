/**
 * Proofly — public application identifier helpers.
 *
 * `applicationId` is a PUBLIC claim-scoping input provided by the caller (the
 * verifier/issuer of the application, re-used across attempts for the same
 * application). It is the ONLY input to the on-chain nullifier — each
 * Application ID is single-use, regardless of threshold or income. There is no
 * private applicant identity.
 *
 * The circuit expects a fixed 32-byte `Bytes<32>` argument; free-form text is
 * encoded to exactly 32 bytes by UTF-8 + zero padding — the same bytes Compact's
 * `pad(32, str)` produces for an identifier.
 */
const APP_ID_BYTES = 32;

/** Encode a human-readable application id into the fixed 32-byte circuit argument. */
export function encodeApplicationId(applicationId: string): Uint8Array {
  const bytes = new TextEncoder().encode(applicationId);
  const out = new Uint8Array(APP_ID_BYTES);
  out.set(bytes.slice(0, APP_ID_BYTES));
  return out;
}

/** A claim requires a non-blank application id. */
export function isValidApplicationId(value: string): boolean {
  return value.trim().length > 0;
}