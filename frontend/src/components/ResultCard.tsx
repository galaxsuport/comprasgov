import { getAnalysisParams } from '../api';
import type { PregaoResultado, OportunidadeResultado, ResumoResultado } from '../types';

interface ResultCardProps {
  result: PregaoResultado;
  isFavorite?: boolean;
  onToggleFavorite?: (result: OportunidadeResultado) => void;
  isDiscarded?: boolean;
  onToggleDiscard?: (result: OportunidadeResultado) => void;
  onAnalyze?: (result: OportunidadeResultado) => void;
  analysisState?: 'done' | 'pending';
  analysisLocked?: boolean;
}

function isOportunidade(result: PregaoResultado): result is OportunidadeResultado {
  return result.tipoSaida === 'oportunidade';
}

function isResumo(result: PregaoResultado): result is ResumoResultado {
  return result.tipoSaida === 'resumo';
}

function formatTempoRestante(dataEncerramento: string | null): string {
  if (!dataEncerramento) return '—';

  const encerramento = new Date(dataEncerramento).getTime();
  if (Number.isNaN(encerramento)) return '—';

  const minutosRestantes = Math.max(0, Math.floor((encerramento - Date.now()) / 60000));
  const dias = Math.floor(minutosRestantes / 1440);
  const horas = Math.floor((minutosRestantes % 1440) / 60);
  const minutos = minutosRestantes % 60;

  return `${dias} ${dias === 1 ? 'dia' : 'dias'}, ${horas} ${horas === 1 ? 'hora' : 'horas'} e ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'} restantes`;
}

