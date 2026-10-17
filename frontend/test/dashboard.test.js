import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

function transpile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
}

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

let source = transpile('../src/components/Dashboard.tsx');
for (const name of ['format', 'scheduledProposals']) {
  source = source.replace(`'../${name}'`, JSON.stringify(moduleUrl(transpile(`../src/${name}.ts`))));
}
for (const name of ['react/jsx-runtime', 'react']) {
  source = source.replaceAll(`"${name}"`, JSON.stringify(import.meta.resolve(name)))
    .replaceAll(`'${name}'`, JSON.stringify(import.meta.resolve(name)));
}
const { Dashboard } = await import(moduleUrl(source));

test('dashboard counts only the proposals visible in the calendar', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 14, 12).getTime() });
  const registered = [
    ...Array.from({ length: 13 }, (_, index) => ({
      numeroCompra: `past-${index}`,
      dataEncerramentoProposta: new Date(2026, 9, 13, 12).toISOString()
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      numeroCompra: `upcoming-${index}`,
      dataEncerramentoProposta: new Date(2026, 9, 15, 12).toISOString()
    }))
  ];
  const html = renderToStaticMarkup(createElement(Dashboard, {
    results: [],
    registered,
    discarded: [],
    activeFilter: 'all',
    onSelectFilter() {},
    onOpenCalendar() {},
    onOpenDiscarded() {},
    getProposalKey: proposal => proposal.numeroCompra
  }));
  const card = html.match(/<div class="dashboard-kpi-card kpi-clickable kpi-calendar"[\s\S]*?<\/div>\s*<\/div>/)?.[0];
  assert.ok(card, 'scheduled proposals KPI is rendered');
  assert.match(card, /<div class="kpi-value">4<\/div>/);
});
