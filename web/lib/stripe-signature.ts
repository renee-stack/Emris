import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe-Signature check against the raw body. False when the header, secret, or timestamp is wrong. */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowMs = Date.now(),
  toleranceSec = 300,
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return false;
  if (Math.abs(nowMs / 1000 - seconds) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  return signatures.some((signature) => {
    if (!/^[0-9a-f]+$/i.test(signature) || signature.length !== expected.length) return false;
    const given = Buffer.from(signature, "hex");
    return given.length === expectedBuf.length && timingSafeEqual(given, expectedBuf);
  });
}
