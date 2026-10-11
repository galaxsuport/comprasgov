import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import {
  addFavorite,
  discardProposal,
  fetchDiscarded,
  fetchFavorites,
  restoreProposal,
  beginAnalysis,
  enqueueAnalysis,
  refreshAnalysis,
  fetchAnalyses,
  fetchResultados,
  getAnalysisParams,
  fetchText,
  fetchDeadline,
  saveText,
  saveDeadline,
  fetchTerms,
  saveTerms,
  type TermKind,
  changePassword,
  logout,
  removeFavorite,
  WebhookPopupError
} from './api';
import type { AnalysisJob } from './api';
import type { OportunidadeResultado, PregaoResultado } from './types';
import ResultCard from './components/ResultCard';
import AnalysisPage from './components/AnalysisPage';

const LEGACY_FAVORITES_STORAGE_KEY = 'comprasgov:favorites';

function getFavoriteKey(result: OportunidadeResultado): string | null {
  if (result.idContratacaoPNCP) return `id:${result.idContratacaoPNCP}`;
  if (result.linkContratacao) return `link:${result.linkContratacao}`;
  return null;
}

function readLegacyFavorites(): OportunidadeResultado[] {
  const saved = localStorage.getItem(LEGACY_FAVORITES_STORAGE_KEY);
  if (!saved) return [];

  const parsed: unknown = JSON.parse(saved);
  if (!Array.isArray(parsed)) {
    throw new Error('Os favoritos locais antigos estão em um formato inválido.');
  }

  return parsed.filter((item): item is OportunidadeResultado =>
    item?.tipoSaida === 'oportunidade' && Boolean(item.idContratacaoPNCP || item.linkContratacao)
  );
}

interface FetchFilters {
  ufs?: string;
  uasg?: string;
}

const TODAS_UFS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

const REGIOES = {
  Norte: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  Nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'Centro-Oeste': ['DF', 'GO', 'MT', 'MS'],
  Sudeste: ['ES', 'MG', 'RJ', 'SP'],
  Sul: ['PR', 'RS', 'SC']
} as const;

