import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import {
  discardProposal,
  fetchDiscarded,
  fetchRegistered,
  registerProposal,
  restoreProposal,
  unregisterProposal,
  fetchAnalyses,
  startAnalysis,
  cancelAnalysis,
  refreshAnalysis,
  getAnalysisParams,
  type AnalysisJob,
  fetchResultados,
  fetchText,
  fetchDeadline,
  saveText,
  saveDeadline,
  fetchTerms,
  saveTerms,
  type TermKind,
  changePassword,
  logout,
  getProposalKey,
  WebhookPopupError
} from './api';
import type { OportunidadeResultado, PregaoResultado, SummaryFilter } from './types';
import ResultCard from './components/ResultCard';
import CalendarPage from './components/CalendarPage';
import { isTerminalAnalysis } from './analysisStatus';
import { Dashboard as DashboardView } from './components/Dashboard';

interface FetchFilters {
  ufs?: string;
  uasg?: string;
  numeroCompra?: string;
}

const REGIOES = {
  Norte: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'],
  Nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
  'Centro-Oeste': ['DF', 'GO', 'MT', 'MS'],
  Sudeste: ['ES', 'MG', 'RJ', 'SP'],
  Sul: ['PR', 'RS', 'SC']
} as const;

function FilterControls({
  onFilterChange,
  loading
}: {
  onFilterChange: (filters: FetchFilters) => void;
  loading: boolean;
}) {
  const [ufs, setUfs] = useState<string[]>([]);
  const [uasg, setUasg] = useState('');
  const [numeroCompra, setNumeroCompra] = useState('');
  const [uasgError, setUasgError] = useState<string | null>(null);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

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
    }

    const filters: FetchFilters = {};
    if (uasgAtiva) filters.uasg = uasg;
    else if (ufs.length > 0) filters.ufs = ufs.join(',');
    if (numeroCompra.trim()) filters.numeroCompra = numeroCompra.trim();
    if (Object.keys(filters).length > 0) onFilterChange(filters);
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
    <aside className={`sidebar${filtersExpanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="sidebar-toggle"
        aria-expanded={filtersExpanded}
        aria-controls="search-filters"
        onClick={() => setFiltersExpanded(expanded => !expanded)}
      >
        <span>Filtros da pesquisa</span>
        <span className="sidebar-toggle-state">{filtersExpanded ? 'Ocultar' : 'Mostrar'}</span>
      </button>
      <section className="filter-controls" id="search-filters">
        <div className="filter-primary-row">
          <div className="filter-group">
            <label htmlFor="filter-uasg">UASG</label>
            <input
              id="filter-uasg"
              type="text"
              inputMode="numeric"
              placeholder="6 dígitos"
              value={uasg}
              disabled={regioesAtivas}
              aria-invalid={uasgError ? true : undefined}
              aria-describedby={uasgError ? 'filter-uasg-error' : undefined}
              onChange={event => handleUasgChange(event.target.value)}
            />
            {uasgError ? <p id="filter-uasg-error" className="login-error" role="alert">{uasgError}</p> : null}
          </div>

          <div className="filter-group">
            <label htmlFor="filter-numero-compra">Nº Compra</label>
            <input
              id="filter-numero-compra"
              type="text"
              inputMode="text"
              placeholder="Ex.: 123/2026"
              value={numeroCompra}
              disabled={regioesAtivas}
              onChange={event => setNumeroCompra(event.target.value)}
            />
          </div>
        </div>
        {regioesAtivas ? <p className="filter-hint">Desmarque as regiões para filtrar por UASG.</p> : null}

        <div className="filter-group">
          <label htmlFor="deadline-slider">PRAZO</label>
          <DeadlineSetting disabled={numeroCompra.trim().length > 0} />
          {numeroCompra.trim() ? <p className="filter-hint">Limpe o Nº Compra para ajustar o prazo.</p> : null}
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

        <button
          onClick={handleApplyFilters}
          className="btn-apply-filters"
          disabled={loading}
        >
          {loading ? 'Pesquisando...' : 'Aplicar'}
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

function DeadlineSetting({ disabled = false }: { disabled?: boolean }) {
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
        disabled={saving || disabled}
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

function SettingsPage({ branding, onBrandingChange, onBack }: {
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

      <button type="button" className="logout-button logout-icon" onClick={onBack} aria-label="Voltar aos resultados" title="Voltar aos resultados">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 19-7-7 7-7M5 12h14" />
        </svg>
      </button>
    </section>
  );
}

function Header({
  branding,
  isHome,
  onGoHome,
  settingsOpen,
  onToggleSettings,
  onLogout,
  showLogout
}: {
  branding: Branding;
  isHome: boolean;
  onGoHome: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onLogout: () => void;
  showLogout: boolean;
}) {
  return (
    <header className="hero">
      <div>
        <p className="eyebrow">{branding.companyName}</p>
        <h1>{branding.title}</h1>
      </div>
      <button
        type="button"
        className={`home-toggle${isHome ? ' is-active' : ''}`}
        onClick={onGoHome}
        aria-pressed={isHome}
        aria-label="Ir para a tela inicial / Dashboard"
        title="Tela inicial / Dashboard"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
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
      {showLogout ? (
        <button type="button" className="logout-button logout-icon" onClick={onLogout} aria-label="Sair" title="Sair">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="9" y1="12" x2="21" y2="12" />
          </svg>
        </button>
      ) : null}
      <p className="hero-copy">{branding.subtitle}</p>
    </header>
  );
}

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
  discardedView,
  activeFilter,
  onSelectFilter
}: {
  results: PregaoResultado[];
  discardedView: boolean;
  activeFilter: SummaryFilter;
  onSelectFilter: (filter: SummaryFilter) => void;
}) {
  const count = (filter: SummaryFilter) => results.filter(result => matchesSummaryFilter(result, filter)).length;
  const othersSum = count('dispensas') + count('pregao') + count('sigiloso') + count('srp');
  const total = othersSum === 0 && !discardedView ? 0 : results.length;

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
        <p className="summary-label">{discardedView ? 'Descartadas' : 'Total'}</p>
        <p className="summary-value">{total}</p>
      </button>
      <p className="summary-note">
        {discardedView
          ? 'Propostas descartadas salvas na sua conta.'
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
      .then(response => {
        if (!response.ok) throw new Error(`Não foi possível carregar a identificação (HTTP ${response.status}).`);
        return response.json() as Promise<{ value: string; title: string }>;
      })
      .then(data => {
        if (data?.value) setCompanyName(data.value);
        if (data?.title) setTitle(data.title);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Não foi possível carregar a identificação.'));
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

function MainApp({ authRequired, onLogout }: { authRequired: boolean; onLogout: () => void }) {
  const [resultados, setResultados] = useState<PregaoResultado[]>([]);
  const [appError, setAppError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState<OportunidadeResultado[]>([]);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [registered, setRegistered] = useState<OportunidadeResultado[]>([]);
  const [proposalStatuses, setProposalStatuses] = useState<Map<string, string>>(() => new Map());
  const handleStatusUpdated = useCallback((key: string, situacao: string) => {
    setProposalStatuses(current => current.get(key) === situacao ? current : new Map(current).set(key, situacao));
  }, []);
  const [discardConfirmation, setDiscardConfirmation] = useState<OportunidadeResultado | null>(null);
  const discardDialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (discardConfirmation) discardDialogRef.current?.showModal();
  }, [discardConfirmation]);
  const [showCalendar, setShowCalendar] = useState(false);
  const [proposalOperations, setProposalOperations] = useState<Set<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analysisJobs, setAnalysisJobs] = useState<AnalysisJob[]>([]);
  const [analysisStartingKeys, setAnalysisStartingKeys] = useState<Set<string>>(() => new Set());
  const analysisStartingRef = useRef(new Set<string>());
  const [analysisCancellingKeys, setAnalysisCancellingKeys] = useState<Set<string>>(() => new Set());
  const analysisCancellingRef = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    void fetchAnalyses(controller.signal).then(jobs => setAnalysisJobs(current => [
      ...current, ...jobs.filter(job => !current.some(item => item.proposalKey === job.proposalKey))
    ])).catch(err => {
      if (!controller.signal.aborted) setAppError(err instanceof Error ? err.message : 'Não foi possível carregar as análises.');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const running = analysisJobs.filter(job => !isTerminalAnalysis(job) && !analysisCancellingKeys.has(job.proposalKey));
    if (running.length === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const errors: string[] = [];
      const updates = await Promise.all(running.map(async job => {
        try {
          return await refreshAnalysis(job.jobId, controller.signal);
        } catch (err) {
          if (!controller.signal.aborted) errors.push(err instanceof Error ? err.message : 'Não foi possível acompanhar a análise.');
          return job;
        }
      }));
      if (!controller.signal.aborted) {
        setAnalysisError(errors[0] ?? null);
        setAnalysisJobs(current => current.map(job => updates.find(update => update.jobId === job.jobId) ?? job));
      }
    }, 2000);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [analysisJobs, analysisCancellingKeys]);

  const cancelProposalAnalysis = async (proposal: OportunidadeResultado) => {
    const key = getProposalKey(proposal);
    if (!key || analysisCancellingRef.current.has(key)) return;
    analysisCancellingRef.current.add(key);
    setAnalysisCancellingKeys(current => new Set(current).add(key));
    setAppError(null);
    setAnalysisError(null);
    try {
      await cancelAnalysis(key);
      setAnalysisJobs(current => current.filter(job => job.proposalKey !== key));
    } catch (err) {
      setAppError(err instanceof Error ? err.message : 'Não foi possível cancelar a análise.');
      try {
        const jobs = await fetchAnalyses();
        setAnalysisJobs(jobs);
      } catch (reloadError) {
        setAnalysisError(reloadError instanceof Error ? reloadError.message : 'Não foi possível recuperar o acompanhamento.');
      }
    } finally {
      analysisCancellingRef.current.delete(key);
      setAnalysisCancellingKeys(current => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const analyzeProposal = async (proposal: OportunidadeResultado) => {
    const key = getProposalKey(proposal);
    const params = getAnalysisParams(proposal);
    if (!key || !params) {
      setAppError('UASG ou número da compra indisponível para análise.');
      return;
    }
    if (analysisStartingRef.current.has(key) || analysisCancellingRef.current.has(key)) return;
    analysisStartingRef.current.add(key);
    setAnalysisStartingKeys(current => new Set(current).add(key));
    setAppError(null);
    setAnalysisError(null);
    try {
      const job = await startAnalysis({ ...proposal, ...params });
      if (!analysisCancellingRef.current.has(key)) {
        setAnalysisJobs(current => [job, ...current.filter(item => item.proposalKey !== key)]);
      }
    } catch (err) {
      if (!analysisCancellingRef.current.has(key)) setAppError(err instanceof Error ? err.message : 'Não foi possível iniciar a análise.');
    } finally {
      analysisStartingRef.current.delete(key);
      setAnalysisStartingKeys(current => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };
  useEffect(() => {
    localStorage.removeItem('comprasgov:favorites');
  }, []);
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);

  useEffect(() => {
    Promise.all(BRANDING_FIELDS.map(({ kind }) => fetchText(kind)))
      .then(([companyName, title, subtitle]) => setBranding({ companyName, title, subtitle }))
      .catch(err => setAppError(err instanceof Error ? err.message : 'Não foi possível carregar a identificação.'));
  }, []);
  const [summaryFilter, setSummaryFilter] = useState<SummaryFilter>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [popupError, setPopupError] = useState<{ title: string; message: string; sample: string | null } | null>(null);
  const [filters, setFilters] = useState<FetchFilters | null>(null);

  useEffect(() => {
    if (!filters?.ufs && !filters?.uasg && !filters?.numeroCompra) return;
    const activeFilters = filters;

    const controller = new AbortController();
    let cancelled = false;
    let progressInterval: ReturnType<typeof setInterval> | undefined;

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
        progressInterval = setInterval(() => {
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
        clearInterval(progressInterval);
        if (!cancelled) {
          setLoading(false);
          setLoadingStep('');
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      clearInterval(progressInterval);
      controller.abort();
    };
  }, [filters]);

  const handleFilterChange = (newFilters: FetchFilters) => {
    setSummaryFilter(null);
    setSettingsOpen(false);
    setShowDiscarded(false);
    setFilters(newFilters);
    window.scrollTo({ top: 0 });
  };

  const handleSummaryFilterChange = (filter: SummaryFilter) => {
    setSummaryFilter(current => current === filter ? null : filter);
  };

  // A ordem é definida a cada nova pesquisa; descartar um card não o move até a próxima.
  // Prioridade:
  // 1. Propostas não descartadas
  // 2. Registro de preço igual a "Não" (registroPreco !== true) antes de registro de preço igual a "Sim" (registroPreco === true)
  // Mantém resumos e a ordem original relativa de cada grupo.
  const discardedKeysRef = useRef<Set<string>>(new Set());
  const orderedResults = useMemo(() => {
    const isDiscarded = (item: PregaoResultado) =>
      item.tipoSaida === 'oportunidade' && discardedKeysRef.current.has(getProposalKey(item) ?? '');
    const isSrp = (item: PregaoResultado) =>
      item.tipoSaida === 'oportunidade' && item.registroPreco === true;

    const notDiscarded = resultados.filter(item => !isDiscarded(item));
    const discardedItems = resultados.filter(isDiscarded);

    const notDiscardedNonSrp = notDiscarded.filter(item => !isSrp(item));
    const notDiscardedSrp = notDiscarded.filter(isSrp);

    const discardedNonSrp = discardedItems.filter(item => !isSrp(item));
    const discardedSrp = discardedItems.filter(isSrp);

    return [...notDiscardedNonSrp, ...notDiscardedSrp, ...discardedNonSrp, ...discardedSrp];
  }, [resultados]);

  const discardedKeys = new Set(discarded.map(getProposalKey).filter((key): key is string => key !== null));

  discardedKeysRef.current = discardedKeys;

  useEffect(() => {
    const controller = new AbortController();
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const proposals = await fetchDiscarded(controller.signal);
        if (!controller.signal.aborted) setDiscarded(proposals);
      } catch (err) {
        if (!controller.signal.aborted) {
          setAppError(err instanceof Error ? err.message : 'Não foi possível carregar as propostas descartadas.');
        }
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60000);
    window.addEventListener('focus', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [showDiscarded]);

  useEffect(() => {
    fetchRegistered()
      .then(setRegistered)
      .catch(err => setAppError(err instanceof Error ? err.message : 'Não foi possível carregar as propostas agendadas.'));
  }, []);

  const toggleDiscard = async (result: OportunidadeResultado, confirmed = false) => {
    const key = getProposalKey(result);
    if (!key || proposalOperations.has(key)) return;

    const discarding = !discardedKeys.has(key);
    if (discarding && !confirmed && registered.some(item => getProposalKey(item) === key)) {
      setDiscardConfirmation(result);
      return;
    }
    setProposalOperations(current => new Set(current).add(key));
    setAppError(null);
    try {
      if (discarding) {
        await discardProposal(result);
        setRegistered(current => current.filter(item => getProposalKey(item) !== key));
      } else await restoreProposal(key);
      setDiscarded(await fetchDiscarded());
    } catch (err) {
      setAppError(err instanceof Error ? err.message : 'Não foi possível atualizar a proposta.');
    } finally {
      setProposalOperations(current => {
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
      setAppError(err instanceof Error ? err.message : 'Não foi possível encerrar a sessão.');
    }
  };

  const registeredKeys = useMemo(() => {
    return new Set(registered.map(getProposalKey).filter((k): k is string => k !== null));
  }, [registered]);

  const toggleRegisterProposal = async (proposal: OportunidadeResultado) => {
    const key = getProposalKey(proposal);
    if (!key) throw new Error('Não foi possível identificar a proposta para cadastro.');
    if (proposalOperations.has(key)) return;

    setProposalOperations(current => new Set(current).add(key));
    const isReg = registeredKeys.has(key);
    try {
      if (isReg) {
        await unregisterProposal(key);
        setRegistered(current => current.filter(item => getProposalKey(item) !== key));
      } else {
        await registerProposal(proposal);
        setRegistered(current => [proposal, ...current.filter(item => getProposalKey(item) !== key)]);
      }
    } finally {
      setProposalOperations(current => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  const handleToggleRegisterProposal = async (proposal: OportunidadeResultado) => {
    setAppError(null);
    try {
      await toggleRegisterProposal(proposal);
    } catch (err) {
      setAppError(err instanceof Error ? err.message : 'Não foi possível atualizar as propostas agendadas.');
    }
  };

  const baseResults = showDiscarded ? discarded : orderedResults;
  const summaryResults = showDiscarded
    ? baseResults
    : baseResults.filter(item => item.tipoSaida !== 'oportunidade' || !discardedKeys.has(getProposalKey(item) ?? ''));
  const visibleResults = baseResults.filter(result => matchesSummaryFilter(result, summaryFilter));

  return (
    <div className="app-layout">
      <FilterControls onFilterChange={handleFilterChange} loading={loading} />

      {discardConfirmation ? (
        <dialog
          ref={discardDialogRef}
          className="webhook-popup discard-confirmation"
          aria-labelledby="discard-confirmation-title"
          aria-describedby="discard-confirmation-message"
          onCancel={() => setDiscardConfirmation(null)}
        >
          <h2 id="discard-confirmation-title">Descartar proposta agendada?</h2>
          <p id="discard-confirmation-message">
            Esta proposta está agendada. Ao descartá-la, o agendamento também será removido. Deseja continuar?
          </p>
          <div className="card-discard-row">
            <button type="button" className="discard-toggle" autoFocus onClick={() => setDiscardConfirmation(null)}>
              Não
            </button>
            <button type="button" className="discard-toggle" onClick={() => {
              const proposal = discardConfirmation;
              setDiscardConfirmation(null);
              void toggleDiscard(proposal, true);
            }}>
              Sim
            </button>
          </div>
        </dialog>
      ) : null}

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
          isHome={!showCalendar && !showDiscarded && !settingsOpen}
          onGoHome={() => {
            setShowCalendar(false);
            setShowDiscarded(false);
            setSettingsOpen(false);
            setSummaryFilter(null);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          settingsOpen={settingsOpen}
          onToggleSettings={() => {
            setShowCalendar(false);
            setSettingsOpen(current => !current);
          }}
          onLogout={handleLogout}
          showLogout={authRequired}
        />

        {showCalendar && !settingsOpen ? (
          <CalendarPage
            proposals={registered}
            onUnregister={handleToggleRegisterProposal}
            isUnregistering={proposal => proposalOperations.has(getProposalKey(proposal) ?? '')}
            isDiscarded={proposal => discardedKeys.has(getProposalKey(proposal) ?? '')}
            onToggleDiscard={toggleDiscard}
            onAnalyze={analyzeProposal}
            onCancelAnalysis={cancelProposalAnalysis}
            isAnalysisStarting={proposal => analysisStartingKeys.has(getProposalKey(proposal) ?? '')}
            isAnalysisCancelling={proposal => analysisCancellingKeys.has(getProposalKey(proposal) ?? '')}
            getAnalysisJob={proposal => analysisJobs.find(job => job.proposalKey === getProposalKey(proposal))}
            onStatusUpdated={handleStatusUpdated}
            error={appError ?? analysisError}
            onBack={() => setShowCalendar(false)}
          />
        ) : settingsOpen ? (
          <SettingsPage
            branding={branding}
            onBrandingChange={setBranding}
            onBack={() => setSettingsOpen(false)}
          />
        ) : (
        <>

        {appError || analysisError ? (
          <div className="status-card status-error" role="alert">{appError ?? analysisError}</div>
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

        {!showDiscarded ? (
          <DashboardView
            results={resultados}
            registered={registered}
            discarded={discarded}
            activeFilter={summaryFilter}
            onSelectFilter={filter => {
              handleSummaryFilterChange(filter);
            }}
            onOpenCalendar={() => {
              setSettingsOpen(false);
              setShowDiscarded(false);
              setShowCalendar(true);
            }}
            onOpenDiscarded={() => {
              setSettingsOpen(false);
              setShowCalendar(false);
              setShowDiscarded(true);
            }}
            getProposalKey={getProposalKey}
          />
        ) : null}

        {showDiscarded ? (
          <section className="dashboard-root discarded-view" aria-labelledby="discarded-title">
            <div className="dashboard-header">
              <div>
                <h2 className="dashboard-title" id="discarded-title">Propostas descartadas</h2>
                <p className="dashboard-subtitle">
                  {discarded.length} proposta{discarded.length === 1 ? '' : 's'} salva{discarded.length === 1 ? '' : 's'} como descartada{discarded.length === 1 ? '' : 's'}.
                </p>
              </div>
            </div>
            <Summary
              results={summaryResults}
              discardedView={showDiscarded}
              activeFilter={summaryFilter}
              onSelectFilter={handleSummaryFilterChange}
            />
          </section>
        ) : null}

        {baseResults.length > 0 ? (
          <>
            {visibleResults.length > 0 ? (
              <section className="cards-shell">
                {visibleResults.map((item, index) => (
                  <ResultCard
                    key={item.tipoSaida === 'oportunidade'
                      ? getProposalKey(item) ?? `${item.local ?? 'unknown'}-${index}`
                      : `resumo-${index}`}
                    result={item.tipoSaida === 'oportunidade'
                      ? { ...item, situacao: proposalStatuses.get(getProposalKey(item) ?? '') ?? item.situacao }
                      : item}
                    onStatusUpdated={handleStatusUpdated}
                    isRegistered={item.tipoSaida === 'oportunidade'
                      && registeredKeys.has(getProposalKey(item) ?? '')}
                    isRegistering={item.tipoSaida === 'oportunidade'
                      && proposalOperations.has(getProposalKey(item) ?? '')}
                    onToggleRegister={item.tipoSaida === 'oportunidade' ? handleToggleRegisterProposal : undefined}
                    onOpenCalendar={() => {
                      setSettingsOpen(false);
                      setShowDiscarded(false);
                      setShowCalendar(true);
                    }}
                    isDiscarded={item.tipoSaida === 'oportunidade'
                      && discardedKeys.has(getProposalKey(item) ?? '')}
                    onToggleDiscard={toggleDiscard}
                    onAnalyze={analyzeProposal}
                    onCancelAnalysis={cancelProposalAnalysis}
                    analysisCancelling={item.tipoSaida === 'oportunidade' && analysisCancellingKeys.has(getProposalKey(item) ?? '')}
                    analysisStarting={item.tipoSaida === 'oportunidade' && analysisStartingKeys.has(getProposalKey(item) ?? '')}
                    analysisJob={item.tipoSaida === 'oportunidade'
                      ? analysisJobs.find(job => job.proposalKey === getProposalKey(item))
                      : undefined}
                  />
                ))}
              </section>
            ) : (
              <div className="status-card">Nenhum registro corresponde a este filtro.</div>
            )}
          </>
        ) : !loading && !error ? (
          <div className="status-card">
            {showDiscarded ? 'Nenhuma proposta descartada.' : 'Nenhum resultado carregado ainda. Selecione os filtros na barra lateral e clique em Pesquisar.'}
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
  const [authRequired, setAuthRequired] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/auth/session')
      .then(async response => {
        if (!response.ok) throw new Error('Não foi possível verificar sua sessão.');
        return response.json() as Promise<{ authenticated: boolean; authRequired?: boolean }>;
      })
      .then(({ authenticated, authRequired: required }) => {
        setAuthRequired(required !== false);
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

  return <MainApp authRequired={authRequired} onLogout={() => setAuthState('unauthenticated')} />;
}

export default App;
