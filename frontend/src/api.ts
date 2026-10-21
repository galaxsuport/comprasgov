import type { PregaoResultado } from './types';
import type { OportunidadeResultado } from './types';

interface FetchFilters {
  ufs?: string;
  uasg?: string;
  numeroCompra?: string;
}

export interface FetchResultadosResponse {
  resultados: PregaoResultado[];
  aviso: { title: string; message: string; sample: string | null } | null;
}

function formatCurrency(value: unknown) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || 'Sigiloso';
  }

  const numeric = Number(value);
  if (Number.isNaN(numeric) || numeric === 0) {
    return 'Sigiloso';
  }

  return numeric.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

const API_BASE_URL = '/api/pregoes';
const AUTH_API_BASE_URL = '/api/auth';

async function readApiError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' && body.error.trim()) return body.error;
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' && body.message.trim()) return body.message;
  } catch {
    // Non-JSON responses still report their HTTP status below.
  }
  if (response.status === 502 || response.status === 504) {
    return `O servidor ou proxy não conseguiu obter resposta da API (HTTP ${response.status}). Verifique a disponibilidade da API e do n8n; em análises, confira o job antes de reenviar.`;
  }
  return `Falha na comunicação com o servidor (HTTP ${response.status}).`;
}

export async function fetchDeadline(): Promise<number> {
  const response = await fetch('/api/settings/deadline');
  if (!response.ok) throw new Error(await readApiError(response));
  return ((await response.json()) as { value: number }).value;
}

export async function saveDeadline(value: number): Promise<number> {
  const response = await fetch('/api/settings/deadline', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return ((await response.json()) as { value: number }).value;
}

export type TextKind = 'company-name' | 'title' | 'subtitle';

export async function fetchText(kind: TextKind): Promise<string> {
  const response = await fetch(`/api/settings/${kind}`);
  if (!response.ok) throw new Error(await readApiError(response));
  return ((await response.json()) as { value: string }).value;
}

export async function saveText(kind: TextKind, value: string): Promise<string> {
  const response = await fetch(`/api/settings/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value })
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return ((await response.json()) as { value: string }).value;
}

export type TermKind = 'strong-terms' | 'contextual-terms' | 'technological-contexts' | 'exclusion-terms';

export async function fetchTerms(kind: TermKind): Promise<string[]> {
  const response = await fetch(`/api/settings/${kind}`);
  if (!response.ok) throw new Error(await readApiError(response));
  return ((await response.json()) as { terms: string[] }).terms;
}

export async function saveTerms(kind: TermKind, terms: string[]): Promise<string[]> {
  const response = await fetch(`/api/settings/${kind}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ terms })
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return ((await response.json()) as { terms: string[] }).terms;
}

export function getProposalKey(result: OportunidadeResultado): string | null {
  if (result.idContratacaoPNCP) return `id:${result.idContratacaoPNCP}`;
  if (result.linkContratacao) return `link:${result.linkContratacao}`;
  return null;
}

export async function fetchDiscarded(signal?: AbortSignal): Promise<OportunidadeResultado[]> {
  const response = await fetch('/api/discarded', { signal });
  if (!response.ok) throw new Error(await readApiError(response));
  return response.json() as Promise<OportunidadeResultado[]>;
}

let proposalStatusQueue: Promise<void> = Promise.resolve();
let proposalStatusBlockedUntil = 0;
let proposalStatusLimitError: Error | null = null;

