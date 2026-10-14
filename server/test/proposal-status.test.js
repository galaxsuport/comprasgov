import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createApiServer } from '../app.js';

test('refreshes the official status and updates saved proposals only for the current account', async () => {
  const db = new Database(':memory:');
  const calls = [];
  let status = 200;
  let data = { situacaoCompraNome: 'Suspensa' };
  const server = createApiServer({
    db, authDisabled: true, username: 'fixture',
    pncpFetch: async (url, init) => {
      calls.push(url);
      assert.equal(init.redirect, 'error');
      return Response.json(data, { status });
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const id = '12345678000199-1-000031/2026';
  const link = 'https://pncp.gov.br/app/editais/12345678000199/2026/31';
  const value = { tipoSaida: 'oportunidade', idContratacaoPNCP: id, linkContratacao: link, situacao: 'Divulgada', objeto: 'Servidor' };
  for (const table of ['registered_proposals', 'discarded_proposals']) {
    const insert = db.prepare(`INSERT INTO ${table} VALUES (?, ?, ?, ?)`);
    insert.run('fixture', `id:${id}`, JSON.stringify(value), 1);
    insert.run('another', `id:${id}`, JSON.stringify(value), 1);
  }
  const query = params => fetch(`${base}/api/proposals/status?${new URLSearchParams(params)}`);
  try {
    const result = await query({ id, link });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { situacao: 'Suspensa' });
    assert.deepEqual(calls, ['https://pncp.gov.br/api/consulta/v1/orgaos/12345678000199/compras/2026/31']);
    for (const table of ['registered_proposals', 'discarded_proposals']) {
      const saved = owner => JSON.parse(db.prepare(`SELECT value_json FROM ${table} WHERE owner = ?`).get(owner).value_json);
      assert.deepEqual(saved('fixture'), { ...value, situacao: 'Suspensa' });
      assert.deepEqual(saved('another'), value);
    }
    assert.equal((await query({ id })).status, 200);
    assert.equal((await query({ link: `https://pncp.gov.br/app/editais/${id}` })).status, 200);
    for (const params of [{}, { id: 'invalid' }, { link: 'http://pncp.gov.br/app/editais/12345678000199/2026/31' },
      { link: 'https://evil.com/app/editais/12345678000199/2026/31' },
      { link: 'https://pncp.gov.br@evil.com/app/editais/12345678000199/2026/31' }]) {
      const before = calls.length;
      assert.equal((await query(params)).status, 400);
      assert.equal(calls.length, before);
    }
    status = 503;
    data = { error: 'Indisponível' };
    const unavailable = await query({ id });
    assert.equal(unavailable.status, 502);
    assert.match((await unavailable.json()).error, /PNCP respondeu HTTP 503/);
    status = 200;
    data = {};
    const invalid = await query({ id });
    assert.equal(invalid.status, 502);
    assert.match((await invalid.json()).error, /situação inválida/);
    assert.equal(JSON.parse(db.prepare('SELECT value_json FROM registered_proposals WHERE owner = ?').get('fixture').value_json).situacao, 'Suspensa');
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('status lookup requires authentication and exposes PNCP timeouts', async () => {
  const db = new Database(':memory:');
  let calls = 0;
  const server = createApiServer({
    db, username: 'fixture', password: 'password',
    pncpFetch: async () => { calls++; throw new DOMException('timeout', 'TimeoutError'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const path = '/api/proposals/status?id=12345678000199-1-31%2F2026';
  try {
    assert.equal((await fetch(`${base}${path}`)).status, 401);
    assert.equal(calls, 0);
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'fixture', password: 'password' })
    });
    const result = await fetch(`${base}${path}`, { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
    assert.equal(result.status, 504);
    assert.match((await result.json()).error, /Tempo limite.*PNCP/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});
