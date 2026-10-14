import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import * as oidc from "openid-client";
import { db } from "./db";

export const SESSION_COOKIE = "sid";
export const FLOW_COOKIE = "oidc_flow";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type User = { sub: string; displayName: string };

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません`);
  return v;
}

export function appUrl(): URL {
  return new URL(env("APP_URL"));
}

export function redirectUri(): string {
  return new URL("/auth/callback", appUrl()).toString();
}

export function cookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: appUrl().protocol === "https:",
    path: "/",
    maxAge: maxAgeSec,
  };
}

let configPromise: Promise<oidc.Configuration> | undefined;
export function oidcConfig(): Promise<oidc.Configuration> {
  if (!configPromise) {
    const issuer = new URL(env("OIDC_ISSUER"));
    const options =
      issuer.protocol === "http:"
        ? { execute: [oidc.allowInsecureRequests] }
        : undefined;
    configPromise = oidc
      .discovery(issuer, env("OIDC_CLIENT_ID"), env("OIDC_CLIENT_SECRET"), undefined, options)
      .catch((e) => {
        configPromise = undefined; // 次回再試行できるようにする
        throw e;
      });
  }
  return configPromise;
}

const hash = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

/** ユーザーを upsert（sub で識別）し、セッションを発行して token を返す */
export function createSession(sub: string, displayName: string): string {
  const now = Date.now();
  const token = crypto.randomBytes(32).toString("base64url");
  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (sub, display_name, created_at) VALUES (?, ?, ?)
       ON CONFLICT(sub) DO UPDATE SET display_name = excluded.display_name`,
    ).run(sub, displayName, now);
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
    db.prepare(
      "INSERT INTO sessions (token_hash, sub, expires_at) VALUES (?, ?, ?)",
    ).run(hash(token), sub, now + SESSION_TTL_MS);
  })();
  return token;
}

export function sessionMaxAgeSec() {
  return SESSION_TTL_MS / 1000;
}

export function destroySession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash(token));
}

export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.sub AS sub, u.display_name AS displayName
       FROM sessions s JOIN users u ON u.sub = s.sub
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hash(token), Date.now()) as User | undefined;
  return row ?? null;
}

export async function requireUser(): Promise<User> {
  const user = await getUser();
  if (!user) redirect("/");
  return user;
}