export async function fetchProposalStatus(
  proposal: Pick<OportunidadeResultado, 'idContratacaoPNCP' | 'linkContratacao'>,
  signal?: AbortSignal
): Promise<{
  situacao: string;
  tipoInstrumentoConvocatorio: string | null;
  numeroCompra: string | null;
}> {
  const result = proposalStatusQueue.then(() => {
    signal?.throwIfAborted();
    if (proposalStatusLimitError && Date.now() < proposalStatusBlockedUntil) {
      throw proposalStatusLimitError;
    }
    proposalStatusLimitError = null;
    proposalStatusBlockedUntil = 0;
    return requestProposalStatus(proposal, signal);
  });
  proposalStatusQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function requestProposalStatus(
  proposal: Pick<OportunidadeResultado, 'idContratacaoPNCP' | 'linkContratacao'>,
  signal?: AbortSignal
): Promise<{
  situacao: string;
  tipoInstrumentoConvocatorio: string | null;
  numeroCompra: string | null;
}> {
  const params = new URLSearchParams();
  if (proposal.idContratacaoPNCP) params.set('id', proposal.idContratacaoPNCP);
  if (proposal.linkContratacao) params.set('link', proposal.linkContratacao);
  const response = await fetch(`/api/proposals/status?${params}`, { signal });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? 30);
    proposalStatusBlockedUntil = Date.now() + (
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 30000
    );
    proposalStatusLimitError = new Error(await readApiError(response));
    throw proposalStatusLimitError;
  }
  if (!response.ok) throw new Error(await readApiError(response));
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('situacao' in data)
    || typeof data.situacao !== 'string' || !data.situacao.trim()) {
    throw new Error('Resposta inválida ao atualizar a situação da proposta.');
  }
  return {
    situacao: data.situacao,
    tipoInstrumentoConvocatorio: 'tipoInstrumentoConvocatorio' in data
      && typeof data.tipoInstrumentoConvocatorio === 'string'
      && data.tipoInstrumentoConvocatorio.trim()
      ? data.tipoInstrumentoConvocatorio.trim()
      : null,
    numeroCompra: 'numeroCompra' in data
      && typeof data.numeroCompra === 'string'
      && data.numeroCompra.trim()
      ? data.numeroCompra.trim()
      : null
  };
}

export async function discardProposal(proposal: OportunidadeResultado): Promise<void> {
  const response = await fetch('/api/discarded', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposal })
  });
  if (!response.ok) throw new Error(await readApiError(response));
}

export async function restoreProposal(key: string): Promise<void> {
  const response = await fetch(`/api/discarded/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await readApiError(response));
}

export async function fetchRegistered(signal?: AbortSignal): Promise<OportunidadeResultado[]> {
  const response = await fetch('/api/registered', { signal });
  if (!response.ok) throw new Error(await readApiError(response));
  return response.json() as Promise<OportunidadeResultado[]>;
}

export async function registerProposal(proposal: OportunidadeResultado): Promise<void> {
  const response = await fetch('/api/registered', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposal })
  });
  if (!response.ok) throw new Error(await readApiError(response));
}

export async function unregisterProposal(key: string): Promise<void> {
  const response = await fetch(`/api/registered/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await readApiError(response));
}

export async function logout(): Promise<void> {
  const response = await fetch(`${AUTH_API_BASE_URL}/logout`, { method: 'POST' });
  if (!response.ok) throw new Error(await readApiError(response));
}

export interface AnalysisJob {
  jobId: string;
  proposalKey: string;
  status: string;
  message: string | null;
  hasReport: boolean;
  startedAt: number;
  completedAt: number | null;
}

export function getAnalysisParams(result: OportunidadeResultado): { uasg: string; numeroCompra: string } | null {
  const code = [result.cadastroProposta, result.linkSistemaOrigem]
    .map(value => value?.match(/compra=(\d{6})(\d{2})(\d{5})(\d{4})(?:\D|$)/)).find(Boolean);
  const uasg = result.uasg ?? result.unidadeCompradora?.match(/^(\d{4,8}) - /)?.[1] ?? code?.[1];
  const rawNumeroCompra = result.numeroCompra?.trim();
  const numeroCompra = rawNumeroCompra?.includes('/')
    ? rawNumeroCompra
    : code
      ? `${Number(rawNumeroCompra || code[3])}/${code[4]}`
      : rawNumeroCompra ?? null;
  return uasg && numeroCompra && /^\d{4,8}$/.test(uasg) && /^\d+\/\d{4}$/.test(numeroCompra)
    ? { uasg, numeroCompra } : null;
}

