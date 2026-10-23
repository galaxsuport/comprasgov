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
  idContratacaoPNCP: '40176679000199-1-326/2027',
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

test('suspended status uses the red SRP styling without changing other statuses', () => {
  for (const situacao of ['Suspensa', 'SUSPENSA', ' suspensa ']) {
    const html = renderToStaticMarkup(createElement(ResultCard, {
      result: { ...result, situacao, registroPreco: true }
    }));
    assert.match(html, /class="badge badge-suspended"[^>]*aria-label="Situação do edital:/);
    assert.match(html, /class="badge badge-srp">SRP/);
  }
  for (const situacao of ['Divulgada', 'Encerrada', null]) {
    const html = renderToStaticMarkup(createElement(ResultCard, { result: { ...result, situacao } }));
    assert.doesNotMatch(html, /badge-suspended/);
  }
});

test('expired proposal deadline shows a red closed-submission message', () => {
  const html = renderToStaticMarkup(createElement(ResultCard, {
    result: { ...result, dataEncerramentoProposta: new Date(Date.now() - 1000).toISOString() }
  }));
  assert.match(html, /<div class="card-time-expired"><span>Tempo restante<\/span><strong>Envio de proposta encerrada<\/strong><\/div>/);
  assert.doesNotMatch(html, /0 dias, 0 horas e 0 minutos restantes/);
});

test('proposal deadline in the future keeps the remaining-time display', () => {
  const html = renderToStaticMarkup(createElement(ResultCard, {
    result: { ...result, dataEncerramentoProposta: new Date(Date.now() + 60 * 60 * 1000).toISOString() }
  }));
  assert.match(html, /<div><span>Tempo restante<\/span><strong>\d+ dias, \d+ horas? e \d+ minutos? restantes<\/strong><\/div>/);
  assert.doesNotMatch(html, /card-time-expired|Envio de proposta encerrada/);
});

test('opportunity header shows instrument type and purchase number between location and buyer', () => {
  const html = renderToStaticMarkup(createElement(ResultCard, {
    result: {
      ...result,
      local: 'Brasília/DF',
      unidadeCompradora: '123456 - Órgão/DF',
      tipoInstrumentoConvocatorio: 'Edital'
    }
  }));
  assert.ok(html.indexOf('<h2>Brasília/DF</h2>') < html.indexOf('<p class="subline">Edital nº 326/2027</p>'));
  assert.ok(html.indexOf('<p class="subline">Edital nº 326/2027</p>') < html.indexOf('<p class="subline">123456 - Órgão/DF</p>'));
});

test('opportunity header displays other instrument types and does not assume Edital', () => {
  const otherType = renderToStaticMarkup(createElement(ResultCard, {
    result: { ...result, tipoInstrumentoConvocatorio: 'Aviso de Contratação Direta' }
  }));
  assert.match(otherType, /<p class="subline">Aviso de Contratação Direta nº 326\/2027<\/p>/);

  const missingType = renderToStaticMarkup(createElement(ResultCard, { result }));
  assert.match(missingType, /<p class="subline">nº 326\/2027<\/p>/);
  assert.doesNotMatch(missingType, /Edital nº 326\/2027/);
});

test('opportunity header adds the PNCP year when the purchase number has no year', () => {
  const html = renderToStaticMarkup(createElement(ResultCard, {
    result: { ...result, idContratacaoPNCP: '40176679000199-1-000326/2027', numeroCompra: '326' }
  }));
  assert.match(html, /<p class="subline">nº 326\/2027<\/p>/);
});

test('analysis button remains clickable and reports when the PNCP ID is missing', () => {
  const html = renderToStaticMarkup(createElement(ResultCard, {
    result: { ...result, idContratacaoPNCP: null, linkContratacao: null },
    onAnalyze() {}
  }));
  assert.match(html, /<button[^>]*class="discard-toggle analyze-btn"[^>]*title="Id contratação PNCP indisponível"/);
  assert.doesNotMatch(html, /<button[^>]*class="discard-toggle analyze-btn"[^>]*disabled=""/);
});

test('status loading and failure indicators are controlled by the registered-proposals refresh', () => {
  const idle = renderToStaticMarkup(createElement(ResultCard, { result }));
  assert.doesNotMatch(idle, /Atualizando situação|Situação não atualizada/);
  const loading = renderToStaticMarkup(createElement(ResultCard, { result, statusLoading: true }));
  assert.match(loading, /Atualizando situação/);
  const failed = renderToStaticMarkup(createElement(ResultCard, {
    result: { ...result, situacao: 'Divulgada' },
    statusError: 'PNCP respondeu HTTP 429.'
  }));
  assert.match(failed, /Situação do edital: Divulgada/);
  assert.match(failed, /title="PNCP respondeu HTTP 429.">Situação não atualizada/);
});
