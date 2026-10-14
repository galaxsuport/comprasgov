import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{1,100}$/;

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Solicitação excedeu 2 MiB.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createExtractorTools({ baseUrl, apiKey, jobId, fetchImpl = fetch, signal }) {
  if (!ID.test(jobId)) throw new Error('job_id inválido.');
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Endereço do extrator inválido.');
  }
  async function call(path, init = {}) {
    const url = new URL(path, base);
    const response = await fetchImpl(url, {
      ...init,
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(330000)]) : AbortSignal.timeout(330000)
    });
    if (!response.ok) throw new Error(`Ferramenta do extrator respondeu HTTP ${response.status}.`);
    return response.json();
  }
  function research(name, scope, description) {
    return {
      name,
      description,
      parameters: {
        type: 'object', properties: { consulta: { type: 'string', minLength: 1, maxLength: 8000 } },
        required: ['consulta'], additionalProperties: false
      },
      handler: async args => {
        if (typeof args?.consulta !== 'string' || !args.consulta.trim() || args.consulta.length > 8000) {
          throw new Error('Consulta de pesquisa inválida.');
        }
        return call(`/jobs/${jobId}/pesquisar`, {
          method: 'POST', body: JSON.stringify({ consulta: args.consulta, escopo: scope })
        });
      }
    };
  }
  return [
    research('pesquisar_fontes_oficiais', 'oficial', 'Confirme sessão, retificações, CATSER/CATMAT e regras em fontes oficiais.'),
    research('pesquisar_fabricantes', 'fabricante', 'Confirme requisitos e candidatos na documentação dos fabricantes e mantenedores.'),
    {
      name: 'ler_documento',
      description: 'Leia o texto original pelo documento_id do dossiê. Avance usando proximo_inicio para continuar.',
      parameters: {
        type: 'object',
        properties: { documento_id: { type: 'string' }, inicio: { type: 'integer', minimum: 0, default: 0 } },
        required: ['documento_id'], additionalProperties: false
      },
      handler: async args => {
        const start = args?.inicio ?? 0;
        if (!ID.test(args?.documento_id ?? '') || !Number.isSafeInteger(start) || start < 0) {
          throw new Error('Documento ou deslocamento inválido.');
        }
        return call(`/jobs/${jobId}/documentos/${args.documento_id}?inicio=${start}&tamanho=24000`);
      }
    }
  ];
}