export async function fetchAnalyses(signal?: AbortSignal): Promise<AnalysisJob[]> {
  const response = await fetch('/api/analysis', { signal });
  if (!response.ok) throw new Error(await readApiError(response));
  return response.json() as Promise<AnalysisJob[]>;
}

export async function startAnalysis(proposal: OportunidadeResultado): Promise<AnalysisJob> {
  const response = await fetch('/api/analysis', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposal })
  });
  if (!response.ok) throw new Error(await readApiError(response));
  return response.json() as Promise<AnalysisJob>;
}

export async function cancelAnalysis(proposalKey: string): Promise<void> {
  const response = await fetch('/api/analysis/cancel', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposalKey })
  });
  if (!response.ok) throw new Error(await readApiError(response));
}

export async function refreshAnalysis(jobId: string, signal?: AbortSignal): Promise<AnalysisJob> {
  const response = await fetch(`/api/analysis/${encodeURIComponent(jobId)}/refresh`, { method: 'POST', signal });
  if (!response.ok) throw new Error(await readApiError(response));
  return response.json() as Promise<AnalysisJob>;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await fetch(`${AUTH_API_BASE_URL}/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, newPassword })
  });
  if (!response.ok) throw new Error(await readApiError(response));
}

export class WebhookPopupError extends Error {
  constructor(
    public readonly title: string,
    message: string,
    public readonly sample: string | null = null
  ) {
    super(message);
    this.name = 'WebhookPopupError';
  }
}

function buildApiUrl(filters: FetchFilters = {}): string {
  const baseUrl = API_BASE_URL;
  const params = new URLSearchParams();

  if (filters.uasg) {
    params.set('uasg', filters.uasg);
  } else if (filters.ufs && filters.ufs !== 'todas') {
    params.set('ufs', filters.ufs);
  }
  if (filters.numeroCompra) {
    params.set('numeroCompra', filters.numeroCompra);
  }
  // Quando "todas" é selecionado, não enviamos o parâmetro ufs
  // para que o webhook retorne todas as UFs por padrão

  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

function buildNumeroCompra(item: Record<string, unknown>) {
  const numero = toString(item.numeroCompra);
  if (!numero) return null;
  const ano = toString(item.anoCompra);
  return numero.includes('/') || !ano ? numero : `${numero}/${ano}`;
}

function buildLink(item: Record<string, unknown>) {
  const link = toString(item.linkContratacao ?? item['linkContratacao']);
  if (link) return link;

  const idCompra = item.idCompra ?? item['idCompra'] ?? item.numeroControlePNCP;
  if (typeof idCompra === 'number' || typeof idCompra === 'string') {
    return `https://pncp.gov.br/app/editais/${String(idCompra)}`;
  }

  return null;
}

function toString(value: unknown) {
  if (value === undefined || value === null) return null;
  const formatted = String(value).trim();
  return formatted.length > 0 ? formatted : null;
}

function extractItems(payload: unknown): Record<string, unknown>[] {
  function records(value: unknown[]): Record<string, unknown>[] {
    if (!value.every((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))) {
      throw new Error('O serviço de pesquisa retornou registros inválidos.');
    }
    return value;
  }

  if (Array.isArray(payload)) {
    return records(payload).flatMap(page => Array.isArray(page.registros) ? records(page.registros) : [page]);
  }

  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;

    if (typeof obj.tipoSaida === 'string') {
      return [obj];
    }

    for (const key of ['registros', 'body', 'resultado', 'data', 'items', 'json']) {
      const value = obj[key];
      if (Array.isArray(value)) return records(value);
    }
    if (typeof obj.erro === 'string' || (obj.popupErro && typeof obj.popupErro === 'object')) return [];
  }

  throw new Error('O serviço de pesquisa retornou uma resposta inválida; não foi encontrada a lista de resultados.');
}

