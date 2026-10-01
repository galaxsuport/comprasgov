import type { PregaoResultado } from './types';

interface FetchFilters {
  ufs?: string;
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

  if (filters.ufs && filters.ufs !== 'todas') {
    params.set('ufs', filters.ufs);
  }
  // Quando "todas" é selecionado, não enviamos o parâmetro ufs
  // para que o webhook retorne todas as UFs por padrão

  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
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
  // Se já é array, retorna direto
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const page = entry as Record<string, unknown>;
      if (Array.isArray(page.registros)) {
        return page.registros.filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object')
        );
      }
      return [page];
    });
  }

  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;

    if (typeof obj.tipoSaida === 'string') {
      return [obj];
    }

    if (Array.isArray(obj.registros)) {
      return obj.registros as Record<string, unknown>[];
    }

    if (Array.isArray(obj.body)) {
      return obj.body as Record<string, unknown>[];
    }

    if (Array.isArray(obj.resultado)) {
      return obj.resultado as Record<string, unknown>[];
    }

    if (Array.isArray(obj.data)) {
      return obj.data as Record<string, unknown>[];
    }

    if (Array.isArray(obj.items)) {
      return obj.items as Record<string, unknown>[];
    }

    if (
      Array.isArray((obj as any).json) &&
      (obj as any).json.every((item: unknown) => item && typeof item === 'object')
    ) {
      return (obj as any).json as Record<string, unknown>[];
    }
  }

  console.warn('extractItems: payload não reconhecido', payload);
  return [];
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
  return {
    tipoSaida: 'oportunidade',
    score: typeof item.score === 'number' ? item.score : typeof item.scoreRelevancia === 'number' ? item.scoreRelevancia : 0,
    uf,
    municipio,
    local: toString(item.local) ?? [municipio, uf].filter(Boolean).join('/'),
    orgao: toString(item.orgao ?? orgaoEntidade.razaoSocial ?? unidadeOrgao.nomeUnidade),
    unidadeCompradora: toString(item.unidadeCompradora ?? unidadeOrgao.nomeUnidade),
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
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : null;
    } catch (parseError) {
      console.error('Erro ao ler/parsear response:', parseError);
      payload = null;
    }

    const registros = extractItems(payload);
    const possuiResultados = registros.some((item) => item.tipoSaida !== 'erro');

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
      throw new WebhookPopupError(
        `Falha ao buscar resultados: ${response.status} ${response.statusText}`,
        'O webhook não conseguiu concluir a consulta.'
      );
    }

    const aviso = extractWarning(payload, registros);
    const resultados = registros
      .filter((item) => item.tipoSaida !== 'erro')
      .map(normalizeRecord);

    return { resultados, aviso };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
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
