export interface DiagnosticoGeral {
  paginas: number;
  recebidos: number;
  naoTIC: number;
  scoreInsuficiente: number;
  prazo: number;
  status: number;
  excluidos: number;
  aprovadosAntesDedup: number;
  duplicados: number;
}

export interface ResumoResultado {
  tipoSaida: 'resumo';
  encontrouOportunidades: boolean;
  diagnostico: DiagnosticoGeral;
}

export interface OportunidadeResultado {
  tipoSaida: 'oportunidade';
  score: number;
  uf: string | null;
  municipio: string | null;
  local: string | null;
  orgao: string | null;
  unidadeCompradora: string | null;
  uasg?: string | null;
  numeroCompra?: string | null;
  codigoModalidade: number | null;
  modalidadeIdPncp: number | null;
  modalidade: string | null;
  valorNumerico: number | null;
  valor: string | null;
  modoDisputa: string | null;
  registroPreco: boolean | null;
  situacao: string | null;
  objeto: string | null;
  dataPublicacao: string | null;
  dataAberturaProposta: string | null;
  dataEncerramentoProposta: string | null;
  diasRestantes: number | null;
  palavrasChaveEncontradas: string[];
  idContratacaoPNCP: string | null;
  fonte: string | null;
  linkContratacao: string | null;
  cadastroProposta: string | null;
  linkSistemaOrigem: string | null;
  diagnosticoGeral: DiagnosticoGeral;
}

export type PregaoResultado = ResumoResultado | OportunidadeResultado;