function extractWarning(payload: unknown, registros: Record<string, unknown>[]) {
  const pages = Array.isArray(payload) ? payload : [payload];
  const pageWarning = pages
    .filter((page): page is Record<string, unknown> => Boolean(page && typeof page === 'object'))
    .map((page) => page.popupErro)
    .find((popup) => popup && typeof popup === 'object' && (popup as Record<string, unknown>).exibir === true) as Record<string, unknown> | undefined;

  const legacyWarning = registros.find((item) => item.tipoSaida === 'erro' && item.popup === true);
  const warning = pageWarning ?? legacyWarning;
  if (!warning) return null;

  const sampleValue = warning.amostra ?? warning.detalhe;
  const sample = typeof sampleValue === 'string'
    ? sampleValue
    : sampleValue == null ? null : JSON.stringify(sampleValue, null, 2);
  const warningText = [warning.titulo, warning.mensagem].filter(Boolean).join(' ');
  const limiteExcedido = /limite.{0,40}requisi|requisi.{0,40}limite/i.test(warningText);

  return {
    title: limiteExcedido
      ? 'Limite de requisições excedido no PNCP'
      : toString(warning.titulo) ?? 'Erro na consulta',
    message: limiteExcedido
      ? 'O PNCP interrompeu parte da consulta por limite de requisições. Os resultados recebidos antes da interrupção continuam disponíveis.'
      : toString(warning.mensagem) ?? 'O webhook não conseguiu concluir a consulta.',
    sample
  };
}

