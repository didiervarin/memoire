// ---------------------------------------------------------------------------
// Mémoire — fiches de révision FSRS
// Accès protégé par un mot de passe unique, stocké comme secret Cloudflare
// (MEMOIRE_PASSWORD), jamais dans le code.
// ---------------------------------------------------------------------------
const SESSION_DAYS = 365;
const MAX_ATTEMPTS = 8;           // essais de mot de passe ratés…
const ATTEMPT_WINDOW = 15 * 60e3; // …par fenêtre de 15 minutes
const MAX_LIB_BYTES = 1_900_000;  // limite D1 : 2 Mo par ligne
const ID_RE = /^[a-z0-9]{3,40}$/;

// Schéma D1 : créé automatiquement au premier appel.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS libs (id TEXT PRIMARY KEY, data TEXT NOT NULL,
     created INTEGER NOT NULL, updated INTEGER NOT NULL)`,
];
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
const err = (message, status = 400) => json({ error: message }, status);

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
async function isLoggedIn(request, env) {
  const token = getCookie(request, 'sid');
  if (!token) return false;
  const row = await env.DB.prepare(`SELECT expires_at FROM sessions WHERE token = ?`).bind(token).first();
  return !!row && row.expires_at > Date.now();
}

function sessionCookie(token, maxAge) {
  return `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function login(request, env) {
  const body = (await readJson(request)) || {};
  const password = String(body.password || '');
  const expected = env.MEMOIRE_PASSWORD;
  if (!expected) return err('Mot de passe non configuré (secret MEMOIRE_PASSWORD manquant)', 500);

  const now = Date.now();
  await env.DB.prepare(`DELETE FROM login_attempts WHERE at < ?`).bind(now - ATTEMPT_WINDOW).run();
  const { n } = await env.DB.prepare(`SELECT COUNT(*) AS n FROM login_attempts`).first();
  if (n >= MAX_ATTEMPTS) return err('Trop d’essais. Réessaie dans 15 minutes.', 429);

  if (!(await safeEqual(password, expected))) {
    await env.DB.prepare(`INSERT INTO login_attempts (at) VALUES (?)`).bind(now).run();
    return err('Mot de passe incorrect', 401);
  }

  await env.DB.prepare(`DELETE FROM login_attempts`).run();
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now).run();
  const token = randomToken();
  const maxAge = SESSION_DAYS * 86400;
  await env.DB.prepare(`INSERT INTO sessions (token, expires_at) VALUES (?, ?)`)
    .bind(token, now + maxAge * 1000).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(token, maxAge) });
}

async function logout(request, env) {
  const token = getCookie(request, 'sid');
  if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
}

// ---------------------------------------------------------------------------
// Bibliothèques (chacune stockée en JSON dans une ligne)
// ---------------------------------------------------------------------------
async function listLibs(env) {
  const rows = (await env.DB.prepare(`SELECT data FROM libs ORDER BY created`).all()).results;
  return rows.map((r) => JSON.parse(r.data));
}

function validLib(lib, id) {
  return lib && typeof lib === 'object' && !Array.isArray(lib) &&
    ID_RE.test(String(lib.id)) && (id === undefined || lib.id === id) &&
    typeof lib.name === 'string' && Array.isArray(lib.cards);
}

function upsertStmt(env, lib) {
  const data = JSON.stringify(lib);
  if (data.length > MAX_LIB_BYTES) return null;
  const now = Date.now();
  return env.DB.prepare(
    `INSERT INTO libs (id, data, created, updated) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated`)
    .bind(lib.id, data, Number(lib.created) || now, now);
}

async function putLib(request, env, id) {
  const lib = await readJson(request);
  if (!validLib(lib, id)) return err('Bibliothèque invalide');
  const stmt = upsertStmt(env, lib);
  if (!stmt) return err('Bibliothèque trop volumineuse (environ 5 000 cartes maximum)', 413);
  await stmt.run();
  return json({ ok: true });
}

async function deleteLib(env, id) {
  await env.DB.prepare(`DELETE FROM libs WHERE id = ?`).bind(id).run();
  return json({ ok: true });
}

async function exportAll(env) {
  const libs = await listLibs(env);
  const day = new Date().toISOString().slice(0, 10);
  return json({ app: 'memoire', version: 1, exported: Date.now(), libs }, 200, {
    'Content-Disposition': `attachment; filename="memoire-sauvegarde-${day}.json"`,
  });
}

// Import : ajoute ou remplace les bibliothèques fournies, sans toucher aux autres.
async function importLibs(request, env) {
  const body = await readJson(request);
  const libs = Array.isArray(body) ? body : body && Array.isArray(body.libs) ? body.libs : null;
  if (!libs || !libs.length) return err('Fichier de sauvegarde invalide');
  const stmts = [];
  for (const lib of libs) {
    if (!validLib(lib)) return err('Fichier de sauvegarde invalide');
    const s = upsertStmt(env, lib);
    if (!s) return err(`« ${lib.name} » est trop volumineuse`, 413);
    stmts.push(s);
  }
  await env.DB.batch(stmts);
  return json({ ok: true, count: stmts.length });
}

// ---------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------
async function handleApi(request, env, url) {
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, '');

  // Protection CSRF : les écritures doivent venir de notre propre origine.
  if (method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return err('Origine refusée', 403);
  }

  if (path === '/api/login' && method === 'POST') return login(request, env);
  if (path === '/api/logout' && method === 'POST') return logout(request, env);

  if (!(await isLoggedIn(request, env))) return err('Non connecté', 401);

  if (path === '/api/me' && method === 'GET') return json({ ok: true });
  if (path === '/api/libs' && method === 'GET') return json(await listLibs(env));
  if (path === '/api/export' && method === 'GET') return exportAll(env);
  if (path === '/api/import' && method === 'POST') return importLibs(request, env);

  const m = path.match(/^\/api\/libs\/([a-z0-9]+)$/);
  if (m && ID_RE.test(m[1])) {
    if (method === 'PUT') return putLib(request, env, m[1]);
    if (method === 'DELETE') return deleteLib(env, m[1]);
  }
  return err('Introuvable', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        await ensureSchema(env);
        return await handleApi(request, env, url);
      } catch (e) {
        console.log('erreur API', e?.stack || e);
        return err('Erreur serveur', 500);
      }
    }
    try {
      return await env.ASSETS.fetch(request);
    } catch {
      return new Response('Introuvable', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  },
};
