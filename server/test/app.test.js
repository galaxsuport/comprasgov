import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createWebhookServer } from 'node:http';
import Database from 'better-sqlite3';
import { createApiServer } from '../app.js';

const username = 'test-user';
const password = 'test-password';
const proposal = {
  tipoSaida: 'oportunidade',
  idContratacaoPNCP: '123',
  linkContratacao: null,
  objeto: 'Pregão de teste'
};

let db;
let server;
let baseUrl;
let databasePath;
let testDir;
let staticDir;
let webhookServer;
let webhookUrl;

before(async () => {
  testDir = mkdtempSync(join(tmpdir(), 'comprasgov-api-test-'));
  databasePath = join(testDir, 'comprasgov.sqlite');
  staticDir = join(testDir, 'public');
  mkdirSync(staticDir);
  writeFileSync(join(staticDir, 'index.html'), '<main>ComprasGov test</main>');
  webhookServer = createWebhookServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ url: request.url }));
  });
  await new Promise(resolve => webhookServer.listen(0, '127.0.0.1', resolve));
  webhookUrl = `http://127.0.0.1:${webhookServer.address().port}/hook?token=fixture`;
  db = new Database(databasePath);
  db.exec(`
    CREATE TABLE favorites (
      owner TEXT NOT NULL,
      favorite_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (owner, favorite_key)
    )
  `);
  db.prepare('INSERT INTO favorites VALUES (?, ?, ?, ?)').run(
    username,
    'id:legacy',
    JSON.stringify({ tipoSaida: 'oportunidade', idContratacaoPNCP: 'legacy' }),
    Date.now()
  );
  server = createApiServer({ db, username, password, staticDir, webhookUrl });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => webhookServer.close(resolve));
  db.close();
  rmSync(testDir, { recursive: true, force: true });
});

async function login() {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return { response, cookie: response.headers.get('set-cookie')?.split(';', 1)[0] };
}

test('requires authentication and creates an HttpOnly session', async () => {
  const { response, cookie } = await login();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.ok(cookie);

  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
  assert.deepEqual(await session.json(), { authenticated: true, authRequired: true });
});

test('removes legacy favorites from the database and API', async () => {
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'favorites'").get(),
    undefined
  );
  assert.equal((await fetch(`${baseUrl}/api/favorites`)).status, 404);
});

test('serves the frontend for page routes and rejects missing assets', async () => {
  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<main>ComprasGov test</main>');

  const clientRoute = await fetch(`${baseUrl}/favoritos`);
  assert.equal(clientRoute.status, 200);
  assert.equal(await clientRoute.text(), '<main>ComprasGov test</main>');

  const missingAsset = await fetch(`${baseUrl}/missing.js`);
  assert.equal(missingAsset.status, 404);
});

test('proxies procurement requests and preserves configured webhook parameters', async () => {
  const response = await fetch(`${baseUrl}/api/pregoes?ufs=SP`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { url: '/hook?token=fixture&ufs=SP' });
});

test('rejects invalid credentials', async () => {
  const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'wrong' })
  });
  assert.equal(invalidLogin.status, 401);
});