function FilterControls({ onFilterChange }: { onFilterChange: (filters: FetchFilters) => void }) {
  const [ufs, setUfs] = useState<string[]>([]);
  const [uasg, setUasg] = useState('');
  const [uasgError, setUasgError] = useState<string | null>(null);

  const [abertas, setAbertas] = useState<string[]>([]);

  const toggleAberta = (nome: string) => {
    setAbertas(prev => prev.includes(nome) ? prev.filter(n => n !== nome) : [...prev, nome]);
  };

  const uasgAtiva = uasg.length > 0;
  const regioesAtivas = ufs.length > 0;

  const handleUasgChange = (value: string) => {
    setUasg(value.replace(/\D/g, '').slice(0, 6));
    setUasgError(null);
  };

  const handleApplyFilters = () => {
    if (uasgAtiva) {
      if (uasg.length !== 6) {
        setUasgError('Informe o código da UASG com 6 dígitos.');
        return;
      }
      onFilterChange({ uasg });
      return;
    }

    if (ufs.length === 0) return;
    onFilterChange({ ufs: ufs.join(',') });
  };

  const toggleUf = (uf: string) => {
    setUfs(prev => prev.includes(uf) ? prev.filter(u => u !== uf) : [...prev, uf]);
  };

  const toggleRegiao = (regiao: readonly string[]) => {
    setUfs(prev => regiao.every(uf => prev.includes(uf))
      ? prev.filter(uf => !regiao.includes(uf))
      : Array.from(new Set([...prev, ...regiao]))
    );
  };

  return (
    <aside className="sidebar">
      <section className="filter-controls">
        <h3>Filtros</h3>

        <div className="filter-group">
          <label htmlFor="filter-uasg">UASG</label>
          <input
            id="filter-uasg"
            type="text"
            inputMode="numeric"
            placeholder="Código com 6 dígitos"
            value={uasg}
            disabled={regioesAtivas}
            aria-invalid={uasgError ? true : undefined}
            aria-describedby={uasgError ? 'filter-uasg-error' : undefined}
            onChange={event => handleUasgChange(event.target.value)}
          />
          {uasgError ? <p id="filter-uasg-error" className="login-error" role="alert">{uasgError}</p> : null}
          {regioesAtivas ? <p className="filter-hint">Desmarque as regiões para filtrar por UASG.</p> : null}
        </div>

        <div className="filter-group">
          <label htmlFor="deadline-slider">PRAZO</label>
          <DeadlineSetting />
        </div>

        <div className="filter-group">
          <span className="filter-label">REGIÕES</span>
          {uasgAtiva ? <p className="filter-hint">Limpe o campo UASG para filtrar por região.</p> : null}
          <div className="region-groups">
            {Object.entries(REGIOES).map(([nome, regiao]) => {
              const regiaoSelecionada = regiao.every(uf => ufs.includes(uf));
              const aberta = abertas.includes(nome);
              const selecionadas = regiao.filter(uf => ufs.includes(uf)).length;
              const painelId = `regiao-${nome}`;

              return (
                <div key={nome} className={`region-group${aberta ? ' is-open' : ''}`}>
                  <div className="region-heading">
                    <button
                      type="button"
                      className="region-toggle"
                      aria-expanded={aberta}
                      aria-controls={painelId}
                      onClick={() => toggleAberta(nome)}
                    >
                      <span className="region-chevron" aria-hidden="true">▸</span>
                      <span>{nome}</span>
                      {selecionadas > 0 ? <span className="region-count">{selecionadas}</span> : null}
                    </button>
                    <button
                      type="button"
                      className="btn-region"
                      disabled={uasgAtiva}
                      onClick={() => toggleRegiao(regiao)}
                    >
                      {regiaoSelecionada ? 'Desmarcar' : 'Selecionar'}
                    </button>
                  </div>
                  <div id={painelId} className="region-collapse">
                    <div className="uf-checkboxes">
                      {regiao.map(uf => (
                        <label key={uf} className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={ufs.includes(uf)}
                            disabled={uasgAtiva}
                            onChange={() => toggleUf(uf)}
                          />
                          <span>{uf}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <button onClick={handleApplyFilters} className="btn-apply-filters">
          Aplicar Filtros
        </button>
      </section>
    </aside>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSuccess(false);

    if (newPassword.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmation) {
      setError('A confirmação não confere com a nova senha.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="login-form password-form" onSubmit={handleSubmit}>
      <div className="password-fields">
        <div className="password-field">
          <label htmlFor="current-password">Senha atual</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={event => setCurrentPassword(event.target.value)}
            required
          />
        </div>

        <div className="password-field">
          <label htmlFor="new-password">Nova senha</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={event => setNewPassword(event.target.value)}
            required
          />
        </div>

        <div className="password-field">
          <label htmlFor="confirm-password">Confirmar nova senha</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={event => setConfirmation(event.target.value)}
            required
          />
        </div>
      </div>
      {error ? <p className="login-error" role="alert">{error}</p> : null}
      {success ? <p className="form-success" role="status">Senha alterada com sucesso.</p> : null}

      <button type="submit" className="btn-apply-filters" disabled={saving}>
        {saving ? 'Salvando...' : 'Alterar senha'}
      </button>
    </form>
  );
}

function TermsEditor({ kind, label, placeholder }: { kind: TermKind; label: string; placeholder: string }) {
  const [terms, setTerms] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchTerms(kind)
      .then(loaded => {
        setTerms(loaded);
        setStatus('ready');
      })
      .catch(err => {
        setMessage(err instanceof Error ? err.message : 'Não foi possível carregar os temas.');
        setStatus('error');
      });
  }, [kind]);

  const persist = async (next: string[]) => {
    const previous = terms;
    setTerms(next);
    setStatus('saving');
    setMessage(null);
    try {
      setTerms(await saveTerms(kind, next));
      setStatus('ready');
    } catch (err) {
      setTerms(previous);
      setMessage(err instanceof Error ? err.message : 'Não foi possível salvar os temas.');
      setStatus('ready');
    }
  };

  const addTerms = (raw: string) => {
    const incoming = raw.split(/[,;\n]/).map(term => term.trim()).filter(Boolean);
    if (incoming.length === 0) return;
    const known = new Set(terms.map(term => term.toLowerCase()));
    const fresh = incoming.filter(term => {
      const key = term.toLowerCase();
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    setDraft('');
    if (fresh.length > 0) void persist([...terms, ...fresh]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTerms(draft);
    } else if (event.key === 'Backspace' && draft === '' && terms.length > 0) {
      void persist(terms.slice(0, -1));
    }
  };

  if (status === 'loading') return <p className="filter-hint">Carregando temas...</p>;

  const query = draft.trim().toLowerCase();
  const visible = query ? terms.filter(term => term.toLowerCase().includes(query)) : terms;

  return (
    <div className="tag-editor">
      <label htmlFor={`${kind}-input`}>Adicionar ou buscar tema (Enter ou vírgula para adicionar)</label>
      <input
        id={`${kind}-input`}
        type="text"
        value={draft}
        placeholder={placeholder}
        maxLength={100}
        disabled={status === 'saving'}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => addTerms(draft)}
      />

      <p className="filter-hint" aria-live="polite">
        {status === 'saving' ? 'Salvando...' : `${terms.length} temas salvos${query ? ` · ${visible.length} exibidos` : ''}`}
      </p>
      {message ? <p className="login-error" role="alert">{message}</p> : null}

      <ul className="tag-list" aria-label={label}>
        {visible.map(term => (
          <li key={term} className="tag">
            <span>{term}</span>
            <button
              type="button"
              aria-label={`Remover ${term}`}
              disabled={status === 'saving'}
              onClick={() => void persist(terms.filter(item => item !== term))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MIN_DEADLINE = 1;
const MAX_DEADLINE = 15;

function DeadlineSetting() {
  const [value, setValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchDeadline()
      .then(setValue)
      .catch(err => setMessage(err instanceof Error ? err.message : 'Não foi possível carregar o prazo.'));
  }, []);

  const commit = async (next: number) => {
    setSaving(true);
    setMessage(null);
    try {
      setValue(await saveDeadline(next));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível salvar o prazo.');
    } finally {
      setSaving(false);
    }
  };

  if (value === null) {
    return message ? <p className="login-error" role="alert">{message}</p> : <p className="filter-hint">Carregando prazo...</p>;
  }

  const progress = ((value - MIN_DEADLINE) / (MAX_DEADLINE - MIN_DEADLINE)) * 100;
  const unit = (days: number) => `${days} ${days === 1 ? 'dia' : 'dias'}`;

  return (
    <div className="days-card">
      <div className="days-header">
        <span>Fim do envio da proposta</span>
        <strong aria-live="polite">{unit(value)}</strong>
      </div>

      <input
        id="deadline-slider"
        className="days-range"
        type="range"
        min={MIN_DEADLINE}
        max={MAX_DEADLINE}
        step={1}
        value={value}
        disabled={saving}
        style={{ '--progress': `${progress}%` } as CSSProperties}
        aria-valuetext={unit(value)}
        onChange={event => setValue(Number(event.target.value))}
        onPointerUp={event => void commit(Number(event.currentTarget.value))}
        onKeyUp={event => void commit(Number(event.currentTarget.value))}
      />

      <div className="range-labels" aria-hidden="true">
        <span>{unit(MIN_DEADLINE)}</span>
        <span>{unit(8)}</span>
        <span>{unit(MAX_DEADLINE)}</span>
      </div>

      {saving ? <p className="filter-hint" aria-live="polite">Salvando...</p> : null}
      {message ? <p className="login-error" role="alert">{message}</p> : null}
    </div>
  );
}

type Branding = { companyName: string; title: string; subtitle: string };

const DEFAULT_BRANDING: Branding = {
  companyName: 'GALAX SUPORT',
  title: 'Contratações TIC',
  subtitle: 'Interface moderna para listar os dados retornados do Portal de Compras do Governo Federal realacionados a TIC.'
};

const BRANDING_FIELDS = [
  { field: 'companyName', kind: 'company-name', label: 'Nome da empresa', maxLength: 80, uppercase: true },
  { field: 'title', kind: 'title', label: 'Título', maxLength: 120, uppercase: false },
  { field: 'subtitle', kind: 'subtitle', label: 'Subtítulo', maxLength: 300, uppercase: false }
] as const;

function BrandingSettings({ value, onChange }: { value: Branding; onChange: (branding: Branding) => void }) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => setDraft(value), [value]);

  const dirty = BRANDING_FIELDS.some(({ field }) => draft[field].trim() !== value[field]);
  const complete = BRANDING_FIELDS.every(({ field }) => draft[field].trim());

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const saved = { ...value };
      for (const { field, kind } of BRANDING_FIELDS) {
        if (draft[field].trim() !== value[field]) saved[field] = await saveText(kind, draft[field]);
      }
      onChange(saved);
      setMessage('Alterações salvas.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Não foi possível salvar as alterações.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="login-form password-form" onSubmit={event => void handleSubmit(event)}>
      <div className="branding-fields">
      {BRANDING_FIELDS.map(({ field, label, maxLength, uppercase }) => (
        <div className={`filter-group${field === 'subtitle' ? ' branding-wide' : ''}`} key={field}>
          <label htmlFor={`branding-${field}`}>{label}</label>
          {field === 'subtitle' ? (
            <textarea
              id={`branding-${field}`}
              rows={3}
              maxLength={maxLength}
              value={draft[field]}
              onChange={event => setDraft({ ...draft, [field]: event.target.value })}
            />
          ) : (
            <input
              id={`branding-${field}`}
              type="text"
              maxLength={maxLength}
              value={draft[field]}
              onChange={event => setDraft({ ...draft, [field]: uppercase ? event.target.value.toUpperCase() : event.target.value })}
            />
          )}
        </div>
      ))}
      </div>
      <button type="submit" className="btn-apply-filters" disabled={saving || !dirty || !complete}>
        {saving ? 'Salvando...' : 'Salvar'}
      </button>
      {message ? <p className="filter-hint" role="status">{message}</p> : null}
    </form>
  );
}

function SettingsPage({ favoritesCount, branding, onBrandingChange, onBack }: {
  favoritesCount: number;
  branding: Branding;
  onBrandingChange: (branding: Branding) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<'account' | 'terms' | 'contextual' | 'technological' | 'exclusion'>('account');
  const tabs = [
    { id: 'account', label: 'Conta' },
    { id: 'terms', label: 'Temas fortes' },
    { id: 'contextual', label: 'Termos contextuais' },
    { id: 'technological', label: 'Contextos tecnológicos' },
    { id: 'exclusion', label: 'Termos de exclusão' }
  ] as const;

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = tabs.findIndex(item => item.id === tab);
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  };

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <h2 id="settings-title">Configurações</h2>

      <div className="settings-tabs" role="tablist" aria-label="Seções de configurações">
        {tabs.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`settings-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`settings-panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            className={`settings-tab${tab === item.id ? ' is-active' : ''}`}
            onClick={() => setTab(item.id)}
            onKeyDown={handleTabKeyDown}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'account' ? (
        <div role="tabpanel" id="settings-panel-account" aria-labelledby="settings-tab-account" className="settings-panel">
          <div className="settings-section">
            <h3>Conta</h3>
            <p className="filter-hint">Seus favoritos ({favoritesCount}) ficam salvos no servidor e acompanham a sua conta em qualquer dispositivo.</p>
          </div>

          <div className="settings-section settings-section-wide">
            <h3>Identificação</h3>
            <BrandingSettings value={branding} onChange={onBrandingChange} />
          </div>

          <div className="settings-section">
            <h3>Alterar senha</h3>
            <ChangePasswordForm />
          </div>
        </div>
      ) : tab === 'terms' ? (
        <div role="tabpanel" id="settings-panel-terms" aria-labelledby="settings-tab-terms" className="settings-panel">
          <div className="settings-section settings-section-wide">
            <h3>Temas fortes</h3>
            <p className="filter-hint">Termos que caracterizam contratações de TIC. Ficam salvos no banco de dados da sua conta.</p>
            <TermsEditor kind="strong-terms" label="Temas fortes" placeholder="Ex.: firewall" />
          </div>
        </div>
      ) : tab === 'contextual' ? (
        <div role="tabpanel" id="settings-panel-contextual" aria-labelledby="settings-tab-contextual" className="settings-panel">
          <div className="settings-section settings-section-wide">
            <h3>Termos contextuais</h3>
            <p className="filter-hint">Termos genéricos que só indicam TIC em conjunto com outros sinais. Ficam salvos no banco de dados da sua conta.</p>
            <TermsEditor kind="contextual-terms" label="Termos contextuais" placeholder="Ex.: servidor" />
          </div>
        </div>
      ) : tab === 'technological' ? (
        <div role="tabpanel" id="settings-panel-technological" aria-labelledby="settings-tab-technological" className="settings-panel">
          <div className="settings-section settings-section-wide">
            <h3>Contextos tecnológicos</h3>
            <p className="filter-hint">Palavras que, junto de um termo contextual, confirmam que a contratação é de TIC. Ficam salvas no banco de dados da sua conta.</p>
            <TermsEditor kind="technological-contexts" label="Contextos tecnológicos" placeholder="Ex.: rede" />
          </div>
        </div>
      ) : (
        <div role="tabpanel" id="settings-panel-exclusion" aria-labelledby="settings-tab-exclusion" className="settings-panel">
          <div className="settings-section settings-section-wide">
            <h3>Termos de exclusão</h3>
            <p className="filter-hint">Termos que indicam contratações fora do escopo de TIC. Ficam salvos no banco de dados da sua conta.</p>
            <TermsEditor kind="exclusion-terms" label="Termos de exclusão" placeholder="Ex.: material de limpeza" />
          </div>
        </div>
      )}

      <button type="button" className="logout-button" onClick={onBack}>Voltar aos resultados</button>
    </section>
  );
}

function Header({
  branding,
  showFavorites,
  favoritesCount,
  showDiscarded,
  discardedCount,
  analysisOpen,
  analysisCount,
  analysisDoneCount,
  settingsOpen,
  onToggleFavorites,
  onToggleDiscarded,
  onToggleAnalysis,
  onToggleSettings,
  onLogout
}: {
  branding: Branding;
  showFavorites: boolean;
  favoritesCount: number;
  showDiscarded: boolean;
  discardedCount: number;
  analysisOpen: boolean;
  analysisCount: number;
  analysisDoneCount: number;
  settingsOpen: boolean;
  onToggleFavorites: () => void;
  onToggleDiscarded: () => void;
  onToggleAnalysis: () => void;
  onToggleSettings: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="hero">
      <div>
        <p className="eyebrow">{branding.companyName}</p>
        <h1>{branding.title}</h1>
      </div>
      <button
        type="button"
        className={`favorites-toggle${showFavorites ? ' is-active' : ''}`}
        onClick={onToggleFavorites}
        aria-pressed={showFavorites}
        aria-label={`${showFavorites ? 'Voltar aos resultados' : 'Abrir favoritos'}, ${favoritesCount} salvos`}
        title={showFavorites ? 'Voltar aos resultados' : 'Abrir favoritos'}
      >
        <span className="favorites-toggle-icon" aria-hidden="true">★</span>
        <span className="favorites-count" aria-hidden="true">{favoritesCount}</span>
      </button>
      <button
        type="button"
        className={`discarded-toggle${showDiscarded ? ' is-active' : ''}`}
        onClick={onToggleDiscarded}
        aria-pressed={showDiscarded}
        aria-label={`${showDiscarded ? 'Voltar aos resultados' : 'Abrir descartadas'}, ${discardedCount} descartadas`}
        title={showDiscarded ? 'Voltar aos resultados' : 'Abrir descartadas'}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6M14 11v6" />
        </svg>
        <span className="favorites-count" aria-hidden="true">{discardedCount}</span>
      </button>
      <button
        type="button"
        className={`discarded-toggle analysis-toggle${analysisOpen ? ' is-active' : ''}`}
        onClick={onToggleAnalysis}
        aria-pressed={analysisOpen}
        aria-label={`${analysisOpen ? 'Voltar aos resultados' : 'Abrir análises'}, ${analysisDoneCount} de ${analysisCount} analisadas`}
        title={analysisOpen ? 'Voltar aos resultados' : 'Abrir análises'}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <span className="favorites-count" aria-hidden="true">{analysisDoneCount}/{analysisCount}</span>
      </button>
      <button
        type="button"
        className={`settings-toggle${settingsOpen ? ' is-active' : ''}`}
        onClick={onToggleSettings}
        aria-pressed={settingsOpen}
        aria-label={settingsOpen ? 'Fechar configurações' : 'Abrir configurações'}
        title={settingsOpen ? 'Fechar configurações' : 'Abrir configurações'}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
      <button type="button" className="logout-button" onClick={onLogout}>
        Sair
      </button>
      <p className="hero-copy">{branding.subtitle}</p>
    </header>
  );
}

type SummaryFilter = 'dispensas' | 'pregao' | 'sigiloso' | 'srp' | null;

function matchesSummaryFilter(result: PregaoResultado, filter: SummaryFilter): boolean {
  if (!filter) return true;
  if (result.tipoSaida !== 'oportunidade') return false;

  const modalidade = result.modalidade?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() ?? '';

  switch (filter) {
    case 'dispensas':
      return result.codigoModalidade === 8 || modalidade.includes('dispensa');
    case 'pregao':
      return modalidade.includes('pregao') && modalidade.includes('eletronico');
    case 'sigiloso':
      return result.valor?.trim().toLowerCase() === 'sigiloso';
    case 'srp':
      return result.registroPreco === true;
  }
}

function Summary({
  results,
  favoritesView,
  discardedView,
  activeFilter,
  onSelectFilter
}: {
  results: PregaoResultado[];
  favoritesView: boolean;
  discardedView: boolean;
  activeFilter: SummaryFilter;
  onSelectFilter: (filter: SummaryFilter) => void;
}) {
  const count = (filter: SummaryFilter) => results.filter(result => matchesSummaryFilter(result, filter)).length;
  const othersSum = count('dispensas') + count('pregao') + count('sigiloso') + count('srp');
  const total = othersSum === 0 && !favoritesView && !discardedView ? 0 : results.length;

  return (
    <section className="summary-bar">
      <button
        type="button"
        className={`summary-metric${activeFilter === 'dispensas' ? ' is-active' : ''}`}
        aria-pressed={activeFilter === 'dispensas'}
        onClick={() => onSelectFilter('dispensas')}
      >
        <p className="summary-label">Dispensas</p>
        <p className="summary-value">{count('dispensas')}</p>
      </button>
      <button
        type="button"
        className={`summary-metric${activeFilter === 'pregao' ? ' is-active' : ''}`}
        aria-pressed={activeFilter === 'pregao'}
        onClick={() => onSelectFilter('pregao')}
      >
        <p className="summary-label">Pregão</p>
        <p className="summary-value">{count('pregao')}</p>
      </button>
      <button
        type="button"
        className={`summary-metric${activeFilter === 'sigiloso' ? ' is-active' : ''}`}
        aria-pressed={activeFilter === 'sigiloso'}
        onClick={() => onSelectFilter('sigiloso')}
      >
        <p className="summary-label">Sigiloso</p>
        <p className="summary-value">{count('sigiloso')}</p>
      </button>
      <button
        type="button"
        className={`summary-metric${activeFilter === 'srp' ? ' is-active' : ''}`}
        aria-pressed={activeFilter === 'srp'}
        onClick={() => onSelectFilter('srp')}
      >
        <p className="summary-label">SRP</p>
        <p className="summary-value">{count('srp')}</p>
      </button>
      <button
        type="button"
        className={`summary-metric${activeFilter === null ? ' is-active' : ''}`}
        aria-pressed={activeFilter === null}
        onClick={() => onSelectFilter(null)}
      >
        <p className="summary-label">{discardedView ? 'Descartadas' : favoritesView ? 'Favoritos salvos' : 'Total'}</p>
        <p className="summary-value">{total}</p>
      </button>
      <p className="summary-note">
        {discardedView
          ? 'Propostas descartadas salvas na sua conta.'
          : favoritesView
            ? 'Oportunidades armazenadas neste navegador.'
            : 'Os dados são consumidos diretamente do PNCP.'}
      </p>
    </section>
  );
}

function BackToTopButton() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const updateVisibility = () => setIsVisible(window.scrollY > 240);
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    return () => window.removeEventListener('scroll', updateVisibility);
  }, []);

  if (!isVisible) return null;

  const scrollToTop = () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
  };

  return (
    <button
      type="button"
      className="back-to-top"
      onClick={scrollToTop}
      aria-label="Voltar ao topo"
      title="Voltar ao topo"
    >
      <span aria-hidden="true">↑</span>
    </button>
  );
}

function WebhookErrorPopup({
  title,
  message,
  sample,
  onClose
}: {
  title: string;
  message: string;
  sample: string | null;
  onClose: () => void;
}) {
  return (
    <div className="webhook-popup-backdrop">
      <section
        className="webhook-popup"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="webhook-popup-title"
        aria-describedby="webhook-popup-message"
      >
        <p className="eyebrow">Consulta indisponível</p>
        <h2 id="webhook-popup-title">{title}</h2>
        <p id="webhook-popup-message">{message}</p>
        {sample ? (
          <div className="webhook-popup-sample">
            <h3>Amostra</h3>
            <pre>{sample}</pre>
          </div>
        ) : null}
        <button autoFocus className="btn-apply-filters" onClick={onClose}>
          Fechar
        </button>
      </section>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [companyName, setCompanyName] = useState(DEFAULT_BRANDING.companyName);
  const [title, setTitle] = useState(DEFAULT_BRANDING.title);

  useEffect(() => {
    fetch('/api/auth/company')
      .then(response => (response.ok ? response.json() as Promise<{ value: string; title: string }> : null))
      .then(data => {
        if (data?.value) setCompanyName(data.value);
        if (data?.title) setTitle(data.title);
      })
      .catch(() => undefined);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await onLogin(username.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível autenticar.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <p className="eyebrow">{companyName}</p>
        <h1 id="login-title">Acesse sua conta</h1>
        <p className="login-copy">{title}</p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="login-username">Usuário</label>
          <input
            id="login-username"
            name="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={event => setUsername(event.target.value)}
            required
            autoFocus
          />

          <label htmlFor="login-password">Senha</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
          />

          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <button className="btn-apply-filters" type="submit" disabled={submitting}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}

const LOADING_TIMEOUT_SECONDS = 150;

function CountdownSpinner() {
  const [remaining, setRemaining] = useState(LOADING_TIMEOUT_SECONDS);

  useEffect(() => {
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRemaining(Math.max(0, LOADING_TIMEOUT_SECONDS - elapsed));
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="countdown-spinner"
      role="timer"
      aria-label={`Tempo restante: ${remaining} segundos`}
      style={{ '--duration': `${LOADING_TIMEOUT_SECONDS}s` } as CSSProperties}
    >
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle className="countdown-track" cx="24" cy="24" r="21" />
        <circle className="countdown-arc" cx="24" cy="24" r="21" pathLength="100" />
      </svg>
      <span>{remaining}s</span>
    </div>
  );
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [resultados, setResultados] = useState<PregaoResultado[]>([]);
  const [favorites, setFavorites] = useState<OportunidadeResultado[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoriteError, setFavoriteError] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState<OportunidadeResultado[]>([]);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [favoriteOperations, setFavoriteOperations] = useState<Set<string>>(() => new Set());
  const [showFavorites, setShowFavorites] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisJobs, setAnalysisJobs] = useState<AnalysisJob[]>([]);
  const analysisCount = analysisJobs.length;
  const analysisDoneCount = analysisJobs.filter(job => /conclu|finaliz|pronto|sucesso|complet|done/i.test(job.status)).length;
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const analysisStates = useMemo(() => {
    const states = new Map<string, 'done' | 'pending'>();
    for (const job of analysisJobs) {
      if (/erro|falha|fail|cancel/i.test(job.status)) continue;
      const key = getFavoriteKey(job.proposal);
      if (key) states.set(key, /conclu|finaliz|pronto|sucesso|complet|done/i.test(job.status) ? 'done' : 'pending');
    }
    return states;
  }, [analysisJobs]);

  useEffect(() => {
    fetchAnalyses().then(setAnalysisJobs).catch(() => undefined);
  }, []);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    Promise.all(BRANDING_FIELDS.map(({ kind }) => fetchText(kind)))
      .then(([companyName, title, subtitle]) => setBranding({ companyName, title, subtitle }))
      .catch(() => undefined);
  }, []);
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [popupError, setPopupError] = useState<{ title: string; message: string; sample: string | null } | null>(null);
  const [filters, setFilters] = useState<FetchFilters | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadFavorites() {
      try {
        const savedFavorites = await fetchFavorites();
        if (cancelled) return;
        setFavorites(savedFavorites);

        const legacyFavorites = readLegacyFavorites();
        const knownKeys = new Set(savedFavorites.map(getFavoriteKey));
        const migrated: OportunidadeResultado[] = [];
        for (const favorite of legacyFavorites) {
          const key = getFavoriteKey(favorite);
          if (!key || knownKeys.has(key)) continue;
          migrated.push(await addFavorite(favorite));
          knownKeys.add(key);
        }

        if (cancelled) return;
        if (migrated.length > 0) {
          setFavorites(current => [...migrated, ...current]);
        }
        if (legacyFavorites.length > 0) {
          localStorage.removeItem(LEGACY_FAVORITES_STORAGE_KEY);
        }
      } catch (err) {
        if (!cancelled) {
          setFavoriteError(err instanceof Error ? err.message : 'Não foi possível carregar os favoritos.');
        }
      } finally {
        if (!cancelled) setFavoritesLoading(false);
      }
    }

    loadFavorites();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!filters?.ufs && !filters?.uasg) return;
    const activeFilters = filters;

    const controller = new AbortController();
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setResultados([]);
        setError(null);
        setPopupError(null);
        setLoadingStep('Iniciando busca...');
        
        // Simula etapas de progresso
        const steps = [
          'Conectando ao webhook...',
          'Buscando páginas da API PNCP...',
          'Filtrando oportunidades TIC...',
          'Removendo duplicatas...',
          'Preparando resultados...'
        ];
        
        let stepIndex = 0;
        const progressInterval = setInterval(() => {
          if (stepIndex < steps.length - 1) {
            stepIndex++;
            setLoadingStep(steps[stepIndex]);
          }
        }, 2000);

        const response = await fetchResultados(activeFilters, controller.signal);
        
        clearInterval(progressInterval);
        setLoadingStep('Finalizando...');
        
        if (!cancelled) {
          setResultados(response.resultados);
          setPopupError(response.aviso);
        }
      } catch (err) {
        if (!cancelled && err instanceof WebhookPopupError) {
          setPopupError({ title: err.title, message: err.message, sample: err.sample });
        } else if (!cancelled && err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoadingStep('');
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filters]);

  const handleFilterChange = (newFilters: FetchFilters) => {
    setSummaryFilter(null);
    setSettingsOpen(false);
    setAnalysisOpen(false);
    setShowFavorites(false);
    setShowDiscarded(false);
    setFilters(newFilters);
    window.scrollTo({ top: 0 });
  };

  const handleSummaryFilterChange = (filter: SummaryFilter) => {
    setSummaryFilter(current => current === filter ? null : filter);
  };

  // A ordem é definida a cada nova pesquisa; descartar um card não o move até a próxima.
  const discardedKeysRef = useRef<Set<string>>(new Set());
  const orderedResults = useMemo(() => {
    const isDiscarded = (item: PregaoResultado) =>
      item.tipoSaida === 'oportunidade' && discardedKeysRef.current.has(getFavoriteKey(item) ?? '');
    return [...resultados.filter(item => !isDiscarded(item)), ...resultados.filter(isDiscarded)];
  }, [resultados]);

  const discardedKeys = new Set(discarded.map(getFavoriteKey).filter((key): key is string => key !== null));

  discardedKeysRef.current = discardedKeys;

  useEffect(() => {
    fetchDiscarded()
      .then(setDiscarded)
      .catch(err => setFavoriteError(err instanceof Error ? err.message : 'Não foi possível carregar as propostas descartadas.'));
  }, []);

  // Processa só os pendentes do momento do clique; inclusões posteriores ficam de fora.
  const runAllAnalyses = async () => {
    if (batchRunning) return;
    const queue = analysisJobs.filter(job => job.status === 'pendente').map(job => job.jobId);
    if (queue.length === 0) return;

    const isDone = (job: AnalysisJob) => /erro|falha|fail|cancel|conclu|finaliz|pronto|sucesso|complet|done/i.test(job.status);
    const replace = (oldId: string, job: AnalysisJob) =>
      setAnalysisJobs(current => current.map(item => (item.jobId === oldId ? job : item)));
    const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

    setBatchRunning(true);
    setBatchError(null);
    try {
      for (const id of queue) {
        if (!mountedRef.current) return;
        let current: AnalysisJob;
        try {
          current = await beginAnalysis(id);
        } catch (err) {
          setBatchError(err instanceof Error ? err.message : 'Não foi possível iniciar a análise.');
          return;
        }
        replace(id, current);

        let failures = 0;
        while (mountedRef.current && !isDone(current) && failures < 3) {
          await wait(5000);
          try {
            const updated = await refreshAnalysis(current.jobId);
            failures = 0;
            replace(current.jobId, updated);
            current = updated;
          } catch {
            failures += 1;
          }
        }
      }
    } finally {
      if (mountedRef.current) setBatchRunning(false);
    }
  };

  const analyzeProposal = async (result: OportunidadeResultado) => {
    setFavoriteError(null);
    try {
      const params = getAnalysisParams(result);
      if (!params) throw new Error('UASG ou número da compra indisponível para esta proposta.');
      const job = await enqueueAnalysis({ ...result, ...params });
      setAnalysisJobId(job.jobId);
      setAnalysisJobs(await fetchAnalyses().catch(() => analysisJobs));
    } catch (err) {
      setFavoriteError(err instanceof Error ? err.message : 'Não foi possível iniciar a análise.');
    }
  };

  const toggleDiscard = async (result: OportunidadeResultado) => {
    const key = getFavoriteKey(result);
    if (!key || favoriteOperations.has(key)) return;

    const discarding = !discardedKeys.has(key);
    setFavoriteOperations(current => new Set(current).add(key));
    setFavoriteError(null);
    try {
      if (discarding) await discardProposal(result);
      else await restoreProposal(key);
      setDiscarded(current => discarding
        ? [result, ...current.filter(item => getFavoriteKey(item) !== key)]
        : current.filter(item => getFavoriteKey(item) !== key));
    } catch (err) {
      setFavoriteError(err instanceof Error ? err.message : 'Não foi possível atualizar a proposta.');
    } finally {
      setFavoriteOperations(current => {
        const updated = new Set(current);
        updated.delete(key);
        return updated;
      });
    }
  };

  const toggleFavorite = async (result: OportunidadeResultado) => {
    const key = getFavoriteKey(result);
    if (!key || favoriteOperations.has(key)) return;

    setFavoriteOperations(current => new Set(current).add(key));
    setFavoriteError(null);
    try {
      if (favorites.some(item => getFavoriteKey(item) === key)) {
        await removeFavorite(key);
        setFavorites(current => current.filter(item => getFavoriteKey(item) !== key));
      } else {
        const saved = await addFavorite(result);
        setFavorites(current => [saved, ...current.filter(item => getFavoriteKey(item) !== key)]);
      }
    } catch (err) {
      setFavoriteError(err instanceof Error ? err.message : 'Não foi possível atualizar os favoritos.');
    } finally {
      setFavoriteOperations(current => {
        const updated = new Set(current);
        updated.delete(key);
        return updated;
      });
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      onLogout();
    } catch (err) {
      setFavoriteError(err instanceof Error ? err.message : 'Não foi possível encerrar a sessão.');
    }
  };

  const baseResults = showDiscarded ? discarded : showFavorites ? favorites : orderedResults;
  const summaryResults = showDiscarded
    ? baseResults
    : baseResults.filter(item => item.tipoSaida !== 'oportunidade' || !discardedKeys.has(getFavoriteKey(item) ?? ''));
  const visibleResults = baseResults.filter(result => matchesSummaryFilter(result, summaryFilter));

  return (
    <div className="app-layout">
      <FilterControls onFilterChange={handleFilterChange} />

      {popupError ? (
        <WebhookErrorPopup
          title={popupError.title}
          message={popupError.message}
          sample={popupError.sample}
          onClose={() => setPopupError(null)}
        />
      ) : null}

      <main className="page-shell">
        <Header
          branding={branding}
          showFavorites={showFavorites}
          favoritesCount={favorites.length}
          showDiscarded={showDiscarded}
          discardedCount={discarded.length}
          analysisOpen={analysisOpen}
          analysisCount={analysisCount}
          analysisDoneCount={analysisDoneCount}
          onToggleAnalysis={() => {
            setSettingsOpen(false);
            setShowFavorites(false);
            setShowDiscarded(false);
            setAnalysisOpen(current => !current);
          }}
          settingsOpen={settingsOpen}
          onToggleFavorites={() => {
            setAnalysisOpen(false);
            setSettingsOpen(false);
            setShowDiscarded(false);
            setShowFavorites(current => !current);
          }}
          onToggleDiscarded={() => {
            setAnalysisOpen(false);
            setSettingsOpen(false);
            setShowFavorites(false);
            setShowDiscarded(current => !current);
          }}
          onToggleSettings={() => {
            setAnalysisOpen(false);
            setSettingsOpen(current => !current);
          }}
          onLogout={handleLogout}
        />

        {analysisOpen && !settingsOpen ? (
          <AnalysisPage focusJobId={analysisJobId} batchRunning={batchRunning} batchError={batchError} onRunAll={() => void runAllAnalyses()} onJobsChange={setAnalysisJobs} onBack={() => setAnalysisOpen(false)} />
        ) : settingsOpen ? (
          <SettingsPage
            favoritesCount={favorites.length}
            branding={branding}
            onBrandingChange={setBranding}
            onBack={() => setSettingsOpen(false)}
          />
        ) : (
        <>

        {favoriteError ? (
          <div className="status-card status-error" role="alert">{favoriteError}</div>
        ) : null}

        {favoritesLoading ? (
          <div className="status-card">Carregando favoritos...</div>
        ) : null}

        {loading ? (
          <div className="status-card loading-progress">
            <CountdownSpinner />
            <p>{loadingStep || 'Carregando dados...'}</p>
          </div>
        ) : null}

        {error ? (
          <div className="status-card status-error" role="alert">
            {resultados.length > 0
              ? `A consulta atual falhou: ${error} Exibindo ${resultados.length} resultados da consulta anterior, que podem não corresponder aos filtros atuais.`
              : error}
          </div>
        ) : null}

        {baseResults.length > 0 ? (
          <>
            <Summary
              results={summaryResults}
              favoritesView={showFavorites}
              discardedView={showDiscarded}
              activeFilter={summaryFilter}
              onSelectFilter={handleSummaryFilterChange}
            />
            {visibleResults.length > 0 ? (
              <section className="cards-shell">
                {visibleResults.map((item, index) => (
                  <ResultCard
                    key={item.tipoSaida === 'oportunidade'
                      ? getFavoriteKey(item) ?? `${item.local ?? 'unknown'}-${index}`
                      : `resumo-${index}`}
                    result={item}
                    isFavorite={item.tipoSaida === 'oportunidade'
                      && favorites.some(favorite => getFavoriteKey(favorite) === getFavoriteKey(item))}
                    onToggleFavorite={toggleFavorite}
                    isDiscarded={item.tipoSaida === 'oportunidade'
                      && discardedKeys.has(getFavoriteKey(item) ?? '')}
                    onToggleDiscard={toggleDiscard}
                    onAnalyze={analyzeProposal}
                    analysisLocked={batchRunning}
                    analysisState={item.tipoSaida === 'oportunidade' ? analysisStates.get(getFavoriteKey(item) ?? '') : undefined}
                  />
                ))}
              </section>
            ) : (
              <div className="status-card">Nenhum registro corresponde a este filtro.</div>
            )}
          </>
        ) : !loading && !error ? (
          <div className="status-card">
            {showDiscarded ? 'Nenhuma proposta descartada.' : showFavorites ? 'Nenhum favorito salvo.' : 'Nenhum resultado disponível.'}
          </div>
        ) : null}
        </>
        )}
      </main>
      <BackToTopButton />
    </div>
  );
}

function App() {
  const [authState, setAuthState] = useState<'checking' | 'authenticated' | 'unauthenticated' | 'error'>('checking');
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/session')
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível verificar sua sessão.');
        return response.json() as Promise<{ authenticated: boolean }>;
      })
      .then(({ authenticated }) => {
        if (!cancelled) setAuthState(authenticated ? 'authenticated' : 'unauthenticated');
      })
      .catch(err => {
        if (!cancelled) {
          setAuthError(err instanceof Error ? err.message : 'Não foi possível conectar ao servidor.');
          setAuthState('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (authState === 'checking') {
    return <main className="login-page"><div className="status-card">Verificando sessão...</div></main>;
  }

  if (authState === 'error') {
    return (
      <main className="login-page">
        <div className="status-card status-error" role="alert">
          {authError ?? 'Não foi possível conectar ao servidor.'}
          <button type="button" className="btn-apply-filters" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </div>
      </main>
    );
  }

  if (authState === 'unauthenticated') {
    return (
      <LoginScreen
        onLogin={async (username, password) => {
          const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
          });
          if (!response.ok) {
            const body = await response.json().catch(() => null) as { error?: string } | null;
            throw new Error(body?.error ?? 'Usuário ou senha incorretos.');
          }
          setAuthState('authenticated');
        }}
      />
    );
  }

  return <Dashboard onLogout={() => setAuthState('unauthenticated')} />;
}

export default App;
