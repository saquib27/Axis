/**
 * Console authentication. Plain JWT — no third-party auth provider.
 *
 * Two primitives, both from node:crypto so there is no dependency to audit:
 *  - scrypt password hashing (salt:hash hex), constant-time compared on login
 *  - HS256 JWTs signed with JWT_SECRET, verified with a constant-time compare
 *
 * The money path never touches this. Auth gates who can BROWSE the console's
 * receipts, not who can spend — spending is still guarded by the signed quote
 * and the spend policy. So a weak session here can never move funds.
 */
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { AxisError } from "@axis/shared";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";

const b64url = (b: Buffer): string =>
  b.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const b64urlJson = (o: unknown): string => b64url(Buffer.from(JSON.stringify(o)));

/** scrypt hash as `salt:hash`, both hex. The cleartext is never stored. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Constant-time verify against a stored `salt:hash`. */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Sign an HS256 JWT valid for `ttlSeconds`. */
export function signJwt(payload: Record<string, unknown>, secret: string, ttlSeconds = 7 * 24 * 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson({ ...payload, iat: now, exp: now + ttlSeconds });
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

/** Verify an HS256 JWT. Returns the claims, or null on any tamper/expiry. */
export function verifyJwt(token: string, secret: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  const a = Buffer.from(sig!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body!, "base64").toString()) as Record<string, unknown>;
    if (typeof claims.exp === "number" && claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface AuthResult {
  token: string;
  /** Per-account API key — the console stores it and the extension uses it to
   *  see only this account's runs/receipts. */
  apiKey: string;
  user: { id: string; email: string };
}

/** A fresh account API key. Prefixed so it's obvious what it is if it leaks. */
const newApiKey = (): string => `axis_${randomBytes(24).toString("hex")}`;

export async function signup(email: string, password: string, databaseUrl: string, secret: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase();
  if (!EMAIL.test(e)) throw new AxisError("INVALID_INPUT", "a valid email is required");
  if (password.length < 8) throw new AxisError("INVALID_INPUT", "password must be at least 8 characters");
  const database = db(databaseUrl);
  const existing = (await database.select().from(users).where(eq(users.email, e)))[0];
  if (existing) throw new AxisError("EMAIL_TAKEN", "an account with this email already exists");
  const id = `usr_${randomUUID().slice(0, 12)}`;
  const apiKey = newApiKey();
  await database.insert(users).values({ id, email: e, passwordHash: hashPassword(password), apiKey });
  return { token: signJwt({ sub: id, email: e }, secret), apiKey, user: { id, email: e } };
}

export async function login(email: string, password: string, databaseUrl: string, secret: string): Promise<AuthResult> {
  const e = email.trim().toLowerCase();
  const database = db(databaseUrl);
  const user = (await database.select().from(users).where(eq(users.email, e)))[0];
  // Same error whether the email is unknown or the password is wrong — never
  // leak which accounts exist.
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AxisError("INVALID_CREDENTIALS", "email or password is incorrect");
  }
  // Backfill an API key for accounts created before keys existed.
  let apiKey = user.apiKey;
  if (!apiKey) {
    apiKey = newApiKey();
    await database.update(users).set({ apiKey }).where(eq(users.id, user.id));
  }
  return { token: signJwt({ sub: user.id, email: e }, secret), apiKey, user: { id: user.id, email: e } };
}

/**
 * Who does this API key belong to? A key spends real USDC, so any client
 * acting on it — the console, the extension, an MCP agent like Claude — must
 * be able to say WHOSE money it is about to move. Returns null for an unknown
 * key, which is also how a caller tells a bad key from a merely empty account.
 */
export async function accountForKey(apiKey: string, databaseUrl: string): Promise<{ id: string; email: string } | null> {
  const row = (await db(databaseUrl).select({ id: users.id, email: users.email })
    .from(users).where(eq(users.apiKey, apiKey)))[0];
  return row ?? null;
}