function normalizeRecord(item: Record<string, unknown>): PregaoResultado {
  const tipoSaida = toString(item.tipoSaida ?? item['tipoSaida']);
  
  // Se for resumo, retorna estrutura de resumo
  if (tipoSaida === 'resumo') {
    const diag = item.diagnostico as Record<string, unknown> | undefined;
    return {
      tipoSaida: 'resumo',
      encontrouOportunidades: Boolean(item.encontrouOportunidades),
      diagnostico: {
        paginas: typeof diag?.paginas === 'number' ? diag.paginas : 0,
        recebidos: typeof diag?.recebidos === 'number' ? diag.recebidos : 0,
        naoTIC: typeof diag?.naoTIC === 'number' ? diag.naoTIC : 0,
        scoreInsuficiente: typeof diag?.scoreInsuficiente === 'number' ? diag.scoreInsuficiente : 0,
        prazo: typeof diag?.prazo === 'number' ? diag.prazo : 0,
        status: typeof diag?.status === 'number' ? diag.status : 0,
        excluidos: typeof diag?.excluidos === 'number' ? diag.excluidos : 0,
        aprovadosAntesDedup: typeof diag?.aprovadosAntesDedup === 'number' ? diag.aprovadosAntesDedup : 0,
        duplicados: typeof diag?.duplicados === 'number' ? diag.duplicados : 0,
      }
    } as PregaoResultado;
  }

  // Caso contrário, retorna estrutura de oportunidade
  const diagGeral = item.diagnosticoGeral as Record<string, unknown> | undefined;
  const orgaoEntidade = item.orgaoEntidade && typeof item.orgaoEntidade === 'object'
    ? item.orgaoEntidade as Record<string, unknown>
    : {};
  const unidadeOrgao = item.unidadeOrgao && typeof item.unidadeOrgao === 'object'
    ? item.unidadeOrgao as Record<string, unknown>
    : {};
  const uf = toString(item.uf ?? item.ufConsulta ?? unidadeOrgao.ufSigla);
  const municipio = toString(item.municipio ?? unidadeOrgao.municipioNome);
  const codigoUnidade = toString(
    unidadeOrgao.codigoUnidade
      ?? unidadeOrgao.codigoUasg
      ?? unidadeOrgao.codigoUASG
      ?? unidadeOrgao.codUasg
      ?? unidadeOrgao.uasg
      ?? item.codigoUnidade
      ?? item.codigoUasg
      ?? item.codigoUASG
      ?? item.codUasg
      ?? item.uasg
  );
  const nomeUnidade = toString(item.unidadeCompradora ?? unidadeOrgao.nomeUnidade);
  const ufUnidade = toString(unidadeOrgao.ufSigla ?? item.uf ?? item.ufConsulta);
  const unidadeSemUf = nomeUnidade
    ? codigoUnidade && !nomeUnidade.startsWith(`${codigoUnidade} - `)
      ? `${codigoUnidade} - ${nomeUnidade}`
      : nomeUnidade
    : null;
  const unidadeCompradora = unidadeSemUf && ufUnidade && !unidadeSemUf.endsWith(`/${ufUnidade}`)
    ? `${unidadeSemUf}/${ufUnidade}`
    : unidadeSemUf;
  return {
    tipoSaida: 'oportunidade',
    score: typeof item.score === 'number' ? item.score : typeof item.scoreRelevancia === 'number' ? item.scoreRelevancia : 0,
    uf,
    municipio,
    local: toString(item.local) ?? [municipio, uf].filter(Boolean).join('/'),
    orgao: toString(item.orgao ?? orgaoEntidade.razaoSocial ?? unidadeOrgao.nomeUnidade),
    unidadeCompradora,
    uasg: codigoUnidade ?? unidadeCompradora?.match(/^(\d{4,8}) - /)?.[1] ?? null,
    tipoInstrumentoConvocatorio: toString(
      item.tipoInstrumentoConvocatorioNome
        ?? (typeof item.tipoInstrumentoConvocatorio === 'string' ? item.tipoInstrumentoConvocatorio : null)
        ?? item.tipoEdital
        ?? item.tipo
    ),
    numeroCompra: buildNumeroCompra(item),
    codigoModalidade: typeof item.codigoModalidade === 'number' ? item.codigoModalidade : typeof item.codigoModalidadeConsulta === 'number' ? item.codigoModalidadeConsulta : null,
    modalidadeIdPncp: typeof item.modalidadeIdPncp === 'number' ? item.modalidadeIdPncp : typeof item.modalidadeId === 'number' ? item.modalidadeId : null,
    modalidade: toString(item.modalidade ?? item.modalidadeConsulta ?? item.modalidadeContratacao ?? item.modalidadeNome),
    valorNumerico: typeof item.valorNumerico === 'number' ? item.valorNumerico : typeof item.valorTotalEstimado === 'number' ? item.valorTotalEstimado : null,
    valor: formatCurrency(item.valor ?? item['valor'] ?? item.valorTotalEstimado ?? item['valorTotalEstimado']),
    modoDisputa: toString(item.modoDisputa ?? item.modoDisputaNome ?? item.modoDisputaNomePncp),
    registroPreco: typeof item.registroPreco === 'boolean' ? item.registroPreco : typeof item.srp === 'boolean' ? item.srp : null,
    situacao: toString(item.situacao ?? item.situacaoCompraNome ?? item.situacaoCompraNomePncp),
    objeto: toString(item.objeto ?? item['objeto'] ?? item.objetoCompra ?? item['objetoCompra']),
    dataPublicacao: toString(item.dataPublicacao ?? item.dataPublicacaoPncp),
    dataAberturaProposta: toString(item.dataAberturaProposta ?? item['dataAberturaProposta'] ?? item.dataInicioRecebimentoPropostas ?? item['dataInicioRecebimentoPropostas']),
    dataEncerramentoProposta: toString(item.dataEncerramentoProposta ?? item['dataEncerramentoProposta'] ?? item.dataFimRecebimentoPropostas ?? item['dataFimRecebimentoPropostas'] ?? item.dataEncerramentoPropostaPncp ?? item['dataEncerramentoPropostaPncp']),
    diasRestantes: typeof item.diasRestantes === 'number' ? item.diasRestantes : null,
    palavrasChaveEncontradas: Array.isArray(item.palavrasChaveEncontradas) ? item.palavrasChaveEncontradas : [],
    idContratacaoPNCP: toString(item.idContratacaoPNCP ?? item['idContratacaoPNCP'] ?? item.numeroControlePNCP ?? item['numeroControlePNCP']),
    fonte: toString(item.fonte ?? item['fonte']) ?? 'PNCP',
    linkContratacao: buildLink(item),
    cadastroProposta: toString(item.cadastroProposta ?? item['cadastroProposta']),
    linkSistemaOrigem: toString(item.linkSistemaOrigem ?? item['linkSistemaOrigem']),
    diagnosticoGeral: diagGeral ? {
      paginas: typeof diagGeral.paginas === 'number' ? diagGeral.paginas : 0,
      recebidos: typeof diagGeral.recebidos === 'number' ? diagGeral.recebidos : 0,
      naoTIC: typeof diagGeral.naoTIC === 'number' ? diagGeral.naoTIC : 0,
      scoreInsuficiente: typeof diagGeral.scoreInsuficiente === 'number' ? diagGeral.scoreInsuficiente : 0,
      prazo: typeof diagGeral.prazo === 'number' ? diagGeral.prazo : 0,
      status: typeof diagGeral.status === 'number' ? diagGeral.status : 0,
      excluidos: typeof diagGeral.excluidos === 'number' ? diagGeral.excluidos : 0,
      aprovadosAntesDedup: typeof diagGeral.aprovadosAntesDedup === 'number' ? diagGeral.aprovadosAntesDedup : 0,
      duplicados: typeof diagGeral.duplicados === 'number' ? diagGeral.duplicados : 0,
    } : undefined
  } as PregaoResultado;
}

