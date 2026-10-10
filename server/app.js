import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import {
  DEFAULT_CONTEXTUAL_TERMS,
  DEFAULT_EXCLUSION_TERMS,
  DEFAULT_STRONG_TERMS,
  STRONG_TERMS_ADDITIONS,
  STRONG_TERMS_ADDITIONS_2,
  DEFAULT_TECHNOLOGICAL_CONTEXTS
} from './default-terms.js';

const TEXT_SETTINGS = {
  'company-name': {
    key: 'company_name',
    label: 'o nome da empresa',
    maxLength: 80,
    uppercase: true,
    fallback: 'GALAX SUPORT'
  },
  title: {
    key: 'page_title',
    label: 'o título',
    maxLength: 120,
    fallback: 'Contratações TIC'
  },
  subtitle: {
    key: 'page_subtitle',
    label: 'o subtítulo',
    maxLength: 300,
    fallback: 'Interface moderna para listar os dados retornados do Portal de Compras do Governo Federal realacionados a TIC.'
  }
};

function normalizeText(value, setting) {
  const text = value.trim().replace(/\s+/g, ' ');
  return setting.uppercase ? text.toUpperCase() : text;
}

const TERM_SETTINGS = {
  'strong-terms': {
    key: 'strong_terms',
    defaults: [...new Map(
      [...DEFAULT_STRONG_TERMS, ...STRONG_TERMS_ADDITIONS, ...STRONG_TERMS_ADDITIONS_2]
        .map(term => [term.toLowerCase(), term])
    ).values()],
    additions: [
      { id: 'rede-hardware-1', terms: STRONG_TERMS_ADDITIONS },
      { id: 'rede-hardware-2', terms: STRONG_TERMS_ADDITIONS_2 }
    ]
  },
  'contextual-terms': { key: 'contextual_terms', defaults: DEFAULT_CONTEXTUAL_TERMS },
  'technological-contexts': { key: 'technological_contexts', defaults: DEFAULT_TECHNOLOGICAL_CONTEXTS },
  'exclusion-terms': { key: 'exclusion_terms', defaults: DEFAULT_EXCLUSION_TERMS }
};

const REQUEST_TERM_PARAMS = [
  ['termosFortes', 'strong-terms'],
  ['termosContextuais', 'contextual-terms'],
  ['contextosTecnologicos', 'technological-contexts'],
  ['termosExclusao', 'exclusion-terms']
];

const MAX_TERMS = 1000;
const MIN_DEADLINE_DAYS = 1;
const MAX_DEADLINE_DAYS = 15;
const DEFAULT_DEADLINE_DAYS = 7;
const MAX_TERM_LENGTH = 100;

function normalizeTerms(value) {
  if (!Array.isArray(value) || value.length > MAX_TERMS * 2) return null;
  const seen = new Set();
  const terms = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const term = item.trim().replace(/\s+/g, ' ');
    if (!term) continue;
    if (term.length > MAX_TERM_LENGTH) return null;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms.length <= MAX_TERMS ? terms : null;
}

const SESSION_COOKIE = 'comprasgov_session';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function jsonResponse(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(JSON.stringify(body));
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator > 0) {
      cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
    }
    return cookies;
  }, new Map());
}

function secureCompare(actual, expected) {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function hashPassword(value) {
  const salt = randomBytes(16);
  return `${salt.toString('base64')}:${scryptSync(value, salt, 64).toString('base64')}`;
}

function verifyPasswordHash(value, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'base64');
  return timingSafeEqual(scryptSync(value, Buffer.from(salt, 'base64'), expected.length), expected);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('O corpo da requisição excede o limite permitido.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('O corpo da requisição deve conter JSON válido.');
    error.statusCode = 400;
    throw error;
  }
}

function getFavoriteKey(favorite) {
  if (typeof favorite.idContratacaoPNCP === 'string' && favorite.idContratacaoPNCP.trim()) {
    return `id:${favorite.idContratacaoPNCP.trim()}`;
  }
  if (typeof favorite.linkContratacao === 'string' && favorite.linkContratacao.trim()) {
    return `link:${favorite.linkContratacao.trim()}`;
  }
  return null;
}

