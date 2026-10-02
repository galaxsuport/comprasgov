import type { PregaoResultado, OportunidadeResultado, ResumoResultado } from '../types';

interface ResultCardProps {
  result: PregaoResultado;
}

function isOportunidade(result: PregaoResultado): result is OportunidadeResultado {
  return result.tipoSaida === 'oportunidade';
}

function isResumo(result: PregaoResultado): result is ResumoResultado {
  return result.tipoSaida === 'resumo';
}

export default function ResultCard({ result }: ResultCardProps) {
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

  // Renderização para oportunidade
  return (
    <article className="card">
      <div className="card-header">
        <div>
          <p className="eyebrow">{result.fonte ?? 'Fonte desconhecida'}</p>
          <h2>{result.local ?? 'Local não informado'}</h2>
          <p className="subline">{result.orgao ?? 'Órgão não informado'}</p>
          <div className="card-badges">
            {result.modalidade ? <span className="badge">{result.modalidade}</span> : null}
            {result.registroPreco ? <span className="badge">{result.registroPreco ? 'Sim' : 'Não'}</span> : null}
            {result.modoDisputa ? <span className="badge">{result.modoDisputa}</span> : null}
          </div>
        </div>

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
          <span>Dias restantes</span>
          <strong>{result.diasRestantes !== null ? result.diasRestantes : '—'}</strong>
        </div>
      </div>

      <div className="card-meta">
        {result.idContratacaoPNCP ? <span className="id-badge">{result.idContratacaoPNCP}</span> : null}
        {result.local && result.unidadeCompradora ? <span className="chip">{result.unidadeCompradora}</span> : null}
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

      {result.linkContratacao ? (
        <a
          className="action-link"
          href={result.linkContratacao}
          target="_blank"
          rel="noreferrer"
        >
          Ver no PNCP
        </a>
      ) : null}
    </article>
  );
}
