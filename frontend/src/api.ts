import type { PregaoResultado } from './types';

interface FetchFilters {
  ufs?: string;
  modalidades?: string;
  dias?: number;
  prazo?: number;
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

/* eslint-disable */
// @ts-ignore
// Vite environment variables are available via import.meta.env
const API_BASE_URL: string =
  window.__ENV__?.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  '';

if (!API_BASE_URL) {
  throw new Error(
    'VITE_API_BASE_URL não configurado.'
  );
}
/* eslint-enable */

function buildApiUrl(filters: FetchFilters = {}): string {
  const baseUrl = API_BASE_URL;
  const params = new URLSearchParams();

  if (filters.ufs && filters.ufs !== 'todas') {
    params.set('ufs', filters.ufs);
  }
  // Quando "todas" é selecionado, não enviamos o parâmetro ufs
  // para que o webhook retorne todas as UFs por padrão

  if (filters.modalidades) {
    params.set('modalidades', filters.modalidades);
  }

  if (filters.dias) {
    params.set('dias', filters.dias.toString());
  }

  if (filters.prazo) {
    params.set('prazo', filters.prazo.toString());
  }

  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

function buildLink(item: Record<string, unknown>) {
  const link = toString(item.linkContratacao ?? item['linkContratacao']);
  if (link) return link;

  const idCompra = item.idCompra ?? item['idCompra'];
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
    return payload as Record<string, unknown>[];
  }

  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;

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
  return {
    tipoSaida: 'oportunidade',
    score: typeof item.score === 'number' ? item.score : 0,
    uf: toString(item.uf ?? item['uf'] ?? item.unidadeOrgaoUfSigla ?? item['unidadeOrgaoUfSigla']),
    municipio: toString(item.municipio ?? item['municipio'] ?? item.unidadeOrgaoMunicipioNome ?? item['unidadeOrgaoMunicipioNome']),
    local: toString(item.local ?? item['local'] ?? [item.municipio, item.uf].filter(Boolean).join('/')),
    orgao: toString(item.orgao ?? item['orgao'] ?? item.orgaoEntidadeRazaoSocial ?? item['orgaoEntidadeRazaoSocial'] ?? item.unidadeOrgaoNomeUnidade ?? item['unidadeOrgaoNomeUnidade']),
    unidadeCompradora: toString(item.unidadeCompradora ?? item['unidadeCompradora'] ?? item.unidadeOrgaoNomeUnidade ?? item['unidadeOrgaoNomeUnidade']),
    codigoModalidade: typeof item.codigoModalidade === 'number' ? item.codigoModalidade : null,
    modalidadeIdPncp: typeof item.modalidadeIdPncp === 'number' ? item.modalidadeIdPncp : null,
    modalidade: toString(item.modalidade ?? item['modalidade'] ?? item.modalidadeContratacao ?? item['modalidadeContratacao'] ?? item.modalidadeNome ?? item['modalidadeNome']),
    valorNumerico: typeof item.valorNumerico === 'number' ? item.valorNumerico : null,
    valor: formatCurrency(item.valor ?? item['valor'] ?? item.valorTotalEstimado ?? item['valorTotalEstimado']),
    modoDisputa: toString(item.modoDisputa ?? item['modoDisputa'] ?? item.modoDisputaNomePncp ?? item['modoDisputaNomePncp']),
    registroPreco: item.registroPreco === true ? true : item.registroPreco === false ? false : null,
    situacao: toString(item.situacao ?? item['situacao'] ?? item.situacaoCompraNomePncp ?? item['situacaoCompraNomePncp']),
    objeto: toString(item.objeto ?? item['objeto'] ?? item.objetoCompra ?? item['objetoCompra']),
    dataPublicacao: toString(item.dataPublicacao ?? item['dataPublicacao']),
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

export async function fetchResultados(filters?: FetchFilters, externalSignal?: AbortSignal): Promise<PregaoResultado[]> {
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

    console.log('Fetch completed, status:', response.status);

    // Sempre tenta ler o JSON, mesmo em respostas de erro
    let payload: unknown;
    try {
      const text = await response.text();
      console.log('Response text length:', text.length, 'Preview:', text.substring(0, 200));
      payload = text ? JSON.parse(text) : null;
      console.log('JSON parsed successfully, payload type:', Array.isArray(payload) ? 'array' : typeof payload);
    } catch (parseError) {
      console.error('Erro ao ler/parsear response:', parseError);
      payload = null;
    }

    // Tratar erro específico do webhook: limite de requisições excedido
    if (payload && typeof payload === 'object' && 'erro' in payload) {
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
      throw new Error(`Falha ao buscar resultados: ${response.status} ${response.statusText}`);
    }

    const registros = extractItems(payload as Record<string, unknown>);
    console.log('Registros extraídos:', registros.length);

    return registros.map(normalizeRecord);
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
