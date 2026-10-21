import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function moduleUrl(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 }
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const app = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(app) === 'openRegisteredProposals') {
    handler = node.initializer.getText(app);
  }
  ts.forEachChild(node, visit);
}
visit(app);
assert.ok(handler);
const { getUpcomingProposals } = await import(moduleUrl(
  readFileSync(new URL('../src/scheduledProposals.ts', import.meta.url), 'utf8')
));
const { createHandler } = await import(moduleUrl(`
  export function createHandler({
    setSettingsOpen, setShowDiscarded, setShowCalendar, statusRefreshRef,
    setStatusUpdates, setAppError, fetchRegistered, setRegistered,
    getUpcomingProposals, getProposalKey, fetchProposalStatus, setDiscarded, setResultados
  }) { return ${handler}; }
`));

function setup(proposals, lookup) {
  const state = {
    registered: proposals, discarded: [...proposals], resultados: [...proposals],
    statusUpdates: new Map(), appError: null, showCalendar: false
  };
  const calls = [];
  const statusRefreshRef = { current: null };
  const setter = key => value => {
    state[key] = typeof value === 'function' ? value(state[key]) : value;
  };
  const open = createHandler({
    setSettingsOpen() {}, setShowDiscarded() {},
    setShowCalendar: setter('showCalendar'),
    statusRefreshRef, setStatusUpdates: setter('statusUpdates'),
    setAppError: setter('appError'), setRegistered: setter('registered'),
    setDiscarded: setter('discarded'), setResultados: setter('resultados'),
    getUpcomingProposals,
    getProposalKey: proposal => `id:${proposal.idContratacaoPNCP}`,
    fetchRegistered: async signal => {
      signal.throwIfAborted();
      return proposals;
    },
    fetchProposalStatus: async (proposal, signal) => {
      calls.push(proposal.idContratacaoPNCP);
      return lookup(proposal, signal);
    }
  });
  return { open, state, calls, statusRefreshRef };
}

const proposal = (id, date) => ({
  tipoSaida: 'oportunidade', idContratacaoPNCP: id,
  situacao: 'Divulgada', dataEncerramentoProposta: date, objeto: id
});
const future = () => new Date(Date.now() + 86400000).toISOString();
const details = { situacao: 'Suspensa', tipoInstrumentoConvocatorio: 'Edital', numeroCompra: '1/2026' };

test('only the dashboard shortcut triggers status refresh; mounting and filtering cards cannot fetch status', () => {
  const triggers = [];
  function inspect(node) {
    if (ts.isCallExpression(node) && node.expression.getText(app) === 'openRegisteredProposals') {
      let ancestor = node.parent;
      while (ancestor && !ts.isJsxSelfClosingElement(ancestor)) ancestor = ancestor.parent;
      assert.ok(ancestor);
      triggers.push(ancestor.tagName.getText(app));
    }
    ts.forEachChild(node, inspect);
  }
  inspect(app);
  assert.deepEqual(triggers, ['DashboardView']);
  const card = readFileSync(new URL('../src/components/ResultCard.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(card, /fetchProposalStatus|\bfetch\s*\(/);
});

test('click refreshes only visible registered proposals and synchronizes their official details', async () => {
  const proposals = [
    proposal('visible', future()),
    proposal('past', new Date(Date.now() - 2 * 86400000).toISOString()),
    proposal('undated', null)
  ];
  const { open, state, calls } = setup(proposals, async () => details);
  assert.deepEqual(calls, []);
  await open();
  assert.equal(state.showCalendar, true);
  assert.deepEqual(calls, ['visible']);
  for (const list of [state.registered, state.discarded, state.resultados]) {
    assert.deepEqual(list[0], { ...proposals[0], ...details });
    assert.deepEqual(list.slice(1), proposals.slice(1));
  }
  assert.deepEqual(state.statusUpdates.get('id:visible'), { loading: false, error: null });
  await open();
  assert.deepEqual(calls, ['visible', 'visible']);
});

test('refresh failures preserve the saved status and expose the error without stopping other proposals', async () => {
  const proposals = [proposal('failed', future()), proposal('ok', future())];
  const { open, state } = setup(proposals, async item => {
    if (item.idContratacaoPNCP === 'failed') throw new Error('PNCP respondeu HTTP 429.');
    return details;
  });
  await open();
  assert.equal(state.registered[0].situacao, 'Divulgada');
  assert.equal(state.registered[1].situacao, 'Suspensa');
  assert.deepEqual(state.statusUpdates.get('id:failed'), { loading: false, error: 'PNCP respondeu HTTP 429.' });
});

test('leaving the calendar aborts pending lookups without updating data or starting the next request', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const proposals = [proposal('first', future()), proposal('second', future())];
  const { open, state, calls, statusRefreshRef } = setup(proposals, async (_, signal) => {
    started();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const pending = open();
  await ready;
  statusRefreshRef.current.abort();
  await pending;
  assert.deepEqual(calls, ['first']);
  assert.deepEqual(state.registered, proposals);
  assert.equal(state.appError, null);
});
