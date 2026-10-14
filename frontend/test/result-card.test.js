import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

function moduleUrl(path) {
  let source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX
    }
  }).outputText;
  source = source.replace(/from (['"])(.*?)\1/g, (match, quote, name) => {
    const url = name.startsWith('.')
      ? moduleUrl(new URL(`${name}${name.endsWith('TimeRemaining') ? '.tsx' : '.ts'}`, path))
      : import.meta.resolve(name);
    return `from ${JSON.stringify(url)}`;
  });
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

const { default: ResultCard } = await import(moduleUrl(new URL('../src/components/ResultCard.tsx', import.meta.url)));
const result = {
  tipoSaida: 'oportunidade',
  idContratacaoPNCP: 'test',
  uasg: '985825',
  numeroCompra: '326/2027',
  linkContratacao: 'https://pncp.gov.br/test',
  cadastroProposta: 'https://compras.gov.br/test',
  dataEncerramentoProposta: null
};
const callbacks = {
  onAnalyze() {}, onCancelAnalysis() {}, onToggleRegister() {},
  onOpenCalendar() {}, onToggleDiscard() {}
};

function render(isDiscarded, status, hasReport) {
  return renderToStaticMarkup(createElement(ResultCard, {
    result, ...callbacks, isRegistered: true, isDiscarded,
    analysisJob: { jobId: 'test-job', status, hasReport, startedAt: 0, completedAt: null }
  }));
}

test('discarded cards disable every action except undo, including active cancellation', () => {
  for (const [status, hasReport] of [['concluido', true], ['processando', false]]) {
    const html = render(true, status, hasReport);
    const buttons = [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/gs)];
    assert.equal(buttons.length, 5);
    for (const [, attributes, content] of buttons) {
      assert.equal(attributes.includes('disabled=""'), !content.includes('Desfazer descartar'));
    }
    const links = [...html.matchAll(/<a\b([^>]*)>/g)];
    assert.equal(links.length, hasReport ? 2 : 1);
    for (const [, attributes] of links) {
      assert.match(attributes, /aria-disabled="true"/);
      assert.match(attributes, /tabindex="-1"/);
      assert.doesNotMatch(attributes, /\bhref=/);
    }
  }
});

test('undoing discard restores buttons and report/purchase links', () => {
  const html = render(false, 'concluido', true);
  assert.doesNotMatch(html, /disabled=""|aria-disabled="true"|tabindex="-1"/);
  assert.match(html, /href="\/api\/analysis\/test-job\/report"/);
  assert.match(html, /href="https:\/\/pncp.gov.br\/test"/);
  assert.match(html, /Refazer análise/);
});