export function createCopilotServer({ client, apiKey, model, extractorUrl, extractorApiKey, timeoutMs = 900000, fetchImpl = fetch }) {
  if (!apiKey || apiKey.length < 32) throw new Error('COPILOT_SERVICE_KEY deve ter pelo menos 32 caracteres.');
  if (!model || !extractorUrl || !extractorApiKey) throw new Error('Modelo e integração do extrator são obrigatórios.');
  const keyHash = createHash('sha256').update(apiKey).digest();
  let active = null;
  async function extractor(jobId, method) {
    const result = await fetchImpl(new URL(`/jobs/${jobId}`, extractorUrl), {
      method, headers: { 'X-API-Key': extractorApiKey }, redirect: 'error', signal: AbortSignal.timeout(30000)
    });
    if (!result.ok) throw new Error(`Extrator respondeu HTTP ${result.status}; operação não confirmada.`);
    return result.json();
  }
  return createServer(async (request, response) => {
    const provided = request.headers['x-api-key'];
    if (typeof provided !== 'string' || !timingSafeEqual(keyHash, createHash('sha256').update(provided).digest())) {
      send(response, 401, { error: 'Autenticação inválida.' });
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      try {
        const auth = await client.getAuthStatus();
        send(response, auth.isAuthenticated ? 200 : 503, { ok: auth.isAuthenticated, model });
      } catch (error) {
        console.error('Falha ao verificar autenticação Copilot:', error.message);
        send(response, 503, { ok: false, error: 'Não foi possível verificar a autenticação Copilot.' });
      }
      return;
    }
    const cancellation = request.url.match(/^\/jobs\/([a-f0-9]{32})\/cancel$/);
    if (request.method === 'POST' && cancellation) {
      try {
        const jobId = cancellation[1];
        const deleted = await extractor(jobId, 'DELETE');
        if (deleted.cancelled !== true || deleted.job_id !== jobId) throw new Error('Extrator não confirmou a remoção do job.');
        const current = active?.jobId === jobId ? active : null;
        if (current) {
          current.controller.abort(new Error('Análise cancelada pelo usuário.'));
          let timer;
          try {
            await Promise.race([
              current.finished,
              new Promise((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Copilot não confirmou a interrupção em 30 segundos.')), 30000);
              })
            ]);
          } finally {
            clearTimeout(timer);
          }
          if (current.cleanupError) throw current.cleanupError;
        }
        send(response, 200, { job_id: jobId, cancelled: true });
      } catch (error) {
        console.error('Falha ao cancelar análise:', error.message);
        send(response, 502, { error: error.message });
      }
      return;
    }
    if (request.method !== 'POST' || request.url !== '/analyze') {
      send(response, 404, { error: 'Recurso não encontrado.' });
      return;
    }
    if (active) {
      send(response, 429, { error: 'Uma análise está em andamento. Aguarde a conclusão antes de iniciar outra.' });
      return;
    }
    let body;
    try {
      body = await readBody(request);
      if (!ID.test(body?.job_id ?? '') || typeof body?.prompt !== 'string' || !body.prompt.trim()
        || typeof body?.systemMessage !== 'string' || !body.systemMessage.trim()) {
        throw new Error('Informe job_id, prompt e systemMessage válidos.');
      }
    } catch (error) {
      send(response, 400, { error: error.message });
      return;
    }
    if (active) {
      send(response, 429, { error: 'Uma análise está em andamento.' });
      return;
    }
    let finish;
    const current = {
      jobId: body.job_id, controller: new AbortController(),
      finished: new Promise(resolve => { finish = resolve; }), session: null, cleanupError: null
    };
    active = current;
    const { signal } = current.controller;
    let session;
    try {
      await extractor(body.job_id, 'GET');
      signal.throwIfAborted();
      if (!(await client.getAuthStatus()).isAuthenticated) throw new Error('Copilot não autenticado. Conclua o login oficial.');
      signal.throwIfAborted();
      if (!(await client.listModels()).some(item => item.id === model)) throw new Error(`Modelo ${model} indisponível para esta conta.`);
      signal.throwIfAborted();
      const tools = createExtractorTools({ baseUrl: extractorUrl, apiKey: extractorApiKey, jobId: body.job_id, fetchImpl, signal });
      session = await client.createSession({
        model,
        tools,
        availableTools: tools.map(tool => tool.name),
        onPermissionRequest: async request => ({
          kind: request.kind === 'custom-tool' && tools.some(tool => tool.name === request.toolName)
            && !request.managedApprovalRequired ? 'approve-once' : 'reject'
        }),
        systemMessage: { mode: 'replace', content: body.systemMessage },
        streaming: true
      });
      current.session = session;
      signal.throwIfAborted();
      let rejectCancelled;
      const cancelled = new Promise((resolve, reject) => { rejectCancelled = () => reject(signal.reason); });
      signal.addEventListener('abort', rejectCancelled, { once: true });
      let result;
      try {
        result = await Promise.race([session.sendAndWait({ prompt: body.prompt }, timeoutMs), cancelled]);
      } finally {
        signal.removeEventListener('abort', rejectCancelled);
      }
      signal.throwIfAborted();
      const output = result?.data?.content;
      if (typeof output !== 'string' || !output.trim()) throw new Error('Copilot retornou um relatório vazio.');
      send(response, 200, { job_id: body.job_id, model, output });
    } catch (error) {
      console.error(`Análise Copilot ${body.job_id} falhou:`, error.message);
      if (session) {
        try { await session.abort(); } catch (abortError) {
          current.cleanupError = abortError;
          console.error('Falha ao cancelar a sessão:', abortError.message);
        }
      }
      send(response, 502, { error: error.message, job_id: body.job_id });
    } finally {
      if (session) {
        try { await session.disconnect(); } catch (error) {
          current.cleanupError = error;
          console.error('Falha ao encerrar a sessão:', error.message);
        }
      }
      active = null;
      finish();
    }
  });
}