export default function ResultCard({
  result,
  isFavorite = false,
  onToggleFavorite,
  isDiscarded = false,
  onToggleDiscard,
  onAnalyze,
  analysisState,
  analysisLocked = false
}: ResultCardProps) {
  // Se for resumo, mostra apenas o diagnóstico
  if (isResumo(result)) {
    return (
      <article className="card card-resumo">
        <div className="card-header">
          <h2>Resumo da Consulta</h2>
          <p className="subline">
            {result.encontrouOportunidades ? 'Oportunidades encontradas' : 'Nenhuma oportunidade encontrada'}
          </p>
        </div>
        <div className="card-grid">
          <div><span>Páginas consultadas</span><strong>{result.diagnostico.paginas}</strong></div>
          <div><span>Registros recebidos</span><strong>{result.diagnostico.recebidos}</strong></div>
          <div><span>Não TIC</span><strong>{result.diagnostico.naoTIC}</strong></div>
          <div><span>Score insuficiente</span><strong>{result.diagnostico.scoreInsuficiente}</strong></div>
          <div><span>Prazo vencido</span><strong>{result.diagnostico.prazo}</strong></div>
          <div><span>Status inválido</span><strong>{result.diagnostico.status}</strong></div>
          <div><span>Excluídos</span><strong>{result.diagnostico.excluidos}</strong></div>
          <div><span>Aprovados (antes dedup)</span><strong>{result.diagnostico.aprovadosAntesDedup}</strong></div>
          <div><span>Duplicados</span><strong>{result.diagnostico.duplicados}</strong></div>
        </div>
      </article>
    );
  }

  const unidadeCompradora = result.unidadeCompradora;
  const scorePercent = Number.isFinite(result.score)
    ? Math.min(100, Math.max(0, result.score))
    : 0;

  // Renderização para oportunidade
  return (
    <article className={`card${isDiscarded ? ' card-discarded' : ''}`}>
      <div className="card-content" {...(isDiscarded ? ({ inert: '' } as object) : {})} aria-hidden={isDiscarded || undefined}>
      <div className="card-header card-opportunity-header">
        <div>
          <div className="score-meter-block">
            <div
              className="score-meter-track"
              role="progressbar"
              aria-label="Score de relevância"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(scorePercent)}
            >
              <span className="score-meter-fill" style={{ width: `${scorePercent}%` }} />
              <span className="score-meter-value">Score {Math.round(scorePercent)}%</span>
            </div>
          </div>
          <h2>{result.local ?? 'Local não informado'}</h2>
          {unidadeCompradora ? (
            <p className="subline">{unidadeCompradora}</p>
          ) : null}
          <div className="card-badges">
            {result.modalidade ? <span className="badge">{result.modalidade}</span> : null}
            {result.registroPreco === true ? <span className="badge badge-srp">SRP</span> : null}
            {result.modoDisputa ? <span className="badge">{result.modoDisputa}</span> : null}
          </div>
        </div>
        <button
          type="button"
          className="favorite-card-toggle"
          onClick={() => onToggleFavorite?.(result)}
          aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          aria-pressed={isFavorite}
          title={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          disabled={!result.idContratacaoPNCP && !result.linkContratacao}
        >
          <span aria-hidden="true">{isFavorite ? '★' : '☆'}</span>
        </button>
      </div>

      <div className="card-grid">
        <div>
          <span>Modalidade</span>
          <strong>{result.modalidade ?? '—'}</strong>
        </div>
        <div>
          <span>Valor</span>
          <strong>{result.valor ?? '—'}</strong>
        </div>
        <div>
          <span>UF</span>
          <strong>{result.uf ?? '—'}</strong>
        </div>
        <div>
          <span>Município</span>
          <strong>{result.municipio ?? '—'}</strong>
        </div>
        <div>
          <span>Data publicação</span>
          <strong>{result.dataPublicacao ? new Date(result.dataPublicacao).toLocaleDateString('pt-BR') : '—'}</strong>
        </div>
        <div>
          <span>Data fim</span>
          <strong>
            {result.dataEncerramentoProposta ? (
              new Date(result.dataEncerramentoProposta).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
              })
            ) : '—'}
          </strong>
        </div>
        <div>
          <span>Situação</span>
          <strong>{result.situacao ?? '—'}</strong>
        </div>
        <div>
          <span>Tempo restante</span>
          <strong>{formatTempoRestante(result.dataEncerramentoProposta)}</strong>
        </div>
      </div>

      <div className="card-meta">
        {result.palavrasChaveEncontradas && result.palavrasChaveEncontradas.length > 0 && (
          <div className="keywords">
            <span className="keywords-label">Palavras-chave:</span>
            {result.palavrasChaveEncontradas.map((keyword: string, index: number) => (
              <span key={index} className="keyword-tag">{keyword}</span>
            ))}
          </div>
        )}
      </div>

      <div className="card-section">
        <p className="section-label">Objeto da contratação</p>
        <p className="object-text">{result.objeto ?? 'Descrição não disponível'}</p>
      </div>
      </div>

      <div className="card-discard-row">
        <button
          type="button"
          className="discard-toggle analyze-link"
          onClick={() => onAnalyze?.(result)}
          disabled={isDiscarded || analysisLocked || Boolean(analysisState) || !getAnalysisParams(result)}
          title={analysisLocked && !analysisState ? 'Aguarde o fim da análise em sequência' : analysisState === 'done' ? 'Análise concluída' : analysisState ? 'Análise em andamento' : getAnalysisParams(result) ? 'Analisar edital' : 'UASG ou número da compra indisponível'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {analysisState === 'done' ? (
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            ) : analysisState === 'pending' ? (
              <>
                <path d="M6 3h12M6 21h12" />
                <path d="M7 3v3a5 5 0 0 0 2 4l3 2-3 2a5 5 0 0 0-2 4v3M17 3v3a5 5 0 0 1-2 4l-3 2 3 2a5 5 0 0 1 2 4v3" />
              </>
            ) : (
              <>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8v8M8 12h8" />
              </>
            )}
          </svg>
          <span>{analysisState === 'done' ? 'Analisado' : analysisState ? 'Analisando' : 'Analisar'}</span>
        </button>
        {result.linkContratacao ? (
          <a
            className="discard-toggle pncp-link"
            href={isDiscarded ? undefined : result.linkContratacao}
            aria-disabled={isDiscarded || undefined}
            tabIndex={isDiscarded ? -1 : undefined}
            target="_blank"
            rel="noreferrer"
            title="Ver no PNCP"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <path d="M15 3h6v6" />
              <path d="M10 14L21 3" />
            </svg>
            <span>Ver no PNCP</span>
          </a>
        ) : null}
        <button
          type="button"
          className="discard-toggle"
          onClick={() => onToggleDiscard?.(result)}
          disabled={!result.idContratacaoPNCP && !result.linkContratacao}
          title={isDiscarded ? 'Desfazer descartar' : 'Descartar proposta'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {isDiscarded ? (
              <>
                <path d="M3 7v6h6" />
                <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
              </>
            ) : (
              <>
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6M14 11v6" />
              </>
            )}
          </svg>
          <span>{isDiscarded ? 'Desfazer descartar' : 'Descartar'}</span>
        </button>
      </div>
    </article>
  );
}
