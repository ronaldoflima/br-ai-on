import crypto from "crypto";

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_MAX_AGE_S = 60 * 60 * 24; // 24 hours

interface SessionPayload {
  /** random session id */
  sid: string;
  /** issued-at (unix seconds) */
  iat: number;
  /** expiration (unix seconds) */
  exp: number;
}

function hmacSign(data: string): string {
  return crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
}

/**
 * Create a signed session token.
 * Format: base64(json payload).hmac
 */
export function createSessionToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sid: crypto.randomUUID(),
    iat: now,
    exp: now + SESSION_MAX_AGE_S,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmacSign(encoded);
  return `${encoded}.${signature}`;
}

/**
 * Validate a signed session token.
 * Returns true if signature is valid and token has not expired.
 */
export function validateSessionToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [encoded, signature] = parts;
  const expectedSignature = hmacSign(encoded);

  // Constant-time comparison to prevent timing attacks
  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(
      Buffer.from(signature, "utf-8"),
      Buffer.from(expectedSignature, "utf-8"),
    )
  ) {
    return false;
  }

  try {
    const payload: SessionPayload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf-8"),
    );
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) return false;
    if (!payload.sid) return false;
    return true;
  } catch {
    return false;
  }
}
