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
import { pipeline } from 'node:stream/promises';
import { retryAfterMs } from './pncp-fetch.js';
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

function upstreamError(service, error) {
  if (error.name === 'TimeoutError') {
    return Object.assign(new Error(`Tempo limite excedido ao acessar ${service}. Verifique a execução no n8n antes de tentar novamente.`), { statusCode: 504 });
  }
  if (error.cause?.code) {
    return Object.assign(new Error(`Não foi possível conectar a ${service} (${error.cause.code}).`), { statusCode: 502 });
  }
  return error;
}

async function requireUpstreamSuccess(response, service) {
  if (response.ok) return;
  let detail = '';
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    const value = body?.message ?? body?.error;
    if (typeof value === 'string') detail = value.slice(0, 300);
  } catch {
    // Proxy HTML is not suitable for display as an application error.
  }
  const retryAfter = response.status === 429
    ? Math.ceil((retryAfterMs(response, Date.now()) ?? (service === 'PNCP' ? 30000 : 0)) / 1000)
    : null;
  const retryMessage = retryAfter !== null && retryAfter > 0
    ? ` Tente novamente em aproximadamente ${retryAfter} s.`
    : '';
  throw Object.assign(new Error(`${service} respondeu HTTP ${response.status}.${detail ? ` ${detail}` : ''}${retryMessage}`), {
    statusCode: response.status === 429 ? 429 : response.status === 504 ? 504 : 502,
    retryAfter
  });
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

function getProposalKey(proposal) {
  if (typeof proposal.idContratacaoPNCP === 'string' && proposal.idContratacaoPNCP.trim()) {
    return `id:${proposal.idContratacaoPNCP.trim()}`;
  }
  if (typeof proposal.linkContratacao === 'string' && proposal.linkContratacao.trim()) {
    return `link:${proposal.linkContratacao.trim()}`;
  }
  return null;
}

function normalizeProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.tipoSaida !== 'oportunidade') {
    return null;
  }

  const key = getProposalKey(value);
  if (!key) return null;

  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) return null;
  return { key, serialized, value };
}

const proposalDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
});

function proposalDay(date) {
  const parts = proposalDayFormatter.formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

function isExpiredProposal(proposal, today) {
  const raw = proposal.dataEncerramentoProposta ?? proposal.dataAberturaProposta ?? proposal.dataPublicacao;
  if (typeof raw !== 'string' || !raw.trim()) return false;
  const value = raw.trim();
  const local = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(value);
  const date = new Date(local ? `${value.length === 10 ? `${value}T00:00:00` : value}-03:00` : value);
  if (Number.isNaN(date.getTime())) return false;
  const day = proposalDay(date);
  if (local && day !== value.slice(0, 10)) return false;
  return day < today;
}

export function proposalIdentity(id, link) {
  if (link) {
    let url;
    try {
      url = new URL(link);
    } catch {
      throw Object.assign(new Error('Link PNCP inválido.'), { statusCode: 400 });
    }
    if (url.protocol !== 'https:' || !['pncp.gov.br', 'www.pncp.gov.br'].includes(url.hostname)
      || url.port || url.username || url.password) {
      throw Object.assign(new Error('Informe um link oficial do PNCP.'), { statusCode: 400 });
    }
    const match = url.pathname.match(/^\/app\/(?:editais|compras)\/(\d{14})\/(\d{4})\/([1-9]\d*)\/?$/);
    if (match) return { cnpj: match[1], ano: match[2], sequencial: match[3] };
    const control = url.pathname.match(/^\/app\/(?:editais|compras)\/(\d{14}-1-\d+\/\d{4})\/?$/);
    if (control) id = control[1];
  }
  const match = typeof id === 'string' ? id.match(/^(\d{14})-1-(\d+)\/(\d{4})$/) : null;
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1) {
    throw Object.assign(new Error('Identificador PNCP indisponível ou inválido para atualizar a situação.'), { statusCode: 400 });
  }
  return { cnpj: match[1], ano: match[3], sequencial: String(Number(match[2])) };
}

