import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createApiServer } from '../app.js';
import { startProposalStatusCron, STATUS_CRON_EXPRESSION, STATUS_CRON_TIMEZONE } from '../proposal-status-cron.js';

test('hourly cron updates every account, deduplicates PNCP calls and preserves failed statuses', async () => {
  const db = new Database(':memory:');
  createApiServer({ db, authDisabled: true });
  const insert = db.prepare('INSERT INTO registered_proposals VALUES (?, ?, ?, ?)');
  const proposal = (sequence, extra = {}) => ({
    tipoSaida: 'oportunidade', idContratacaoPNCP: `12345678000199-1-${sequence}/2026`,
    situacao: 'Divulgada', objeto: 'Servidor', dataEncerramentoProposta: '2000-01-01', ...extra
  });
  insert.run('first', 'id:1', JSON.stringify(proposal(1)), 1);
  insert.run('second', 'id:1', JSON.stringify(proposal(1)), 2);
  insert.run('first', 'id:2', JSON.stringify(proposal(2)), 3);
  insert.run('first', 'id:3', JSON.stringify(proposal(3)), 4);
  insert.run('first', 'invalid', JSON.stringify({ situacao: 'Sem identificador' }), 5);
  db.prepare('INSERT INTO discarded_proposals VALUES (?, ?, ?, ?)').run('first', 'id:1', JSON.stringify(proposal(1)), 1);
  const calls = [];
  const cron = startProposalStatusCron({
    db, fetchImpl: async url => {
      calls.push(url);
      if (url.endsWith('/2')) return Response.json({ error: 'Indisponível' }, { status: 503 });
      if (url.endsWith('/3')) return Response.json({ situacaoCompraNome: 'Encerrada' });
      return Response.json({ situacaoCompraNome: 'Suspensa' });
    }
  });
  try {
    assert.equal(STATUS_CRON_EXPRESSION, '0 * * * *');
    assert.equal(STATUS_CRON_TIMEZONE, 'America/Sao_Paulo');
    const next = cron.task.getNextRun();
    assert.equal(next.getUTCMinutes(), 0);
    assert.equal(next.getUTCSeconds(), 0);
    assert.equal(cron.task.getStatus(), 'idle');
    const result = await cron.task.execute();
    assert.deepEqual(result, { updated: 3, failed: 2 });
    assert.equal(calls.length, 3);
    const saved = (owner, key) => JSON.parse(db.prepare('SELECT value_json FROM registered_proposals WHERE owner = ? AND proposal_key = ?').get(owner, key).value_json);
    assert.deepEqual(saved('first', 'id:1'), { ...proposal(1), situacao: 'Suspensa' });
    assert.deepEqual(saved('second', 'id:1'), { ...proposal(1), situacao: 'Suspensa' });
    assert.equal(saved('first', 'id:2').situacao, 'Divulgada');
    assert.equal(saved('first', 'id:3').situacao, 'Encerrada');
    assert.equal(saved('first', 'invalid').situacao, 'Sem identificador');
    assert.equal(JSON.parse(db.prepare('SELECT value_json FROM discarded_proposals').get().value_json).situacao, 'Divulgada');
    assert.equal(db.prepare('SELECT registered_at FROM registered_proposals WHERE owner = ? AND proposal_key = ?').get('second', 'id:1').registered_at, 2);
  } finally {
    await cron.stop();
    assert.equal(cron.task.getStatus(), 'destroyed');
    db.close();
  }
});

test('cron does not resurrect removed schedules or overwrite edits made during the PNCP request', async () => {
  const db = new Database(':memory:');
  createApiServer({ db, authDisabled: true });
  const proposal = { idContratacaoPNCP: '12345678000199-1-1/2026', situacao: 'Divulgada', objeto: 'Antes' };
  for (const owner of ['deleted', 'edited']) {
    db.prepare('INSERT INTO registered_proposals VALUES (?, ?, ?, ?)').run(owner, 'id:1', JSON.stringify(proposal), 1);
  }
  const cron = startProposalStatusCron({
    db, fetchImpl: async () => {
      db.prepare('DELETE FROM registered_proposals WHERE owner = ?').run('deleted');
      db.prepare('UPDATE registered_proposals SET value_json = ? WHERE owner = ?').run(JSON.stringify({ ...proposal, objeto: 'Depois' }), 'edited');
      return Response.json({ situacaoCompraNome: 'Revogada' });
    }
  });
  try {
    assert.deepEqual(await cron.task.execute(), { updated: 1, failed: 0 });
    assert.equal(db.prepare('SELECT count(*) AS count FROM registered_proposals').get().count, 1);
    assert.deepEqual(JSON.parse(db.prepare('SELECT value_json FROM registered_proposals').get().value_json), { ...proposal, objeto: 'Depois', situacao: 'Revogada' });
  } finally {
    await cron.stop();
    db.close();
  }
});

test('shutdown cancels an in-flight PNCP request before the database is closed', async () => {
  const db = new Database(':memory:');
  createApiServer({ db, authDisabled: true });
  db.prepare('INSERT INTO registered_proposals VALUES (?, ?, ?, ?)').run(
    'fixture', 'id:1', JSON.stringify({ idContratacaoPNCP: '12345678000199-1-1/2026', situacao: 'Divulgada' }), 1
  );
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let aborted = false;
  const cron = startProposalStatusCron({
    db, fetchImpl: async (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        aborted = true;
        reject(init.signal.reason);
      }, { once: true });
      started();
    })
  });
  try {
    const execution = cron.task.execute();
    const rejection = assert.rejects(execution, /Cron de situação encerrado/);
    await ready;
    await cron.stop();
    await rejection;
    assert.equal(aborted, true);
    assert.equal(JSON.parse(db.prepare('SELECT value_json FROM registered_proposals').get().value_json).situacao, 'Divulgada');
  } finally {
    await cron.stop();
    db.close();
  }
});
