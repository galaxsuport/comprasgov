import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { createApiServer } from '../app.js';

test('permanently prunes past discarded deadlines, retaining today, future and unknown dates', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-14T23:30:00-03:00') });
  const db = new Database(':memory:');
  const server = createApiServer({ db, authDisabled: true, username: 'fixture' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const save = db.prepare('INSERT INTO discarded_proposals VALUES (?, ?, ?, ?)');
  const proposal = (id, dates = {}) => ({ tipoSaida: 'oportunidade', idContratacaoPNCP: id, ...dates });
  const fixtures = [
    proposal('past', { dataEncerramentoProposta: '2026-10-13T23:59:00' }),
    proposal('today', { dataEncerramentoProposta: '2026-10-14T00:00:00' }),
    proposal('future', { dataEncerramentoProposta: '2026-10-15' }),
    proposal('opening', { dataAberturaProposta: '2026-10-13' }),
    proposal('publication', { dataPublicacao: '2026-10-13' }),
    proposal('priority', { dataEncerramentoProposta: '2026-10-13', dataAberturaProposta: '2026-10-15' }),
    proposal('missing'),
    proposal('invalid', { dataEncerramentoProposta: 'invalid' }),
    proposal('impossible', { dataEncerramentoProposta: '2026-02-30' }),
    proposal('utc-today', { dataEncerramentoProposta: '2026-10-15T02:30:00Z' }),
    proposal('utc-past', { dataEncerramentoProposta: '2026-10-14T02:30:00Z' })
  ];
  for (const value of fixtures) save.run('fixture', `id:${value.idContratacaoPNCP}`, JSON.stringify(value), 1);
  save.run('another', 'id:past', JSON.stringify(fixtures[0]), 1);
  const list = async () => (await (await fetch(`${base}/api/discarded`)).json()).map(item => item.idContratacaoPNCP).sort();
  try {
    assert.deepEqual(await list(), ['future', 'impossible', 'invalid', 'missing', 'today', 'utc-today']);
    assert.equal(db.prepare('SELECT count(*) AS count FROM discarded_proposals WHERE owner = ?').get('another').count, 0);
    assert.equal(db.prepare('SELECT count(*) AS count FROM discarded_proposals').get().count, 6);
    const post = async value => fetch(`${base}/api/discarded`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposal: value })
    });
    assert.equal((await post(fixtures[0])).status, 200);
    assert.equal(db.prepare('SELECT count(*) AS count FROM discarded_proposals WHERE proposal_key = ?').get('id:past').count, 0);
    assert.equal((await post(proposal('new-today', { dataEncerramentoProposta: '2026-10-14T00:01:00-03:00' }))).status, 200);
    assert.ok((await list()).includes('new-today'));
    t.mock.timers.setTime(Date.parse('2026-10-15T00:01:00-03:00'));
    assert.deepEqual(await list(), ['future', 'impossible', 'invalid', 'missing']);
    assert.equal(db.prepare('SELECT count(*) AS count FROM discarded_proposals').get().count, 4);
  } finally {
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
});

test('removes expired discarded records on server startup without deleting scheduled proposals', () => {
  const db = new Database(':memory:');
  createApiServer({ db, authDisabled: true });
  const value = JSON.stringify({ tipoSaida: 'oportunidade', idContratacaoPNCP: 'old', dataEncerramentoProposta: '2000-01-01' });
  db.prepare('INSERT INTO discarded_proposals VALUES (?, ?, ?, ?)').run('fixture', 'id:old', value, 1);
  db.prepare('INSERT INTO registered_proposals VALUES (?, ?, ?, ?)').run('fixture', 'id:old', value, 1);
  createApiServer({ db, authDisabled: true });
  assert.equal(db.prepare('SELECT count(*) AS count FROM discarded_proposals').get().count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM registered_proposals').get().count, 1);
  db.close();
});
