import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import type { Database, Row } from "./db.js";
import { one } from "./db.js";
import { need, type Actor } from "./accounting.js";
import type { Request, Response } from "express";
export const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function verifyPassword(
  password: string,
  stored: string
) {
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(password, salt, 64), expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function login(
  db: Database,
  res: Response,
  user: Row
) {
  const token = randomBytes(32).toString("hex"), csrf = randomBytes(24).toString("hex");
  await db.query(
    "INSERT INTO sessions(id,user_id,csrf,expires_at) VALUES($1,$2,$3,$4)",
    [digest(token), user.id, csrf, new Date(Date.now() + 12 * 3600000).toISOString()]
  );
  res.cookie(
    "accounts_session",
    token,
    {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 12 * 3600000,
    path: "/"
  }
  );
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role }, csrf };
}
export function tokenFrom(req: Request) {
  return (req.headers.cookie || "").split(";").map(s => s.trim()).find(s => s.startsWith("accounts_session="))?.slice(17);
}
export async function authenticate(
  db: Database,
  req: Request
) { const token = tokenFrom(req); if (!token)
  return null; return one(
    db,
    "SELECT u.id,u.name,u.email,u.role,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now() AND u.active=true",
    [digest(token)]
  ); }
export function writer(actor: Actor) {
  need(actor.role !== "VIEWER", "Your role is read-only.", 403);
}
export function admin(actor: Actor) {
  need(actor.role === "ADMIN", "Administrator permission required.", 403);
}
