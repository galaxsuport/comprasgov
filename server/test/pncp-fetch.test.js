import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPncpFetch } from '../pncp-fetch.js';

test('serializes PNCP requests and honors Retry-After without repeating limited requests', async () => {
  let now = 1000;
  let calls = 0;
  const pncpFetch = createPncpFetch({
    minIntervalMs: 1000,
    now: () => now,
    sleep: async delay => { now += delay; },
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? new Response(null, { status: 429, headers: { 'Retry-After': '5' } })
        : Response.json({ ok: true });
    }
  });

  const limited = await pncpFetch('https://pncp.gov.br/first');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '5');
  assert.equal(calls, 1);

  const duringCooldown = await pncpFetch('https://pncp.gov.br/second');
  assert.equal(duringCooldown.status, 429);
  assert.equal(duringCooldown.headers.get('retry-after'), '5');
  assert.equal(calls, 1);

  now += 5000;
  const recovered = await pncpFetch('https://pncp.gov.br/third');
  assert.equal(recovered.status, 200);
  assert.equal(calls, 2);
});

test('reuses successful PNCP details for duplicate and recent requests', async () => {
  let calls = 0;
  const pncpFetch = createPncpFetch({
    minIntervalMs: 0,
    fetchImpl: async () => {
      calls++;
      return Response.json({ calls });
    }
  });

  const [first, duplicate] = await Promise.all([
    pncpFetch('https://pncp.gov.br/compras/1'),
    pncpFetch('https://pncp.gov.br/compras/1')
  ]);
  assert.deepEqual(await first.json(), { calls: 1 });
  assert.deepEqual(await duplicate.json(), { calls: 1 });

  const cached = await pncpFetch('https://pncp.gov.br/compras/1');
  assert.deepEqual(await cached.json(), { calls: 1 });
  assert.equal(calls, 1);
});

test('normalizes HTTP-date and missing Retry-After on the first limited response', async () => {
  for (const retryAfter of [null, 'Wed, 21 Oct 2026 16:00:45 GMT']) {
    const now = Date.parse('2026-10-21T16:00:00Z');
    let calls = 0;
    const pncpFetch = createPncpFetch({
      now: () => now,
      fetchImpl: async () => {
        calls++;
        return new Response('limite', {
          status: 429,
          headers: retryAfter ? { 'Retry-After': retryAfter } : {}
        });
      }
    });
    const first = await pncpFetch('https://pncp.gov.br/first');
    assert.equal(first.headers.get('retry-after'), retryAfter ? '45' : '30');
    assert.equal(await first.text(), 'limite');
    const queued = await pncpFetch('https://pncp.gov.br/second');
    assert.equal(queued.headers.get('retry-after'), retryAfter ? '45' : '30');
    assert.equal(calls, 1);
  }
});