function normalizeFavorite(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.tipoSaida !== 'oportunidade') {
    return null;
  }

  const key = getFavoriteKey(value);
  if (!key) return null;

  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) return null;
  return { key, serialized, value };
}

function serveStatic(request, response, pathname, staticDir) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    jsonResponse(response, 405, { error: 'Método não permitido.' }, { Allow: 'GET, HEAD' });
    return;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    jsonResponse(response, 400, { error: 'Caminho inválido.' });
    return;
  }

  const root = resolve(staticDir);
  const candidate = resolve(root, `.${decodedPath}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    jsonResponse(response, 400, { error: 'Caminho inválido.' });
    return;
  }

  let filePath = candidate;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    if (extname(decodedPath)) {
      jsonResponse(response, 404, { error: 'Arquivo não encontrado.' });
      return;
    }
    filePath = join(root, 'index.html');
  }

  const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
  const isAsset = filePath !== join(root, 'index.html');
  response.writeHead(200, {
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff'
  });

  if (request.method === 'HEAD') {
    response.end();
  } else {
    createReadStream(filePath).pipe(response);
  }
}

export function createApiServer({
  db,
  username,
  password,
  staticDir,
  webhookUrl,
  defaultDeadlineDays = DEFAULT_DEADLINE_DAYS,
  secureCookies = process.env.NODE_ENV === 'production'
}) {
  if (!username || !password) {
    throw new Error('Configure AUTH_USERNAME e AUTH_PASSWORD no ambiente do servidor.');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS favorites (
      owner TEXT NOT NULL,
      favorite_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner, favorite_key)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS discarded_proposals (
      owner TEXT NOT NULL,
      proposal_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      discarded_at INTEGER NOT NULL,
      PRIMARY KEY (owner, proposal_key)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  const getStoredPassword = db.prepare('SELECT password_hash FROM credentials WHERE username = ?');
  const saveStoredPassword = db.prepare(`
    INSERT INTO credentials (username, password_hash, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      updated_at = excluded.updated_at
  `);

  // Uma senha alterada pelo app (guardada com hash) prevalece sobre AUTH_PASSWORD.
  function isPasswordValid(provided) {
    const stored = getStoredPassword.get(username);
    return stored ? verifyPasswordHash(provided, stored.password_hash) : secureCompare(provided, password);
  }

  const sessions = new Map();
  const loginFailures = new Map();

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      owner TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner, key)
    )
  `);
  const getSetting = db.prepare('SELECT value_json FROM settings WHERE owner = ? AND key = ?');
  function loadText(owner, setting) {
    const row = getSetting.get(owner, setting.key);
    return row ? normalizeText(JSON.parse(row.value_json), setting) : setting.fallback;
  }
  const saveSetting = db.prepare(`
    INSERT INTO settings (owner, key, value_json, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(owner, key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `);

  // Na primeira leitura os termos padrão são gravados no banco. Acréscimos de
  // versões posteriores são mesclados uma única vez nas listas já salvas.
  function loadTerms(owner, setting) {
    const row = getSetting.get(owner, setting.key);
    if (!row) {
      saveSetting.run(owner, setting.key, JSON.stringify(setting.defaults), Date.now());
      for (const addition of setting.additions ?? []) {
        saveSetting.run(owner, `${setting.key}_migration_${addition.id}`, 'true', Date.now());
      }
      return [...setting.defaults];
    }

    let terms = JSON.parse(row.value_json);
    for (const addition of setting.additions ?? []) {
      const flag = `${setting.key}_migration_${addition.id}`;
      if (getSetting.get(owner, flag)) continue;
      const known = new Set(terms.map(term => term.toLowerCase()));
      terms = [...terms, ...addition.terms.filter(term => !known.has(term.toLowerCase()))];
      saveSetting.run(owner, setting.key, JSON.stringify(terms), Date.now());
      saveSetting.run(owner, flag, 'true', Date.now());
    }
    return terms;
  }
  const listFavorites = db.prepare(
    'SELECT value_json FROM favorites WHERE owner = ? ORDER BY updated_at DESC, favorite_key'
  );
  const saveFavorite = db.prepare(`
    INSERT INTO favorites (owner, favorite_key, value_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(owner, favorite_key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `);
  const listDiscarded = db.prepare(
    'SELECT value_json FROM discarded_proposals WHERE owner = ? ORDER BY discarded_at DESC, proposal_key'
  );
  const saveDiscarded = db.prepare(`
    INSERT INTO discarded_proposals (owner, proposal_key, value_json, discarded_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(owner, proposal_key) DO UPDATE SET
      value_json = excluded.value_json,
      discarded_at = excluded.discarded_at
  `);
  const deleteDiscarded = db.prepare(
    'DELETE FROM discarded_proposals WHERE owner = ? AND proposal_key = ?'
  );
  const deleteFavorite = db.prepare(
    'DELETE FROM favorites WHERE owner = ? AND favorite_key = ?'
  );

  const cookieOptions = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;

  function getSession(request) {
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (!token) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return session;
  }

  function hasCrossSiteFetch(request) {
    return request.headers['sec-fetch-site'] === 'cross-site';
  }

  async function routeApi(request, response, url) {
    const { pathname } = url;

    if (pathname === '/api/auth/session' && request.method === 'GET') {
      jsonResponse(response, 200, { authenticated: Boolean(getSession(request)) });
      return;
    }

    if (pathname === '/api/auth/company' && request.method === 'GET') {
      jsonResponse(response, 200, {
        value: loadText(username, TEXT_SETTINGS['company-name']),
        title: loadText(username, TEXT_SETTINGS.title)
      });
      return;
    }

    if (pathname === '/api/auth/login' && request.method === 'POST') {
      if (hasCrossSiteFetch(request)) {
        jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
        return;
      }

      const address = request.socket.remoteAddress ?? 'unknown';
      const attempts = loginFailures.get(address);
      if (attempts && attempts.expiresAt > Date.now() && attempts.count >= 10) {
        const retryAfter = Math.ceil((attempts.expiresAt - Date.now()) / 1000);
        jsonResponse(response, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }, {
          'Retry-After': String(retryAfter)
        });
        return;
      }

      const body = await readJson(request);
      const providedUsername = typeof body?.username === 'string' ? body.username.trim() : '';
      const providedPassword = typeof body?.password === 'string' ? body.password : '';
      if (!secureCompare(providedUsername, username) || !isPasswordValid(providedPassword)) {
        const previous = loginFailures.get(address);
        loginFailures.set(address, {
          count: previous?.expiresAt > Date.now() ? previous.count + 1 : 1,
          expiresAt: previous?.expiresAt > Date.now() ? previous.expiresAt : Date.now() + 15 * 60 * 1000
        });
        jsonResponse(response, 401, { error: 'Usuário ou senha incorretos.' });
        return;
      }

      loginFailures.delete(address);
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { username, expiresAt: Date.now() + SESSION_DURATION_MS });
      response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; ${cookieOptions}; Max-Age=${SESSION_DURATION_MS / 1000}`);
      jsonResponse(response, 200, { authenticated: true });
      return;
    }

    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      if (hasCrossSiteFetch(request)) {
        jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
        return;
      }
      const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
      if (token) sessions.delete(token);
      response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieOptions}; Max-Age=0`);
      jsonResponse(response, 200, { authenticated: false });
      return;
    }

    const session = getSession(request);

    if (pathname === '/api/auth/password' && request.method === 'POST') {
      if (hasCrossSiteFetch(request)) {
        jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
        return;
      }
      if (!session) {
        jsonResponse(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
        return;
      }

      const body = await readJson(request);
      const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
      if (!isPasswordValid(currentPassword)) {
        jsonResponse(response, 400, { error: 'A senha atual está incorreta.' });
        return;
      }
      if (newPassword.length < 8 || newPassword.length > 200) {
        jsonResponse(response, 400, { error: 'A nova senha deve ter entre 8 e 200 caracteres.' });
        return;
      }
      if (newPassword === currentPassword) {
        jsonResponse(response, 400, { error: 'A nova senha deve ser diferente da atual.' });
        return;
      }

      saveStoredPassword.run(username, hashPassword(newPassword), Date.now());
      const currentToken = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
      for (const token of sessions.keys()) {
        if (token !== currentToken) sessions.delete(token);
      }
      jsonResponse(response, 200, { changed: true });
      return;
    }

    if (pathname === '/api/settings/deadline') {
      if (!session) {
        jsonResponse(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
        return;
      }

      if (request.method === 'GET') {
        const row = getSetting.get(session.username, 'deadline_days');
        jsonResponse(response, 200, { value: row ? JSON.parse(row.value_json) : defaultDeadlineDays });
        return;
      }

      if (request.method === 'PUT') {
        if (hasCrossSiteFetch(request)) {
          jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
          return;
        }
        const body = await readJson(request);
        const value = body?.value;
        if (!Number.isInteger(value) || value < MIN_DEADLINE_DAYS || value > MAX_DEADLINE_DAYS) {
          jsonResponse(response, 400, {
            error: `O prazo deve ser um número inteiro entre ${MIN_DEADLINE_DAYS} e ${MAX_DEADLINE_DAYS}.`
          });
          return;
        }
        saveSetting.run(session.username, 'deadline_days', JSON.stringify(value), Date.now());
        jsonResponse(response, 200, { value });
        return;
      }
    }

    const textSetting = pathname.startsWith('/api/settings/')
      ? TEXT_SETTINGS[pathname.slice('/api/settings/'.length)]
      : undefined;
    if (textSetting) {
      if (!session) {
        jsonResponse(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
        return;
      }

      if (request.method === 'GET') {
        jsonResponse(response, 200, { value: loadText(session.username, textSetting) });
        return;
      }

      if (request.method === 'PUT') {
        if (hasCrossSiteFetch(request)) {
          jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
          return;
        }
        const body = await readJson(request);
        const value = typeof body?.value === 'string' ? normalizeText(body.value, textSetting) : '';
        if (!value || value.length > textSetting.maxLength) {
          jsonResponse(response, 400, {
            error: `Informe ${textSetting.label} com até ${textSetting.maxLength} caracteres.`
          });
          return;
        }
        saveSetting.run(session.username, textSetting.key, JSON.stringify(value), Date.now());
        jsonResponse(response, 200, { value });
        return;
      }
    }

    const termSetting = pathname.startsWith('/api/settings/')
      ? TERM_SETTINGS[pathname.slice('/api/settings/'.length)]
      : undefined;
    if (termSetting) {
      if (!session) {
        jsonResponse(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
        return;
      }

      if (request.method === 'GET') {
        jsonResponse(response, 200, { terms: loadTerms(session.username, termSetting) });
        return;
      }

      if (request.method === 'PUT') {
        if (hasCrossSiteFetch(request)) {
          jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
          return;
        }
        const body = await readJson(request);
        const terms = normalizeTerms(body?.terms);
        if (!terms) {
          jsonResponse(response, 400, {
            error: `Envie até ${MAX_TERMS} termos de no máximo ${MAX_TERM_LENGTH} caracteres.`
          });
          return;
        }
        saveSetting.run(session.username, termSetting.key, JSON.stringify(terms), Date.now());
        for (const addition of termSetting.additions ?? []) {
          saveSetting.run(session.username, `${termSetting.key}_migration_${addition.id}`, 'true', Date.now());
        }
        jsonResponse(response, 200, { terms });
        return;
      }
    }

    if (pathname === '/api/favorites' || pathname.startsWith('/api/favorites/')) {
      if (!session) {
        jsonResponse(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/favorites') {
        const favorites = listFavorites.all(session.username).map(row => JSON.parse(row.value_json));
        jsonResponse(response, 200, favorites);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/favorites') {
        if (hasCrossSiteFetch(request)) {
          jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
          return;
        }
        const body = await readJson(request);
        const normalized = normalizeFavorite(body?.favorite);
        if (!normalized) {
          jsonResponse(response, 400, { error: 'O favorito enviado não é válido.' });
          return;
        }
        saveFavorite.run(session.username, normalized.key, normalized.serialized, Date.now());
        jsonResponse(response, 200, normalized.value);
        return;
      }

      if (request.method === 'DELETE' && pathname.startsWith('/api/favorites/')) {
        if (hasCrossSiteFetch(request)) {
          jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
          return;
        }
        const encodedKey = pathname.slice('/api/favorites/'.length);
        let key;
        try {
          key = decodeURIComponent(encodedKey);
        } catch {
          jsonResponse(response, 400, { error: 'Identificador de favorito inválido.' });
          return;
        }
        if (!key || key.length > 4096) {
          jsonResponse(response, 400, { error: 'Identificador de favorito inválido.' });
          return;
        }
        deleteFavorite.run(session.username, key);
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }

      jsonResponse(response, 405, { error: 'Método não permitido.' }, {
        Allow: pathname === '/api/favorites' ? 'GET, POST' : 'DELETE'
      });
      return;
    }

    if (pathname === '/api/discarded' || pathname.startsWith('/api/discarded/')) {
      if (!session) {
        jsonResponse(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/discarded') {
        jsonResponse(response, 200, listDiscarded.all(session.username).map(row => JSON.parse(row.value_json)));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/discarded') {
        if (hasCrossSiteFetch(request)) {
          jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
          return;
        }
        const body = await readJson(request);
        const normalized = normalizeFavorite(body?.proposal);
        if (!normalized) {
          jsonResponse(response, 400, { error: 'A proposta enviada não é válida.' });
          return;
        }
        saveDiscarded.run(session.username, normalized.key, normalized.serialized, Date.now());
        jsonResponse(response, 200, normalized.value);
        return;
      }

      if (request.method === 'DELETE' && pathname.startsWith('/api/discarded/')) {
        if (hasCrossSiteFetch(request)) {
          jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
          return;
        }
        let key;
        try {
          key = decodeURIComponent(pathname.slice('/api/discarded/'.length));
        } catch {
          jsonResponse(response, 400, { error: 'Identificador de proposta inválido.' });
          return;
        }
        if (!key || key.length > 4096) {
          jsonResponse(response, 400, { error: 'Identificador de proposta inválido.' });
          return;
        }
        deleteDiscarded.run(session.username, key);
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }

      jsonResponse(response, 405, { error: 'Método não permitido.' }, {
        Allow: pathname === '/api/discarded' ? 'GET, POST' : 'DELETE'
      });
      return;
    }

    if (pathname === '/api/pregoes' && request.method === 'GET') {
      if (!webhookUrl) {
        jsonResponse(response, 503, { error: 'O endpoint de consulta não foi configurado no servidor.' });
        return;
      }

      const target = new URL(webhookUrl);
      for (const [key, value] of url.searchParams) {
        target.searchParams.set(key, value);
      }
      if (session) {
        // Parâmetros vindos das configurações da conta prevalecem sobre os enviados pelo cliente.
        const row = getSetting.get(session.username, 'deadline_days');
        target.searchParams.set('prazo', String(row ? JSON.parse(row.value_json) : defaultDeadlineDays));
        for (const [param, kind] of REQUEST_TERM_PARAMS) {
          target.searchParams.set(param, loadTerms(session.username, TERM_SETTINGS[kind]).join(','));
        }
      }
      const controller = new AbortController();
      response.on('close', () => {
        if (!response.writableEnded) controller.abort();
      });

      try {
        const upstream = await fetch(target, {
          headers: { Accept: request.headers.accept ?? 'application/json' },
          signal: controller.signal
        });
        response.statusCode = upstream.status;
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
        if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
        else response.end();
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error('Falha ao consultar endpoint PNCP:', error);
        jsonResponse(response, 502, { error: 'Não foi possível consultar o endpoint PNCP.' });
      }
      return;
    }

    jsonResponse(response, 404, { error: 'Endpoint não encontrado.' });
  }

  return createServer(async (request, response) => {
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    let url;
    try {
      url = new URL(request.url, 'http://localhost');
    } catch {
      jsonResponse(response, 400, { error: 'URL inválida.' });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        await routeApi(request, response, url);
      } catch (error) {
        if (error instanceof Error && 'statusCode' in error) {
          jsonResponse(response, Number(error.statusCode), { error: error.message });
          return;
        }
        console.error('Falha ao processar requisição:', error);
        jsonResponse(response, 500, { error: 'Erro interno do servidor.' });
      }
      return;
    }

    if (!staticDir) {
      jsonResponse(response, 404, { error: 'Endpoint não encontrado.' });
      return;
    }

    serveStatic(request, response, url.pathname, staticDir);
  });
}