export async function fetchResultados(filters?: FetchFilters, externalSignal?: AbortSignal): Promise<FetchResultadosResponse> {
  const url = buildApiUrl(filters);
  
  // Combina signal externo (do React) com timeout interno de 150s (2:30min)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 150000);

  // Se signal externo abortar, aborta o controller interno
  const handleExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', handleExternalAbort);
    }
  }

  try {
    const response = await fetch(url, { 
      cache: 'no-store',
      signal: controller.signal
    });

    // Sempre tenta ler o JSON, mesmo em respostas de erro
    let payload: unknown;
    const text = await response.text();
    try {
      payload = JSON.parse(text);
    } catch (parseError) {
      console.error('Erro ao ler/parsear response:', parseError);
      if (response.ok) throw new Error('O serviço de pesquisa retornou uma resposta inválida; era esperado JSON.');
      payload = null;
    }

    const registros = response.ok ? extractItems(payload) : [];
    const possuiResultados = registros.some(item => item.tipoSaida !== 'erro');
    // Tratar erro específico do webhook: limite de requisições excedido
    if (!possuiResultados && payload && typeof payload === 'object' && 'erro' in payload) {
      const erro = (payload as Record<string, unknown>).erro;
      if (erro === 'LIMITE_REQUISICOES_EXCEDIDO') {
        throw new Error('LIMITE_REQUISICOES_EXCEDIDO: Número máximo de requisições atingido. Aguarde alguns minutos e tente novamente.');
      }
      // Outros erros conhecidos do webhook
      if (typeof erro === 'string') {
        throw new Error(`Erro do webhook: ${erro}`);
      }
    }

    if (!response.ok) {
      const detail = await readApiError(new Response(JSON.stringify(payload), { status: response.status }));
      throw new WebhookPopupError(
        `Falha ao buscar resultados: ${response.status} ${response.statusText}`,
        detail
      );
    }

    const aviso = extractWarning(payload, registros);
    const resultados = registros
      .filter((item) => item.tipoSaida !== 'erro')
      .map(normalizeRecord);

    return { resultados, aviso };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (externalSignal?.aborted) throw error;
      throw new Error('Tempo limite excedido (150s) ao buscar resultados');
    }
    console.error('Erro em fetchResultados:', error);
    throw error;
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', handleExternalAbort);
    }
  }
}