test('changes the password and persists it over AUTH_PASSWORD', async () => {
  const isolatedDb = new Database(':memory:');
  const isolated = createApiServer({ db: isolatedDb, username, password, staticDir, webhookUrl });
  await new Promise(resolve => isolated.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${isolated.address().port}`;
  const post = (path, body, cookie) => fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body)
  });

  try {
    const first = await post('/api/auth/login', { username, password });
    const cookie = first.headers.get('set-cookie').split(';', 1)[0];

    assert.equal((await post('/api/auth/password', { currentPassword: password, newPassword: 'new-password-1' })).status, 401);
    assert.equal((await post('/api/auth/password', { currentPassword: 'wrong', newPassword: 'new-password-1' }, cookie)).status, 400);
    assert.equal((await post('/api/auth/password', { currentPassword: password, newPassword: 'short' }, cookie)).status, 400);
    assert.equal((await post('/api/auth/password', { currentPassword: password, newPassword: 'new-password-1' }, cookie)).status, 200);

    assert.equal((await post('/api/auth/login', { username, password })).status, 401);
    assert.equal((await post('/api/auth/login', { username, password: 'new-password-1' })).status, 200);
  } finally {
    await new Promise(resolve => isolated.close(resolve));
    isolatedDb.close();
  }
});

test('seeds default strong terms and persists edits per account', async () => {
  const { cookie } = await login();
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  assert.equal((await fetch(`${baseUrl}/api/settings/strong-terms`)).status, 401);

  const seeded = await (await fetch(`${baseUrl}/api/settings/strong-terms`, { headers })).json();
  assert.ok(seeded.terms.includes('tecnologia da informação'));
  assert.ok(seeded.terms.includes('controle de acesso eletrônico'));
  assert.equal(seeded.terms.length, 140);
  assert.ok(seeded.terms.includes('rj-45'));

  const saved = await fetch(`${baseUrl}/api/settings/strong-terms`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ terms: ['  Cloud ', 'cloud', 'novo termo'] })
  });
  assert.deepEqual((await saved.json()).terms, ['Cloud', 'novo termo']);

  const reread = await (await fetch(`${baseUrl}/api/settings/strong-terms`, { headers })).json();
  assert.deepEqual(reread.terms, ['Cloud', 'novo termo']);

  const invalid = await fetch(`${baseUrl}/api/settings/strong-terms`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ terms: [123] })
  });
  assert.equal(invalid.status, 400);
});

test('seeds and persists contextual terms independently from strong terms', async () => {
  const { cookie } = await login();
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  assert.equal((await fetch(`${baseUrl}/api/settings/contextual-terms`)).status, 401);

  const seeded = await (await fetch(`${baseUrl}/api/settings/contextual-terms`, { headers })).json();
  assert.equal(seeded.terms.length, 20);
  assert.ok(seeded.terms.includes('armazenamento'));

  const saved = await fetch(`${baseUrl}/api/settings/contextual-terms`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ terms: ['sistema', 'rede'] })
  });
  assert.deepEqual((await saved.json()).terms, ['sistema', 'rede']);

  const strong = await (await fetch(`${baseUrl}/api/settings/strong-terms`, { headers })).json();
  assert.ok(!strong.terms.includes('rede'));
  assert.ok(!strong.terms.includes('sistema'));
  assert.equal((await fetch(`${baseUrl}/api/settings/unknown`, { headers })).status, 404);
});

test('seeds and persists technological contexts', async () => {
  const { cookie } = await login();
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  assert.equal((await fetch(`${baseUrl}/api/settings/technological-contexts`)).status, 401);

  const seeded = await (await fetch(`${baseUrl}/api/settings/technological-contexts`, { headers })).json();
  assert.equal(seeded.terms.length, 23);
  assert.ok(seeded.terms.includes('ethernet'));

  const saved = await fetch(`${baseUrl}/api/settings/technological-contexts`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ terms: ['tic', 'wan'] })
  });
  assert.deepEqual((await saved.json()).terms, ['tic', 'wan']);

  const contextual = await (await fetch(`${baseUrl}/api/settings/contextual-terms`, { headers })).json();
  assert.ok(!contextual.terms.includes('wan'));
});

test('seeds and persists exclusion terms', async () => {
  const { cookie } = await login();
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  assert.equal((await fetch(`${baseUrl}/api/settings/exclusion-terms`)).status, 401);

  const seeded = await (await fetch(`${baseUrl}/api/settings/exclusion-terms`, { headers })).json();
  assert.equal(seeded.terms.length, 20);
  assert.ok(seeded.terms.includes('fornecimento de veículos'));

  const saved = await fetch(`${baseUrl}/api/settings/exclusion-terms`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ terms: ['poltrona', 'mobiliário'] })
  });
  assert.deepEqual((await saved.json()).terms, ['poltrona', 'mobiliário']);
});

test('stores the deadline between 1 and 15 per account', async () => {
  const { cookie } = await login();
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const put = value => fetch(`${baseUrl}/api/settings/deadline`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ value })
  });

  assert.equal((await fetch(`${baseUrl}/api/settings/deadline`)).status, 401);
  assert.deepEqual(await (await fetch(`${baseUrl}/api/settings/deadline`, { headers })).json(), { value: 7 });

  assert.equal((await put(0)).status, 400);
  assert.equal((await put(16)).status, 400);
  assert.equal((await put(2.5)).status, 400);
  assert.equal((await put('5')).status, 400);

  assert.equal((await put(15)).status, 200);
  assert.deepEqual(await (await fetch(`${baseUrl}/api/settings/deadline`, { headers })).json(), { value: 15 });
});

test('adds account settings to webhook requests and overrides client values', async () => {
  const isolatedDb = new Database(':memory:');
  const isolated = createApiServer({ db: isolatedDb, username, password, staticDir, webhookUrl, defaultDeadlineDays: 5 });
  await new Promise(resolve => isolated.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${isolated.address().port}`;

  try {
    const loginResponse = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const headers = { Cookie: loginResponse.headers.get('set-cookie').split(';', 1)[0], 'Content-Type': 'application/json' };

    await fetch(`${url}/api/settings/strong-terms`, { method: 'PUT', headers, body: JSON.stringify({ terms: ['firewall', 'data center'] }) });
    await fetch(`${url}/api/settings/exclusion-terms`, { method: 'PUT', headers, body: JSON.stringify({ terms: ['poltrona'] }) });
    await fetch(`${url}/api/settings/deadline`, { method: 'PUT', headers, body: JSON.stringify({ value: 12 }) });

    const response = await fetch(`${url}/api/pregoes?ufs=SP&prazo=1&termosFortes=hack`, { headers });
    const upstream = new URL((await response.json()).url, 'http://localhost').searchParams;

    assert.equal(upstream.get('ufs'), 'SP');
    assert.equal(upstream.get('prazo'), '12');
    assert.equal(upstream.get('termosFortes'), 'firewall,data center');
    assert.equal(upstream.get('termosExclusao'), 'poltrona');
    assert.ok(upstream.get('termosContextuais').split(',').includes('armazenamento'));
    assert.ok(upstream.get('contextosTecnologicos').split(',').includes('ethernet'));
    assert.equal(upstream.get('token'), 'fixture');
  } finally {
    await new Promise(resolve => isolated.close(resolve));
    isolatedDb.close();
  }
});

test('merges new strong terms once into lists saved earlier', async () => {
  const isolatedDb = new Database(':memory:');
  const isolated = createApiServer({ db: isolatedDb, username, password, staticDir, webhookUrl });
  isolatedDb.prepare('INSERT INTO settings (owner, key, value_json, updated_at) VALUES (?, ?, ?, ?)')
    .run(username, 'strong_terms', JSON.stringify(['software', 'Notebook']), Date.now());
  await new Promise(resolve => isolated.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${isolated.address().port}`;

  try {
    const loginResponse = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const headers = { Cookie: loginResponse.headers.get('set-cookie').split(';', 1)[0], 'Content-Type': 'application/json' };
    const read = async () => (await (await fetch(`${url}/api/settings/strong-terms`, { headers })).json()).terms;

    const merged = await read();
    assert.equal(merged.length, 30);
    assert.equal(merged.filter(term => term.toLowerCase() === 'notebook').length, 1);
    assert.ok(merged.includes('toner'));

    await fetch(`${url}/api/settings/strong-terms`, { method: 'PUT', headers, body: JSON.stringify({ terms: ['software'] }) });
    assert.deepEqual(await read(), ['software']);
  } finally {
    await new Promise(resolve => isolated.close(resolve));
    isolatedDb.close();
  }
});

test('stores the company name per user with a default', async () => {
  const isolatedDb = new Database(':memory:');
  const isolated = createApiServer({ db: isolatedDb, username, password, staticDir, webhookUrl });
  await new Promise(resolve => isolated.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${isolated.address().port}`;

  try {
    const loginResponse = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const headers = { Cookie: loginResponse.headers.get('set-cookie').split(';', 1)[0], 'Content-Type': 'application/json' };
    const get = async () => (await (await fetch(`${url}/api/settings/company-name`, { headers })).json()).value;
    const put = value => fetch(`${url}/api/settings/company-name`, { method: 'PUT', headers, body: JSON.stringify({ value }) });

    assert.equal(await get(), 'GALAX SUPORT');
    assert.equal((await put('  Minha   Empresa ')).status, 200);
    assert.equal(await get(), 'MINHA EMPRESA');
    assert.equal((await put('   ')).status, 400);

    assert.equal(await (await fetch(`${url}/api/settings/title`, { headers })).json().then(d => d.value), 'Contratações TIC');
    const savedSubtitle = await fetch(`${url}/api/settings/subtitle`, { method: 'PUT', headers, body: JSON.stringify({ value: ' Novo   subtítulo ' }) });
    assert.equal((await savedSubtitle.json()).value, 'Novo subtítulo');
    assert.equal((await fetch(`${url}/api/settings/title`, { method: 'PUT', headers, body: JSON.stringify({ value: 'x'.repeat(121) }) })).status, 400);

    const publicName = await (await fetch(`${url}/api/auth/company`)).json();
    assert.equal(publicName.value, 'MINHA EMPRESA');
    assert.equal(publicName.title, 'Contratações TIC');
  } finally {
    await new Promise(resolve => isolated.close(resolve));
    isolatedDb.close();
  }
});

test('stores discarded proposals per user and restores them', async () => {
  const isolatedDb = new Database(':memory:');
  const isolated = createApiServer({ db: isolatedDb, username, password, staticDir, webhookUrl });
  await new Promise(resolve => isolated.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${isolated.address().port}`;

  try {
    assert.equal((await fetch(`${url}/api/discarded`)).status, 401);
    const loginResponse = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const headers = { Cookie: loginResponse.headers.get('set-cookie').split(';', 1)[0], 'Content-Type': 'application/json' };
    const proposal = { tipoSaida: 'oportunidade', idContratacaoPNCP: 'abc-1', objeto: 'Servidor' };

    assert.equal((await fetch(`${url}/api/discarded`, { method: 'POST', headers, body: JSON.stringify({ proposal: { tipoSaida: 'resumo' } }) })).status, 400);
    assert.equal((await fetch(`${url}/api/discarded`, { method: 'POST', headers, body: JSON.stringify({ proposal }) })).status, 200);
    assert.deepEqual(await (await fetch(`${url}/api/discarded`, { headers })).json(), [proposal]);

    assert.equal((await fetch(`${url}/api/discarded/${encodeURIComponent('id:abc-1')}`, { method: 'DELETE', headers })).status, 204);
    assert.deepEqual(await (await fetch(`${url}/api/discarded`, { headers })).json(), []);
  } finally {
    await new Promise(resolve => isolated.close(resolve));
    isolatedDb.close();
  }
});

test('stores registered proposals per user and restores them', async () => {
  const isolatedDb = new Database(':memory:');
  const isolated = createApiServer({ db: isolatedDb, username, password, staticDir, webhookUrl });
  await new Promise(resolve => isolated.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${isolated.address().port}`;

  try {
    assert.equal((await fetch(`${url}/api/registered`)).status, 401);
    const loginResponse = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const headers = { Cookie: loginResponse.headers.get('set-cookie').split(';', 1)[0], 'Content-Type': 'application/json' };
    const proposal = { tipoSaida: 'oportunidade', idContratacaoPNCP: 'reg-1', objeto: 'Servidor Registrado' };

    assert.equal((await fetch(`${url}/api/registered`, { method: 'POST', headers, body: JSON.stringify({ proposal: { tipoSaida: 'resumo' } }) })).status, 400);
    assert.equal((await fetch(`${url}/api/registered`, { method: 'POST', headers, body: JSON.stringify({ proposal }) })).status, 200);
    assert.deepEqual(await (await fetch(`${url}/api/registered`, { headers })).json(), [proposal]);

    assert.equal((await fetch(`${url}/api/registered/${encodeURIComponent('id:reg-1')}`, { method: 'DELETE', headers })).status, 204);
    assert.deepEqual(await (await fetch(`${url}/api/registered`, { headers })).json(), []);
  } finally {
    await new Promise(resolve => isolated.close(resolve));
    isolatedDb.close();
  }
});

test('preserves analysis data across initialization without affecting proposals or settings', async () => {
  const legacyDb = new Database(':memory:');
  legacyDb.exec(`
    CREATE TABLE analysis_jobs (
      owner TEXT NOT NULL, job_id TEXT NOT NULL, proposal_key TEXT NOT NULL,
      proposal_json TEXT NOT NULL, status TEXT NOT NULL, message TEXT,
      consult_path TEXT NOT NULL, report_path TEXT NOT NULL, report_html TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      started_at INTEGER, completed_at INTEGER,
      PRIMARY KEY (owner, job_id)
    );
    CREATE TABLE registered_proposals (
      owner TEXT NOT NULL, proposal_key TEXT NOT NULL, value_json TEXT NOT NULL,
      registered_at INTEGER NOT NULL, PRIMARY KEY (owner, proposal_key)
    );
    CREATE TABLE discarded_proposals (
      owner TEXT NOT NULL, proposal_key TEXT NOT NULL, value_json TEXT NOT NULL,
      discarded_at INTEGER NOT NULL, PRIMARY KEY (owner, proposal_key)
    );
    CREATE TABLE settings (
      owner TEXT NOT NULL, key TEXT NOT NULL, value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL, PRIMARY KEY (owner, key)
    )
  `);
  legacyDb.prepare('INSERT INTO analysis_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(username, 'legacy-job', 'id:123', JSON.stringify(proposal), 'concluido', 'x'.repeat(300),
      '/consult', '/report', '<h1>Legacy report</h1>', 1, 2, 1, 2);
  legacyDb.prepare('INSERT INTO analysis_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(username, 'pendente-obsolete', 'id:obsolete', JSON.stringify(proposal), 'pendente', 'Aguardando início',
      '', '', null, 1, 2, null, null);
  for (const table of ['registered_proposals', 'discarded_proposals']) {
    legacyDb.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?)`)
      .run(username, 'id:123', JSON.stringify(proposal), 1);
  }
  legacyDb.prepare('INSERT INTO settings VALUES (?, ?, ?, ?)').run(username, 'deadline_days', '7', 1);
  const api = createApiServer({ db: legacyDb, username, password, staticDir, webhookUrl });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${api.address().port}`;
  try {
    const loginResponse = await fetch(`${url}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const cookie = loginResponse.headers.get('set-cookie').split(';', 1)[0];
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

    assert.equal(legacyDb.prepare('SELECT count(*) AS count FROM analysis_jobs').get().count, 1);
    const jobs = await (await fetch(`${url}/api/analysis`, { headers })).json();
    assert.equal(jobs[0].jobId, 'legacy-job');
    assert.equal(jobs[0].hasReport, true);
    assert.equal(jobs[0].message, 'x'.repeat(255));
    assert.equal(legacyDb.prepare('SELECT message FROM analysis_jobs').get().message, 'x'.repeat(255));
    const report = await fetch(`${url}/api/analysis/legacy-job/report`, { headers });
    assert.equal(report.status, 200);
    assert.match(await report.text(), /Legacy report/);
    assert.match(report.headers.get('content-security-policy'), /sandbox/);
    for (const [method, path] of [
      ['POST', '/api/analysis/legacy-job/start'], ['POST', '/api/analysis/legacy-job/restart'],
      ['DELETE', '/api/analysis/legacy-job/job']
    ]) {
      const response = await fetch(`${url}${path}`, { method, headers });
      assert.equal(response.status, 404, `${method} ${path}`);
    }
    assert.deepEqual(await (await fetch(`${url}/api/registered`, { headers })).json(), [proposal]);
    assert.deepEqual(await (await fetch(`${url}/api/discarded`, { headers })).json(), [proposal]);
    assert.equal((await (await fetch(`${url}/api/settings/deadline`, { headers })).json()).value, 7);
    const tables = legacyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    const restarted = createApiServer({ db: legacyDb, username, password, staticDir, webhookUrl });
    assert.deepEqual(legacyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(), tables);
    assert.equal(restarted.listening, false);
  } finally {
    await new Promise(resolve => api.close(resolve));
    legacyDb.close();
  }
});

test('skips login when authentication is disabled for homologation', async () => {
  const openDb = new Database(':memory:');
  const open = createApiServer({ db: openDb, staticDir, webhookUrl, authDisabled: true });
  await new Promise(resolve => open.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${open.address().port}`;
  try {
    const session = await (await fetch(`${url}/api/auth/session`)).json();
    assert.deepEqual(session, { authenticated: true, authRequired: false });
    assert.equal((await fetch(`${url}/api/favorites`)).status, 404);
  } finally {
    await new Promise(resolve => open.close(resolve));
    openDb.close();
  }
});
