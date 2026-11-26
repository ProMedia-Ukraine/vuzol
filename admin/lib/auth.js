// Passwords, sessions and login throttling for the VUZOL admin.

const ITERATIONS = 100000; // the maximum PBKDF2 iteration count Workers allow
const SESSION_DAYS = 14;
const MAX_FAILS = 8; // failed logins per IP ...
const FAIL_WINDOW = 15 * 60; // ... per 15 minutes
export const COOKIE = 'vuzol_admin';

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const now = () => Math.floor(Date.now() / 1000);

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2') return false;
  const bits = new Uint8Array(await pbkdf2(password, unb64(salt), Number(iter)));
  const expected = unb64(hash);
  if (bits.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Пароль має бути щонайменше 10 символів.';
  if (password.length > 200) return 'Пароль задовгий.';
  return null;
}

async function sha256(text) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function createSession(db, userId) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);
  const expires = now() + SESSION_DAYS * 86400;
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), userId, expires),
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(userId),
  ]);
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function readCookie(request) {
  const header = request.headers.get('Cookie') || '';
  const m = header.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

export async function currentUser(db, request) {
  const token = readCookie(request);
  if (!token) return null;
  return db
    .prepare(`SELECT u.id, u.login, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(await sha256(token), now())
    .first();
}

export async function dropSession(db, request) {
  const token = readCookie(request);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

export async function tooManyFails(db, ip) {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at > ?')
    .bind(ip, now() - FAIL_WINDOW)
    .first();
  return (row?.n || 0) >= MAX_FAILS;
}

export async function recordFail(db, ip) {
  await db.batch([
    db.prepare('DELETE FROM login_attempts WHERE at < ?').bind(now() - FAIL_WINDOW),
    db.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').bind(ip, now()),
  ]);
}

export async function clearFails(db, ip) {
  await db.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
}