export async function lookupProposalDetails(id, link, fetchImpl = fetch, signal) {
  const { cnpj, ano, sequencial } = proposalIdentity(id, link);
  const target = `https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}`;
  const upstream = await fetchImpl(target, {
    headers: { Accept: 'application/json' }, redirect: 'error',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)
  });
  await requireUpstreamSuccess(upstream, 'PNCP');
  const data = await upstream.json();
  const situacao = data?.situacaoCompraNome ?? data?.situacaoCompraNomePncp;
  if (typeof situacao !== 'string' || !situacao.trim()) {
    throw new Error('PNCP retornou uma situação inválida ou não informada.');
  }
  const tipoInstrumentoConvocatorio = typeof data?.tipoInstrumentoConvocatorioNome === 'string'
    && data.tipoInstrumentoConvocatorioNome.trim()
    ? data.tipoInstrumentoConvocatorioNome.trim()
    : null;
  const numeroCompra = data?.numeroCompra == null ? '' : String(data.numeroCompra).trim();
  const anoCompra = data?.anoCompra == null ? '' : String(data.anoCompra).trim();
  const numeroCompraCompleto = numeroCompra
    ? numeroCompra.includes('/') || !anoCompra ? numeroCompra : `${numeroCompra}/${anoCompra}`
    : null;
  return {
    situacao: situacao.trim(),
    tipoInstrumentoConvocatorio,
    numeroCompra: numeroCompraCompleto
  };
}

