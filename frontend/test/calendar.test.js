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

let source = transpile('../src/components/CalendarPage.tsx');
for (const name of ['copyText', 'format', 'api']) {
  source = source.replace(`'../${name}'`, JSON.stringify(moduleUrl(transpile(`../src/${name}.ts`))));
}
for (const name of ['react/jsx-runtime', 'react']) {
  source = source.replaceAll(`"${name}"`, JSON.stringify(import.meta.resolve(name)))
    .replaceAll(`'${name}'`, JSON.stringify(import.meta.resolve(name)));
}
const { default: CalendarPage } = await import(moduleUrl(source));

function render(proposals) {
  return renderToStaticMarkup(createElement(CalendarPage, {
    proposals, onUnregister() {}, onViewProposal() {}, onBack() {}
  }));
}

test('calendar filters grid, counts and list by local day, retaining all of today', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 14, 23, 30).getTime() });
  const proposals = [
    { numeroCompra: 'past', objeto: 'Expired proposal', dataEncerramentoProposta: new Date(2026, 9, 13, 23, 59).toISOString() },
    { numeroCompra: 'today', objeto: 'Today proposal', dataEncerramentoProposta: new Date(2026, 9, 14, 0, 0).toISOString() },
    { numeroCompra: 'future', objeto: 'Future proposal', dataEncerramentoProposta: new Date(2026, 9, 15, 0, 0).toISOString() },
    { numeroCompra: 'fallback', objeto: 'Opening date proposal', dataAberturaProposta: new Date(2026, 9, 15, 12).toISOString() },
    { numeroCompra: 'publication', objeto: 'Publication date proposal', dataPublicacao: new Date(2026, 9, 16, 12).toISOString() },
    { numeroCompra: 'priority', objeto: 'Past closing proposal', dataEncerramentoProposta: new Date(2026, 9, 13).toISOString(), dataAberturaProposta: new Date(2026, 9, 15).toISOString() },
    { numeroCompra: 'missing', objeto: 'Undated proposal' },
    { numeroCompra: 'invalid', objeto: 'Invalid proposal', dataEncerramentoProposta: 'invalid' }
  ];
  const html = render(proposals);
  assert.match(html, /Todas as propostas agendadas \(4\)/);
  assert.match(html, /4 propostas agendadas para hoje ou datas futuras/);
  for (const text of ['Today proposal', 'Future proposal', 'Opening date proposal', 'Publication date proposal']) {
    assert.ok(html.includes(text), text);
  }
  for (const text of ['Expired proposal', 'Past closing proposal', 'Undated proposal', 'Invalid proposal']) {
    assert.ok(!html.includes(text), text);
  }
  assert.equal((html.match(/class="day-badge"/g) ?? []).length, 3);
  assert.equal((html.match(/Visualizar edital/g) ?? []).length, 4);
  assert.equal(proposals.length, 8);

  t.mock.timers.setTime(new Date(2026, 9, 15, 0, 1).getTime());
  const nextDay = render(proposals);
  assert.match(nextDay, /Todas as propostas agendadas \(3\)/);
  assert.ok(!nextDay.includes('Today proposal'));
});

test('calendar with only past or undated proposals opens current month and shows empty totals', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 14, 12).getTime() });
  const html = render([
    { numeroCompra: 'old', objeto: 'Old proposal', dataEncerramentoProposta: new Date(2026, 8, 30).toISOString() },
    { numeroCompra: 'missing', objeto: 'Undated proposal' }
  ]);
  assert.match(html, /Outubro de 2026/);
  assert.match(html, /Todas as propostas agendadas \(0\)/);
  assert.match(html, /Nenhuma proposta agendada para hoje ou datas futuras/);
  assert.ok(!html.includes('class="day-badge"'));
  assert.ok(!html.includes('Old proposal'));
  assert.ok(!html.includes('Undated proposal'));
});
