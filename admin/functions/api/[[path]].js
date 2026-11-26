// VUZOL admin API (Cloudflare Pages Function). All routes live under /api/.

import {
  hashPassword, verifyPassword, passwordProblem, createSession, sessionCookie, currentUser,
  dropSession, tooManyFails, recordFail, clearFails, COOKIE,
} from '../../lib/auth.js';
import { repoConfig, readBinary, deployStatus, GitHubError } from '../../lib/github.js';
import * as team from '../../lib/blocks/team.js';

// Editable site blocks. A new block = a new module in lib/blocks/ + a line here.
const BLOCKS = { team };

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
const fail = (message, status = 400) => json({ error: message }, status);

async function body(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function log(db, user, action, details) {
  await db.prepare('INSERT INTO audit_log (user_login, action, details) VALUES (?, ?, ?)')
    .bind(user?.login || null, action, details ? String(details).slice(0, 1000) : null).run();
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const db = env.DB;
  const route = '/' + [].concat(params.path || []).join('/');
  const method = request.method;
  const ip = request.headers.get('CF-Connecting-IP') || 'local';

  if (!db) return fail('База даних адмінки не підключена (DB).', 500);

  // Cross-site protection for anything that changes data.
  if (method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return fail('Запит з іншого сайту відхилено.', 403);
    if (!(request.headers.get('Content-Type') || '').includes('application/json')) return fail('Очікується JSON.', 415);
  }

  try {
    // ---- No login needed ----
    if (route === '/state' && method === 'GET') {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
      const user = await currentUser(db, request);
      return json({ needsSetup: !row.n, setupEnabled: Boolean(env.ADMIN_SETUP_CODE), user });
    }

    if (route === '/setup' && method === 'POST') {
      const row = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
      if (row.n) return fail('Перший адміністратор уже створений.', 403);
      if (!env.ADMIN_SETUP_CODE) return fail('Код першого входу не налаштований (ADMIN_SETUP_CODE).', 403);
      if (await tooManyFails(db, ip)) return fail('Забагато спроб. Зачекайте 15 хвилин.', 429);
      const b = await body(request);
      if (b.code !== env.ADMIN_SETUP_CODE) {
        await recordFail(db, ip);
        return fail('Невірний код першого входу.', 403);
      }
      const login = String(b.login || '').trim().toLowerCase();
      const name = String(b.name || '').trim();
      if (!/^[a-z0-9._-]{3,40}$/.test(login)) return fail('Логін: 3–40 латинських літер, цифр, крапок, дефісів.');
      if (!name) return fail('Вкажіть ім’я.');
      const problem = passwordProblem(b.password);
      if (problem) return fail(problem);
      const res = await db.prepare("INSERT INTO users (login, name, role, password_hash) VALUES (?, ?, 'admin', ?)")
        .bind(login, name, await hashPassword(b.password)).run();
      const { token, maxAge } = await createSession(db, res.meta.last_row_id);
      await log(db, { login }, 'setup', 'перший адміністратор');
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, maxAge) });
    }

    if (route === '/login' && method === 'POST') {
      if (await tooManyFails(db, ip)) return fail('Забагато невдалих спроб. Зачекайте 15 хвилин.', 429);
      const b = await body(request);
      const user = await db.prepare('SELECT id, login, password_hash FROM users WHERE login = ?')
        .bind(String(b.login || '').trim().toLowerCase()).first();
      if (!user || !(await verifyPassword(String(b.password || ''), user.password_hash))) {
        await recordFail(db, ip);
        return fail('Невірний логін або пароль.', 401);
      }
      await clearFails(db, ip);
      const { token, maxAge } = await createSession(db, user.id);
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, maxAge) });
    }

    if (route === '/logout' && method === 'POST') {
      await dropSession(db, request);
      return json({ ok: true }, 200, { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
    }

    // ---- Login required below ----
    const user = await currentUser(db, request);
    if (!user) return fail('Потрібно увійти.', 401);
    const cfg = repoConfig(env);

    if (route === '/me/password' && method === 'POST') {
      const b = await body(request);
      const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
      if (!(await verifyPassword(String(b.current || ''), row.password_hash))) return fail('Поточний пароль невірний.', 403);
      const problem = passwordProblem(b.password);
      if (problem) return fail(problem);
      await db.batch([
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(b.password), user.id),
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
      ]);
      const { token, maxAge } = await createSession(db, user.id);
      await log(db, user, 'password', 'змінив(-ла) свій пароль');
      return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, maxAge) });
    }

    if (route === '/blocks' && method === 'GET') {
      return json({ blocks: Object.entries(BLOCKS).map(([id, b]) => ({ id, title: b.title })) });
    }

    const blockMatch = route.match(/^\/blocks\/([a-z0-9-]+)$/);
    if (blockMatch && BLOCKS[blockMatch[1]]) {
      const block = BLOCKS[blockMatch[1]];
      if (method === 'GET') return json(await block.load(cfg));
      if (method === 'PUT') {
        const result = await block.save(cfg, await body(request), user);
        await log(db, user, `save:${blockMatch[1]}`, result.summary);
        return json(result);
      }
    }

    const photoMatch = route.match(/^\/photo\/team\/([a-z0-9-]+\.jpg)$/);
    if (photoMatch && method === 'GET') {
      const bytes = await readBinary(cfg, `content/team/${photoMatch[1]}`);
      if (!bytes) return fail('Фото не знайдено.', 404);
      return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
    }

    if (route === '/deploy-status' && method === 'GET') {
      try {
        return json({ run: await deployStatus(cfg) });
      } catch {
        return json({ run: null });
      }
    }

    if (route === '/log' && method === 'GET') {
      const { results } = await db.prepare('SELECT at, user_login, action, details FROM audit_log ORDER BY id DESC LIMIT 50').all();
      return json({ log: results });
    }

    // ---- Admins only ----
    if (route.startsWith('/users')) {
      if (user.role !== 'admin') return fail('Лише для адміністраторів.', 403);

      if (route === '/users' && method === 'GET') {
        const { results } = await db.prepare('SELECT id, login, name, role, created_at, last_login_at FROM users ORDER BY name').all();
        return json({ users: results });
      }
      if (route === '/users' && method === 'POST') {
        const b = await body(request);
        const login = String(b.login || '').trim().toLowerCase();
        const name = String(b.name || '').trim();
        const role = b.role === 'admin' ? 'admin' : 'editor';
        if (!/^[a-z0-9._-]{3,40}$/.test(login)) return fail('Логін: 3–40 латинських літер, цифр, крапок, дефісів.');
        if (!name) return fail('Вкажіть ім’я.');
        const problem = passwordProblem(b.password);
        if (problem) return fail(problem);
        const exists = await db.prepare('SELECT 1 FROM users WHERE login = ?').bind(login).first();
        if (exists) return fail('Такий логін уже є.');
        await db.prepare('INSERT INTO users (login, name, role, password_hash) VALUES (?, ?, ?, ?)')
          .bind(login, name, role, await hashPassword(b.password)).run();
        await log(db, user, 'user:add', `${login} (${role})`);
        return json({ ok: true });
      }
      const m = route.match(/^\/users\/(\d+)(\/password)?$/);
      if (m) {
        const id = Number(m[1]);
        const target = await db.prepare('SELECT id, login, role FROM users WHERE id = ?').bind(id).first();
        if (!target) return fail('Користувача не знайдено.', 404);
        if (m[2] && method === 'POST') {
          const b = await body(request);
          const problem = passwordProblem(b.password);
          if (problem) return fail(problem);
          await db.batch([
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(b.password), id),
            db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
          ]);
          await log(db, user, 'user:password', target.login);
          return json({ ok: true });
        }
        if (!m[2] && method === 'DELETE') {
          if (id === user.id) return fail('Не можна видалити самого себе.');
          if (target.role === 'admin') {
            const admins = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
            if (admins.n <= 1) return fail('Це останній адміністратор.');
          }
          await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
          await log(db, user, 'user:delete', target.login);
          return json({ ok: true });
        }
      }
    }

    return fail('Не знайдено.', 404);
  } catch (e) {
    if (e instanceof GitHubError && e.status < 500 && e.status !== 401 && e.status !== 403 && e.status !== 404) {
      return fail(e.message, e.status);
    }
    console.error(e);
    const message = e instanceof GitHubError && e.status === 500 ? e.message : 'Помилка на сервері. Спробуйте ще раз або напишіть Андрію.';
    return fail(message, 500);
  }
}