export async function lookupProposalStatus(id, link, fetchImpl = fetch, signal) {
  return (await lookupProposalDetails(id, link, fetchImpl, signal)).situacao;
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
  analysisWebhookUrl,
  analysisWorkflowKey,
  pncpFetch = fetch,
  upstreamTimeoutMs = 145000,
  analysisTimeoutMs = 30000,
  analysisStartTimeoutMs = 90000,
  authDisabled = false,
  defaultDeadlineDays = DEFAULT_DEADLINE_DAYS,
  secureCookies = process.env.NODE_ENV === 'production'
}) {
  let statusRateLimitLogUntil = 0;
  if (authDisabled) {
    username = username || 'homologacao';
  } else if (!username || !password) {
    throw new Error('Configure AUTH_USERNAME e AUTH_PASSWORD no ambiente do servidor.');
  }

  db.exec(`
    DROP TABLE IF EXISTS favorites
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
    CREATE TABLE IF NOT EXISTS registered_proposals (
      owner TEXT NOT NULL,
      proposal_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      registered_at INTEGER NOT NULL,
      PRIMARY KEY (owner, proposal_key)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_jobs (
      owner TEXT NOT NULL, job_id TEXT NOT NULL, proposal_key TEXT NOT NULL,
      proposal_json TEXT NOT NULL, status TEXT NOT NULL, message TEXT,
      consult_path TEXT NOT NULL, report_path TEXT NOT NULL, report_html TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      started_at INTEGER, completed_at INTEGER,
      PRIMARY KEY (owner, job_id)
    )
  `);
  const analysisColumns = db.prepare('PRAGMA table_info(analysis_jobs)').all().map(column => column.name);
  for (const column of ['started_at', 'completed_at']) {
    if (!analysisColumns.includes(column)) db.exec(`ALTER TABLE analysis_jobs ADD COLUMN ${column} INTEGER`);
  }
  const obsoleteAnalyses = db.prepare(`
    DELETE FROM analysis_jobs
    WHERE status = 'pendente' AND job_id GLOB 'pendente-*'
      AND trim(consult_path) = '' AND trim(report_path) = ''
      AND coalesce(report_html, '') = ''
  `).run().changes;
  if (obsoleteAnalyses) console.info(`Removidos ${obsoleteAnalyses} registros legados de análise sem protocolo externo.`);

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
  const storedDiscarded = db.prepare('SELECT owner, proposal_key, value_json FROM discarded_proposals');
  const pruneDiscarded = db.transaction(() => {
    const today = proposalDay(new Date());
    for (const row of storedDiscarded.all()) {
      if (isExpiredProposal(JSON.parse(row.value_json), today)) {
        deleteDiscarded.run(row.owner, row.proposal_key);
      }
    }
  });
  pruneDiscarded();
  const listRegistered = db.prepare(
    'SELECT value_json FROM registered_proposals WHERE owner = ? ORDER BY registered_at DESC, proposal_key'
  );
  const saveRegistered = db.prepare(`
    INSERT INTO registered_proposals (owner, proposal_key, value_json, registered_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(owner, proposal_key) DO UPDATE SET
      value_json = excluded.value_json,
      registered_at = excluded.registered_at
  `);
  const deleteRegistered = db.prepare(
    'DELETE FROM registered_proposals WHERE owner = ? AND proposal_key = ?'
  );
  const discardAndUnregister = db.transaction((owner, normalized) => {
    if (!isExpiredProposal(normalized.value, proposalDay(new Date()))) {
      saveDiscarded.run(owner, normalized.key, normalized.serialized, Date.now());
    } else {
      deleteDiscarded.run(owner, normalized.key);
    }
    deleteRegistered.run(owner, normalized.key);
  });
  const cookieOptions = `Path=/; HttpOnly; SameSite=Strict${secureCookies ? '; Secure' : ''}`;
  const startingAnalyses = new Map();
  const cancellingAnalyses = new Set();
  const analysisOrigin = analysisWebhookUrl ? new URL(analysisWebhookUrl).origin : null;
  const analysisId = /^[A-Za-z0-9_-]{1,100}$/;
  const analysisKind = status => {
    if (/erro|falha|fail|cancel/i.test(status)) return 'failed';
    return /^(conclu[ií]d[oa]|finalizad[oa]|pront[oa]|sucesso|success|completed?|done|ready)$/i.test(status.trim())
      ? 'done' : 'running';
  };
  const terminalAnalysis = row => analysisKind(row.status) === 'failed'
    || (analysisKind(row.status) === 'done' && Boolean(row.report_html));
  db.prepare('UPDATE analysis_jobs SET message = substr(message, 1, 255) WHERE length(message) > 255').run();
  const serializeAnalysis = row => ({
    jobId: row.job_id, proposalKey: row.proposal_key, status: row.status, message: row.message?.slice(0, 255) ?? null,
    startedAt: row.started_at ?? row.created_at,
    completedAt: analysisKind(row.status) === 'running' ? null : row.completed_at,
    hasReport: analysisKind(row.status) !== 'running' && Boolean(row.report_html)
  });
  const getAnalysis = db.prepare('SELECT * FROM analysis_jobs WHERE owner = ? AND job_id = ?');
  const listAnalyses = db.prepare('SELECT * FROM analysis_jobs WHERE owner = ? ORDER BY created_at DESC');
  const getProposalAnalysis = db.prepare('SELECT * FROM analysis_jobs WHERE owner = ? AND proposal_key = ? ORDER BY created_at DESC LIMIT 1');
  const cancelUrl = analysisWebhookUrl ? new URL('pncp-cancelar', analysisWebhookUrl).href : null;
  async function cancelProposalAnalyses(owner, key) {
    const rows = db.prepare('SELECT job_id FROM analysis_jobs WHERE owner=? AND proposal_key=?').all(owner, key);
    for (const row of rows) {
      const result = analysisObject(await callAnalysis(cancelUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: row.job_id })
      }));
      if (result.cancelled !== true || result.job_id !== row.job_id) {
        throw new Error('O serviço externo não confirmou o cancelamento da análise.');
      }
    }
    db.prepare('DELETE FROM analysis_jobs WHERE owner=? AND proposal_key=?').run(owner, key);
  }
  function analysisUrl(path) {
    const value = typeof path === 'string' ? path.replace(/^\s*(GET|POST)\s+/i, '').trim() : '';
    if (!analysisOrigin) {
      throw Object.assign(new Error('Configure ANALYSIS_WEBHOOK_URL no serviço da API e reinicie a aplicação para acompanhar as análises.'), {
        statusCode: 503
      });
    }
    const invalid = message => Object.assign(new Error(message), { code: 'INVALID_ANALYSIS_ADDRESS', statusCode: 502 });
    if (!value) {
      throw invalid('O job não possui endereço de consulta ou relatório. Verifique consultar e relatorioHtml no retorno do n8n antes de refazer a análise.');
    }
    let url;
    try {
      url = new URL(value, analysisOrigin);
    } catch {
      throw invalid('O endereço de consulta ou relatório do job é inválido. Corrija o retorno do n8n antes de refazer a análise.');
    }
    if (url.origin !== analysisOrigin || url.username || url.password) {
      throw invalid('Endereço de análise fora do servidor configurado. Confira ANALYSIS_WEBHOOK_URL e as URLs retornadas pelo n8n.');
    }
    return url.href;
  }
  async function callAnalysis(url, init = {}) {
    try {
      const result = await fetch(url, {
        ...init, headers: { 'X-Workflow-Key': analysisWorkflowKey ?? '', ...init.headers },
        redirect: 'error',
        signal: AbortSignal.timeout(init.method === 'POST' ? analysisStartTimeoutMs : analysisTimeoutMs)
      });
      await requireUpstreamSuccess(result, 'O serviço de análise n8n');
      return await result.text();
    } catch (error) {
      throw upstreamError('o serviço de análise n8n', error);
    }
  }
  function analysisObject(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('O serviço de análise n8n retornou JSON inválido ou vazio.');
    }
    const value = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Resposta inesperada do serviço de análise.');
    return value;
  }

  function getSession(request) {
    if (authDisabled) return { username, expiresAt: Number.MAX_SAFE_INTEGER };
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
      jsonResponse(response, 200, { authenticated: Boolean(getSession(request)), authRequired: !authDisabled });
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
      if (authDisabled) {
        jsonResponse(response, 200, { authenticated: true });
        return;
      }
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

    if (pathname === '/api/proposals/status' && request.method === 'GET') {
      if (!session) {
        jsonResponse(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
        return;
      }
      try {
        const id = url.searchParams.get('id');
        const link = url.searchParams.get('link');
        const details = await lookupProposalDetails(id, link, pncpFetch);
        db.transaction(() => {
          for (const table of ['discarded_proposals', 'registered_proposals']) {
            const rows = db.prepare(`SELECT proposal_key, value_json FROM ${table} WHERE owner = ?`).all(session.username);
            const update = db.prepare(`UPDATE ${table} SET value_json = ? WHERE owner = ? AND proposal_key = ?`);
            for (const row of rows) {
              const proposal = JSON.parse(row.value_json);
              if ((id && proposal.idContratacaoPNCP === id) || (link && proposal.linkContratacao === link)) {
                update.run(JSON.stringify({
                  ...proposal,
                  situacao: details.situacao,
                  ...(details.tipoInstrumentoConvocatorio
                    ? { tipoInstrumentoConvocatorio: details.tipoInstrumentoConvocatorio }
                    : {}),
                  ...(details.numeroCompra ? { numeroCompra: details.numeroCompra } : {})
                }), session.username, row.proposal_key);
              }
            }
          }
        })();
        jsonResponse(response, 200, details);
      } catch (error) {
        const failure = error.statusCode ? error : upstreamError('PNCP', error);
        if (failure.statusCode === 429) {
          if (Date.now() >= statusRateLimitLogUntil) {
            console.error('Falha ao atualizar situação da proposta:', failure.message);
          }
          statusRateLimitLogUntil = Math.max(statusRateLimitLogUntil, Date.now() + failure.retryAfter * 1000);
        } else {
          console.error('Falha ao atualizar situação da proposta:', failure.message);
        }
        jsonResponse(response, failure.statusCode ?? 502, { error: failure.message },
          failure.statusCode === 429 ? { 'Retry-After': String(failure.retryAfter) } : {});
      }
      return;
    }

    if (pathname === '/api/discarded' || pathname.startsWith('/api/discarded/')) {
      if (!session) {
        jsonResponse(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/discarded') {
        pruneDiscarded();
        jsonResponse(response, 200, listDiscarded.all(session.username).map(row => JSON.parse(row.value_json)));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/discarded') {
        if (hasCrossSiteFetch(request)) {
          jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
          return;
        }
        const body = await readJson(request);
        const normalized = normalizeProposal(body?.proposal);
        if (!normalized) {
          jsonResponse(response, 400, { error: 'A proposta enviada não é válida.' });
          return;
        }
        pruneDiscarded();
        discardAndUnregister(session.username, normalized);
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

    if (pathname === '/api/registered' || pathname.startsWith('/api/registered/')) {
      if (!session) {
        jsonResponse(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/registered') {
        jsonResponse(response, 200, listRegistered.all(session.username).map(row => JSON.parse(row.value_json)));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/registered') {
        if (hasCrossSiteFetch(request)) {
          jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
          return;
        }
        const body = await readJson(request);
        const normalized = normalizeProposal(body?.proposal);
        if (!normalized) {
          jsonResponse(response, 400, { error: 'A proposta enviada não é válida.' });
          return;
        }
        saveRegistered.run(session.username, normalized.key, normalized.serialized, Date.now());
        jsonResponse(response, 200, normalized.value);
        return;
      }

      if (request.method === 'DELETE' && pathname.startsWith('/api/registered/')) {
        if (hasCrossSiteFetch(request)) {
          jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
          return;
        }
        let key;
        try {
          key = decodeURIComponent(pathname.slice('/api/registered/'.length));
        } catch {
          jsonResponse(response, 400, { error: 'Identificador de proposta inválido.' });
          return;
        }
        if (!key || key.length > 4096) {
          jsonResponse(response, 400, { error: 'Identificador de proposta inválido.' });
          return;
        }
        deleteRegistered.run(session.username, key);
        response.writeHead(204, { 'Cache-Control': 'no-store' });
        response.end();
        return;
      }

      jsonResponse(response, 405, { error: 'Método não permitido.' }, {
        Allow: pathname === '/api/registered' ? 'GET, POST' : 'DELETE'
      });
      return;
    }

    if (pathname === '/api/analysis' || pathname.startsWith('/api/analysis/')) {
      if (!session) {
        jsonResponse(response, 401, { error: 'Sua sessão expirou. Entre novamente.' });
        return;
      }
      if (request.method !== 'GET' && hasCrossSiteFetch(request)) {
        jsonResponse(response, 403, { error: 'Requisição de outra origem bloqueada.' });
        return;
      }
      if (pathname === '/api/analysis' && request.method === 'GET') {
        jsonResponse(response, 200, listAnalyses.all(session.username).map(serializeAnalysis));
        return;
      }
      if (pathname === '/api/analysis/cancel' && request.method === 'POST') {
        const body = await readJson(request);
        const key = body?.proposalKey;
        if (typeof key !== 'string' || !key.trim() || key.length > 2000) {
          jsonResponse(response, 400, { error: 'Informe a identificação da proposta.' });
          return;
        }
        const lock = JSON.stringify([session.username, key]);
        if (cancellingAnalyses.has(lock)) {
          jsonResponse(response, 409, { error: 'O cancelamento já está em andamento.' });
          return;
        }
        const pending = startingAnalyses.get(lock);
        if (!pending && !getProposalAnalysis.get(session.username, key)) {
          jsonResponse(response, 404, { error: 'Análise não encontrada.' });
          return;
        }
        cancellingAnalyses.add(lock);
        try {
          if (pending) {
            pending.cancelRequested = true;
            const failure = await pending.finished;
            if (failure) throw failure;
          }
          await cancelProposalAnalyses(session.username, key);
          jsonResponse(response, 200, { cancelled: true });
        } catch (error) {
          console.error('Falha ao cancelar análise:', error);
          jsonResponse(response, error.statusCode ?? 502, { error: error.message });
        } finally {
          cancellingAnalyses.delete(lock);
        }
        return;
      }
      if (pathname === '/api/analysis' && request.method === 'POST') {
        const body = await readJson(request);
        const proposal = normalizeProposal(body?.proposal);
        const pncpId = proposal?.value.idContratacaoPNCP;
        const pncpIdMatch = typeof pncpId === 'string' ? /^(\d{14})-1-(\d+)\/(\d{4})$/.exec(pncpId) : null;
        if (!proposal || !pncpIdMatch || !Number.isSafeInteger(Number(pncpIdMatch[2])) || Number(pncpIdMatch[2]) < 1) {
          jsonResponse(response, 400, { error: 'Informe uma proposta com Id contratação PNCP válido.' });
          return;
        }
        const lock = JSON.stringify([session.username, proposal.key]);
        if (startingAnalyses.has(lock) || cancellingAnalyses.has(lock)) {
          jsonResponse(response, 409, { error: 'A análise desta proposta está sendo iniciada.' });
          return;
        }
        const previous = getProposalAnalysis.get(session.username, proposal.key);
        if (previous && previous.status !== 'pendente' && !terminalAnalysis(previous)) {
          jsonResponse(response, 200, serializeAnalysis(previous));
          return;
        }
        if (!analysisWebhookUrl) {
          jsonResponse(response, 503, { error: 'O endpoint de análise não foi configurado no servidor.' });
          return;
        }
        let finishStart;
        const pending = { cancelRequested: false, finished: new Promise(resolve => { finishStart = resolve; }) };
        startingAnalyses.set(lock, pending);
        let failure = null;
        try {
          const startedAt = Date.now();
          const data = analysisObject(await callAnalysis(analysisWebhookUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idContratacaoPNCP: pncpId })
          }));
          if (typeof data.job_id !== 'string' || !analysisId.test(data.job_id)) {
            throw new Error('Resposta inesperada do serviço de análise.');
          }
          const consult = analysisUrl(data.consultar);
          const report = analysisUrl(data.relatorioHtml);
          db.transaction(() => {
            db.prepare('DELETE FROM analysis_jobs WHERE owner = ? AND proposal_key = ?').run(session.username, proposal.key);
            db.prepare(`INSERT INTO analysis_jobs
              (owner,job_id,proposal_key,proposal_json,status,message,consult_path,report_path,created_at,updated_at,started_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(session.username, data.job_id, proposal.key, proposal.serialized,
              typeof data.status === 'string' && data.status.trim() ? data.status.trim().slice(0,100) : 'fila',
              typeof data.mensagem === 'string' ? data.mensagem.slice(0,255) : 'Análise iniciada.',
              consult, report, startedAt, Date.now(), startedAt);
          })();
          if (pending.cancelRequested) {
            jsonResponse(response, 409, { error: 'Cancelamento solicitado para esta análise.' });
          } else {
            jsonResponse(response, 200, serializeAnalysis(getAnalysis.get(session.username, data.job_id)));
          }
        } catch (error) {
          failure = error;
          console.error('Falha ao iniciar análise:', error);
          jsonResponse(response, error.statusCode ?? 502, { error: error.message });
        } finally {
          startingAnalyses.delete(lock);
          finishStart(failure);
        }
        return;
      }
      const match = pathname.match(/^\/api\/analysis\/([A-Za-z0-9_-]{1,100})\/(refresh|report)$/);
      const row = match ? getAnalysis.get(session.username, match[1]) : null;
      if (!row) {
        jsonResponse(response, 404, { error: 'Análise não encontrada.' });
        return;
      }
      if (match[2] === 'report' && request.method === 'GET') {
        if (!row.report_html || analysisKind(row.status) === 'running') {
          jsonResponse(response, 404, { error: 'O relatório ainda não está disponível.' });
          return;
        }
        response.writeHead(200, {
          'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:",
          'X-Content-Type-Options': 'nosniff'
        });
        response.end(row.report_html);
        return;
      }
      if (match[2] === 'refresh' && request.method === 'POST') {
        try {
          if (!terminalAnalysis(row)) {
            const data = analysisObject(await callAnalysis(analysisUrl(row.consult_path)));
            const status = typeof data.status === 'string' && data.status.trim() ? data.status.trim().slice(0,100) : row.status;
            const kind = analysisKind(status);
            const limitations = Array.isArray(data.limitacoes) ? data.limitacoes.filter(v => typeof v === 'string').join('; ') : '';
            const message = (kind === 'failed' ? [data.erro, data.error, data.mensagem] : [data.mensagem, kind === 'running' ? data.progresso : null])
              .find(v => typeof v === 'string' && v.trim())
              ?? (kind === 'failed' ? 'A análise falhou.' : kind === 'done' ? 'Análise concluída.' : row.message);
            const now = Date.now();
            db.prepare('UPDATE analysis_jobs SET status=?,message=?,updated_at=?,completed_at=?,report_html=? WHERE owner=? AND job_id=?')
              .run(status, `${message ?? ''}${limitations ? ` Limitações: ${limitations}` : ''}`.slice(0,255),
                now, kind === 'running' ? null : row.completed_at ?? now,
                kind === 'running' ? null : row.report_html, session.username, row.job_id);
            if (kind === 'done' || (kind === 'failed' && typeof data.relatorio_html === 'string' && data.relatorio_html.trim())) {
              const html = kind === 'failed' ? data.relatorio_html : await callAnalysis(analysisUrl(row.report_path));
              if (!html.trim() || Buffer.byteLength(html) > 5 * 1024 * 1024) throw new Error('Relatório vazio ou acima do tamanho permitido.');
              db.prepare('UPDATE analysis_jobs SET report_html=? WHERE owner=? AND job_id=?').run(html,session.username,row.job_id);
            }
          }
          const updated = getAnalysis.get(session.username, row.job_id);
          if (!updated) {
            jsonResponse(response, 404, { error: 'A análise foi substituída por uma nova solicitação.' });
            return;
          }
          jsonResponse(response, 200, serializeAnalysis(updated));
        } catch (error) {
          console.error('Falha ao consultar análise:', error);
          if (error.code === 'INVALID_ANALYSIS_ADDRESS') {
            const now = Date.now();
            db.prepare(`UPDATE analysis_jobs SET status='erro',message=?,updated_at=?,completed_at=?
              WHERE owner=? AND job_id=?`).run(error.message.slice(0,255), now, row.completed_at ?? now, session.username, row.job_id);
            const failed = getAnalysis.get(session.username, row.job_id);
            if (!failed) {
              jsonResponse(response, 404, { error: 'A análise foi substituída por uma nova solicitação.' });
              return;
            }
            jsonResponse(response, 200, serializeAnalysis(failed));
            return;
          }
          jsonResponse(response, error.statusCode ?? 502, { error: error.message });
        }
        return;
      }
      jsonResponse(response, 405, { error: 'Método não permitido.' });
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
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(upstreamTimeoutMs)])
        });
        if (!upstream.ok) {
          const contentType = upstream.headers.get('content-type') ?? '';
          if (!contentType.includes('application/json')) {
            await requireUpstreamSuccess(upstream, 'O serviço de pesquisa n8n');
          }
        }
        response.statusCode = upstream.status;
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
        if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
        else response.end();
      } catch (error) {
        if (controller.signal.aborted && error.name === 'AbortError') return;
        console.error('Falha ao consultar endpoint PNCP:', error);
        if (response.headersSent || response.destroyed) {
          response.destroy();
          return;
        }
        const failure = upstreamError('o serviço de pesquisa n8n', error);
        jsonResponse(response, failure.statusCode ?? 502, { error: failure.message });
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
