import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, ArrowDownLeft, ArrowRight, BedDouble, Building2, Check, ChevronDown,
  CircleHelp, ClipboardList, Clock3, Download, FileSpreadsheet, LayoutDashboard, Menu, Plus,
  Search, ShieldCheck, Siren, Users, Wrench, X,
} from 'lucide-react';
import { BED_STATUS, BED_TYPE, type AppState, type Bed, type BedStatus, type BedType, type Origin } from '../domain/types';
import { countByStatus, patientForAdmission } from '../domain/logic';
import { selectActiveAdmissions, selectBeds, selectCounts, selectMovements } from '../domain/selectors';
import { downloadCsv } from '../domain/csv';
import { createId, useLeitoStore } from '../store/useLeitoStore';

type Page = 'painel' | 'leitos' | 'entrada' | 'fila' | 'saida' | 'pacientes' | 'manutencao' | 'movimentacoes' | 'relatorios' | 'samu';
type WaitlistItem = {
  id: string; patientId: string | null; patientName: string; birthDate: string; contact: string;
  hospitalId: string; type: BedType; origin: Origin; reason: string; procedureCode: string; createdAt: string;
};
type Modal =
  | { kind: 'entry'; bedId?: string; queueId?: string }
  | { kind: 'exit'; admissionId: string }
  | { kind: 'maintenance'; bedId?: string }
  | { kind: 'finish-maintenance'; bedId: string }
  | { kind: 'clean'; bedId: string }
  | { kind: 'reserve'; bedId: string }
  | { kind: 'cancel-reservation'; bedId: string }
  | { kind: 'unblock'; bedId: string };

const NAV: { id: Page; label: string; icon: ReactNode }[] = [
  { id: 'painel', label: 'Painel geral', icon: <LayoutDashboard size={18} /> },
  { id: 'leitos', label: 'Mapa de leitos', icon: <BedDouble size={18} /> },
  { id: 'entrada', label: 'Entrada de paciente', icon: <ArrowDownLeft size={18} /> },
  { id: 'fila', label: 'Fila de espera', icon: <Clock3 size={18} /> },
  { id: 'saida', label: 'Saída de paciente', icon: <ArrowRight size={18} /> },
  { id: 'pacientes', label: 'Pacientes', icon: <Users size={18} /> },
  { id: 'manutencao', label: 'Higienização e manutenção', icon: <Wrench size={18} /> },
  { id: 'movimentacoes', label: 'Movimentações', icon: <Activity size={18} /> },
  { id: 'relatorios', label: 'Planilha e relatórios', icon: <FileSpreadsheet size={18} /> },
];

const PAGE_TITLE: Record<Page, string> = {
  painel: 'Painel de leitos', leitos: 'Mapa de leitos', entrada: 'Registrar entrada', fila: 'Fila de espera',
  saida: 'Registrar saída', pacientes: 'Pacientes', manutencao: 'Higienização e manutenção',
  movimentacoes: 'Movimentações recentes', relatorios: 'Planilha de leitos', samu: 'Consulta SAMU',
};

const fmt = (value: string | Date, options: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Belem', ...options }).format(new Date(value));
const stayDuration = (startedAt: string) => {
  const totalMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days} ${days === 1 ? 'dia' : 'dias'}${hours ? ` e ${hours} h` : ''}`;
  if (hours) return `${hours} h${minutes ? ` e ${minutes} min` : ''}`;
  return `${minutes || 1} min`;
};
const localDateTimeValue = (offsetMinutes: number) => {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const statusText = (status: BedStatus) => BED_STATUS[status].label;
const WAITLIST_KEY = 'senso-de-leitos:fila:v1';
function loadWaitlist(): WaitlistItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(WAITLIST_KEY) || '[]');
    return Array.isArray(value) ? value as WaitlistItem[] : [];
  } catch { return []; }
}

export function App() {
  const [, setClockTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const app = useLeitoStore((s) => s.app);
  const storageError = useLeitoStore((s) => s.storageError);
  const admit = useLeitoStore((s) => s.admit);
  const discharge = useLeitoStore((s) => s.discharge);
  const reserve = useLeitoStore((s) => s.reserve);
  const cancelReservation = useLeitoStore((s) => s.cancelReservation);
  const completeCleaning = useLeitoStore((s) => s.completeCleaning);
  const startMaintenance = useLeitoStore((s) => s.startMaintenance);
  const finishMaintenance = useLeitoStore((s) => s.finishMaintenance);
  const unblock = useLeitoStore((s) => s.unblock);
  const confirmMap = useLeitoStore((s) => s.confirmMap);
  const reset = useLeitoStore((s) => s.reset);
  const [page, setPage] = useState<Page>('painel');
  const [hospitalId, setHospitalId] = useState(() => localStorage.getItem('leito-vivo:hospital') || 'all');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<BedStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<BedType | ''>('');
  const [modal, setModal] = useState<Modal | null>(null);
  const [toast, setToast] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [waitlist, setWaitlist] = useState<WaitlistItem[]>(loadWaitlist);
  useEffect(() => {
    try { localStorage.setItem(WAITLIST_KEY, JSON.stringify(waitlist)); } catch { /* Demo storage is best effort. */ }
  }, [waitlist]);

  const filteredBeds = useMemo(() => selectBeds(app, {
    hospitalId: hospitalId === 'all' ? undefined : hospitalId,
    status: statusFilter,
    type: typeFilter,
    query,
  }), [app, hospitalId, statusFilter, typeFilter, query]);
  const bedCounts = countByStatus(selectBeds(app, { hospitalId: hospitalId === 'all' ? undefined : hospitalId }));
  const totals = selectCounts(app, { hospitalId: hospitalId === 'all' ? undefined : hospitalId });
  const admissions = selectActiveAdmissions(app, query, hospitalId === 'all' ? undefined : hospitalId);
  const patientList = app.patients.filter((p) => !query || normalize([p.displayName, p.socialName || '', p.localRecord].join(' ')).includes(normalize(query)));
  const movements = selectMovements(app, { hospitalId: hospitalId === 'all' ? undefined : hospitalId, query }).slice(0, 70);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? '' : current), 4200);
  }
  function go(next: Page) {
    setPage(next);
    setQuery('');
    setStatusFilter('');
    setTypeFilter('');
    setMenuOpen(false);
  }
  function chooseHospital(value: string) {
    setHospitalId(value);
    localStorage.setItem('leito-vivo:hospital', value);
  }
  async function act(result: Promise<{ ok: boolean; message: string }>) {
    const response = await result;
    if (response.ok) setModal(null);
    notify(response.message);
    return response;
  }
  async function submitModal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!modal) return;
    const data = new FormData(event.currentTarget);
    const get = (key: string) => String(data.get(key) ?? '').trim();
    if (modal.kind === 'entry') {
      const submitter = (event.nativeEvent as SubmitEvent).submitter;
      const intent = submitter instanceof HTMLButtonElement ? submitter.value : '';
      const patientId = get('patientId');
      const savedPatient = app.patients.find((item) => item.id === patientId);
      const patientName = get('patientName') || savedPatient?.displayName || '';
      if (intent === 'queue') {
        const item: WaitlistItem = {
          id: createId('FILA'), patientId: patientId || null, patientName,
          birthDate: get('birthDate'), contact: get('contact'), hospitalId: get('hospitalId'),
          type: get('bedType') as BedType, origin: get('origin') as Origin, reason: get('reason'),
          procedureCode: get('procedureCode'), createdAt: new Date().toISOString(),
        };
        setWaitlist((current) => [...current, item]);
        setModal(null);
        notify('Paciente incluído na fila de espera.');
        return;
      }
      const response = await act(admit({
        patientId: patientId || undefined,
        patient: patientId ? undefined : {
          displayName: patientName,
          socialName: null,
          birthDate: get('birthDate') || null,
          unidentified: false,
          documentType: null,
          documentValue: null,
          address: null,
          contact: get('contact') || null,
          guardian: null,
        },
        hospitalId: get('hospitalId'),
        bedId: get('bedId'),
        type: get('bedType') as BedType,
        origin: get('origin') as Origin,
        reason: get('reason'),
        procedureCode: get('procedureCode') || undefined,
      }));
      if (response.ok && modal.queueId) setWaitlist((current) => current.filter((item) => item.id !== modal.queueId));
    } else if (modal.kind === 'exit') {
      await act(discharge({
        admissionId: modal.admissionId,
        dischargeType: get('dischargeType') as 'discharge' | 'external_transfer' | 'evasion' | 'death' | 'other',
        destination: get('destination') || undefined,
        note: get('note') || undefined,
      }));
    } else if (modal.kind === 'maintenance') {
      await act(startMaintenance(modal.bedId || get('bedId'), get('reason'), get('responsible')));
    } else if (modal.kind === 'finish-maintenance') {
      await act(finishMaintenance(modal.bedId, get('note')));
    } else if (modal.kind === 'clean') {
      await act(completeCleaning(modal.bedId, get('responsible')));
    } else if (modal.kind === 'reserve') {
      await act(reserve(modal.bedId, get('responsible'), new Date(get('expectedAt')).toISOString(), get('protocol') || undefined));
    } else if (modal.kind === 'cancel-reservation') {
      await act(cancelReservation(modal.bedId, get('reason')));
    } else if (modal.kind === 'unblock') {
      await act(unblock(modal.bedId, get('reason')));
    }
  }

  function confirmRestore() {
    if (window.confirm('Restaurar os dados de exemplo? As alterações salvas neste navegador serão substituídas.')) {
      void act(reset());
    }
  }

  return <div className="app-shell">
    <aside className={'sidebar' + (menuOpen ? ' sidebar-open' : '')}>
      <div className="brand"><div className="brand-icon"><BedDouble size={21} /></div><div className="brand-name">SENSO DE <span>LEITOS</span><small>GESTÃO HOSPITALAR</small></div></div>
      <div className="side-caption">OPERAÇÃO HOSPITALAR</div>
      <nav className="side-nav" aria-label="Navegação principal">
        {NAV.map((item) => <button key={item.id} className={'nav-item' + (page === item.id ? ' selected' : '')} onClick={() => go(item.id)}>{item.icon}<span>{item.label}</span>{item.id === 'manutencao' && <em>{app.maintenances.filter((m) => m.status === 'open').length}</em>}{item.id === 'fila' && waitlist.length > 0 && <em>{waitlist.length}</em>}</button>)}
      </nav>
      <div className="side-spacer" />
      <button className={'nav-item samu-link' + (page === 'samu' ? ' selected' : '')} onClick={() => go('samu')}><Siren size={18} /><span>Consulta SAMU<small>Visão sem dados pessoais</small></span><ArrowRight size={15} /></button>
      <div className="side-note"><ShieldCheck size={17} /><span><strong>Protótipo de demonstração</strong><small>Dados fictícios neste navegador</small></span></div>
      <button className="restore-link" onClick={confirmRestore}>Restaurar dados de exemplo</button>
    </aside>
    {menuOpen && <button className="scrim" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    <main className="main-area">
      <header className="topbar">
        <button className="mobile-menu" aria-label="Abrir menu" onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button>
        <div className="hospital-select"><Building2 size={17} /><select aria-label="Filtrar por hospital" value={hospitalId} onChange={(e) => chooseHospital(e.target.value)}><option value="all">Todos os hospitais</option>{app.hospitals.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select><ChevronDown size={14} /></div>
        <div className="top-actions"><span className="saved"><i /> Salvo neste navegador</span><button className="btn btn-primary" onClick={() => setModal({ kind: 'entry' })}><Plus size={17} /> Nova entrada</button><button className="btn btn-light" onClick={() => go('saida')}>Registrar saída</button></div>
      </header>
      <section className="content">
        <div className="heading-row"><div><div className="eyebrow">REDE DE HOSPITAIS <span className="eyebrow-dot" /> DEMONSTRAÇÃO</div><h1>{PAGE_TITLE[page]}</h1><p className="subheading">{page === 'samu' ? 'Consulta rápida de disponibilidade por hospital e tipo de leito.' : page === 'fila' ? 'Acompanhe a espera por categoria e conclua a entrada quando surgir uma vaga.' : 'Acompanhe a disponibilidade e registre as movimentações do dia.'}</p></div>
          {page !== 'samu' && <div className="header-stamp"><span className="stamp-dot" /> Atualizado {fmt(app.updatedAt, { hour: '2-digit', minute: '2-digit' })}<small>Horário local de Belém</small></div>}
        </div>
        {storageError && <div className="notice notice-warning"><strong>Não foi possível ler uma versão salva.</strong> A demonstração está usando os dados iniciais. {storageError}</div>}
        <div className="notice notice-demo"><span className="notice-icon"><CircleHelp size={17} /></span><span><strong>Ambiente demonstrativo.</strong> Informações e capacidades são fictícias; não use para encaminhamento real de pacientes.</span></div>
        {page === 'painel' && <Dashboard app={app} hospitalId={hospitalId} counts={bedCounts} totals={totals} onConfirm={async (id) => notify((await confirmMap(id)).message)} onOpen={(status) => { setStatusFilter(status); go('leitos'); setStatusFilter(status); }} onNavigate={go} />}
        {page === 'leitos' && <BedsView app={app} beds={filteredBeds} query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter} typeFilter={typeFilter} setTypeFilter={setTypeFilter} onAction={(next) => setModal(next)} hospitalId={hospitalId} />}
        {page === 'entrada' && <EntryIntro onStart={() => setModal({ kind: 'entry' })} app={app} hospitalId={hospitalId} />}
        {page === 'fila' && <WaitlistView app={app} items={waitlist} onRegister={(item, bedId) => setModal({ kind: 'entry', queueId: item.id, bedId })} onRemove={(id) => setWaitlist((current) => current.filter((item) => item.id !== id))} />}
        {page === 'saida' && <ExitView app={app} admissions={admissions} query={query} setQuery={setQuery} onSelect={(id) => setModal({ kind: 'exit', admissionId: id })} />}
        {page === 'pacientes' && <PatientsView patients={patientList} app={app} query={query} setQuery={setQuery} />}
        {page === 'manutencao' && <MaintenanceView app={app} hospitalId={hospitalId} onAction={(next) => setModal(next)} />}
        {page === 'movimentacoes' && <MovementsView app={app} movements={movements} />}
        {page === 'relatorios' && <ReportView app={app} beds={filteredBeds} hospitalId={hospitalId} />}
        {page === 'samu' && <SamuView app={app} onConfirm={async (id) => notify((await confirmMap(id)).message)} />}
      </section>
      <footer className="page-footer"><span>SENSO DE LEITOS <b>·</b> Protótipo estático para apresentação</span><span>As alterações ficam salvas apenas neste navegador</span></footer>
    </main>
    {modal && <ModalView modal={modal} app={app} queueItem={modal.kind === 'entry' && modal.queueId ? waitlist.find((item) => item.id === modal.queueId) : undefined} onClose={() => setModal(null)} onSubmit={submitModal} />}
    {toast && <div role="status" className="toast"><Check size={17} />{toast}<button onClick={() => setToast('')} aria-label="Fechar"><X size={15} /></button></div>}
  </div>;
}

function Dashboard({ app, hospitalId, counts, totals, onConfirm, onOpen, onNavigate }: {
  app: AppState; hospitalId: string; counts: ReturnType<typeof countByStatus>; totals: ReturnType<typeof selectCounts>;
  onConfirm: (id: string) => void; onOpen: (status: BedStatus) => void; onNavigate: (page: Page) => void;
}) {
  const hospitals = app.hospitals.filter((h) => hospitalId === 'all' || h.id === hospitalId);
  const recent = selectMovements(app, { hospitalId: hospitalId === 'all' ? undefined : hospitalId }).slice(0, 5);
  const beds = new Map(app.beds.map((b) => [b.id, b]));
  return <>
    <div className="metric-grid">
      <Metric label="Leitos totais" value={totals.total} icon={<BedDouble size={18} />} tint="blue" hint="Na seleção atual" onClick={() => onNavigate('leitos')} />
      <Metric label="Disponíveis agora" value={counts.available} icon={<Check size={18} />} tint="green" hint="Prontos para entrada" onClick={() => onOpen('available')} />
      <Metric label="Ocupados" value={counts.occupied} icon={<Users size={18} />} tint="purple" hint="Com paciente internado" onClick={() => onOpen('occupied')} />
      <Metric label="Indisponíveis" value={counts.maintenance + counts.cleaning + counts.blocked} icon={<Wrench size={18} />} tint="amber" hint="Manutenção, limpeza ou bloqueio" onClick={() => onNavigate('leitos')} />
    </div>
    <div className="section-head"><div><h2>Hospitais da rede</h2><p>Disponibilidade e situação registrada por unidade</p></div><button className="link-button" onClick={() => onNavigate('leitos')}>Ver mapa completo <ArrowRight size={15} /></button></div>
    <div className="hospital-grid">
      {hospitals.map((hospital) => {
        const hospitalBeds = app.beds.filter((b) => b.hospitalId === hospital.id);
        const c = countByStatus(hospitalBeds);
        const confirmed = Date.now() - Date.parse(hospital.lastVerifiedAt) < 15 * 60_000;
        const occupiedPercent = Math.round(c.occupied / Math.max(1, hospitalBeds.length) * 100);
        return <article className="hospital-card" key={hospital.id}>
          <div className="hospital-card-top"><div className="hospital-symbol"><Building2 size={18} /></div><div className="hospital-info"><h3>{hospital.name}</h3><span>{hospital.city} · {hospital.state}</span></div><span className={'freshness' + (confirmed ? '' : ' stale')}><i />{confirmed ? 'Conferido' : 'Atualização pendente'}</span></div>
          <div className="hospital-total"><strong>{c.available}</strong><span>disponíveis de {hospitalBeds.length} leitos</span><span className="hospital-occupancy">{occupiedPercent}% ocupação</span></div>
          <div className="occupancy-track"><span style={{ width: occupiedPercent + '%' }} /></div>
          <div className="hospital-status-row"><StatusCount status="occupied" count={c.occupied} /><StatusCount status="reserved" count={c.reserved} /><StatusCount status="cleaning" count={c.cleaning} /><StatusCount status="maintenance" count={c.maintenance} /></div>
          <div className="hospital-bedmap">
            <div className="mini-map-heading"><strong>Mapa visual</strong><span>{hospitalBeds.length} leitos</span></div>
            <BedTileMap app={app} beds={hospitalBeds} hospitalName={hospital.name} onSelect={onOpen} />
          </div>
          <div className="hospital-card-foot"><span>Conferido {fmt(hospital.lastVerifiedAt, { hour: '2-digit', minute: '2-digit' })}</span><button className="text-action" onClick={() => onConfirm(hospital.id)}><Check size={14} /> Confirmar mapa</button></div>
        </article>;
      })}
    </div>
    <BedStatusLegend />
    <div className="lower-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Resumo da situação</h2><p>Contagem dos leitos na seleção atual</p></div><button className="icon-plain" onClick={() => onNavigate('leitos')} aria-label="Abrir mapa"><ArrowRight size={17} /></button></div>
        <div className="status-summary">
          {(['available', 'occupied', 'reserved', 'cleaning', 'maintenance', 'blocked'] as BedStatus[]).map((s) => <button className="summary-row" key={s} onClick={() => onOpen(s)}><span className={'status-dot ' + s} /><span>{BED_STATUS[s].noun}</span><strong>{counts[s]}</strong><span className="summary-bar"><i className={'bar-' + s} style={{ width: (totals.total ? Math.max(4, counts[s] / totals.total * 100) : 0) + '%' }} /></span></button>)}
        </div>
      </section>
      <section className="panel"><div className="panel-heading"><div><h2>Últimas movimentações</h2><p>Registros mais recentes do sistema</p></div><button className="link-button" onClick={() => onNavigate('movimentacoes')}>Ver todas <ArrowRight size={15} /></button></div>
        {recent.length ? <div className="activity-list">{recent.map((event) => <div className="activity-item" key={event.id}><span className="activity-icon"><Activity size={15} /></span><div><strong>{movementLabel(event.type)}</strong><small>{beds.get(event.bedId || '')?.code || hospitalName(app, event.hospitalId)} · {event.reason || 'Atualização de leito'}</small></div><time>{fmt(event.happenedAt, { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div> : <Empty text="Nenhuma movimentação encontrada." />}</section>
    </div>
    <p className="privacy-note"><ShieldCheck size={15} /> O painel geral não exibe nomes de pacientes. Os dados pessoais aparecem somente nas telas operacionais.</p>
  </>;
}

function Metric({ label, value, icon, tint, hint, onClick }: { label: string; value: number; icon: ReactNode; tint: string; hint: string; onClick: () => void }) {
  return <button className="metric-card" onClick={onClick}><span className={'metric-icon ' + tint}>{icon}</span><span className="metric-label">{label}</span><strong>{value}</strong><small>{hint}</small></button>;
}
function StatusCount({ status, count }: { status: BedStatus; count: number }) { return <span className="status-count"><i className={'status-dot ' + status} />{count} {BED_STATUS[status].label.toLowerCase()}</span>; }

function BedTileMap({ app, beds, hospitalName, onSelect }: {
  app: AppState; beds: Bed[]; hospitalName: string; onSelect?: (status: BedStatus) => void;
}) {
  const counts = countByStatus(beds);
  const summary = (['available', 'occupied', 'reserved', 'cleaning', 'maintenance', 'blocked'] as BedStatus[])
    .map((status) => `${counts[status]} ${BED_STATUS[status].noun.toLowerCase()}`).join(', ');
  return <div className="mini-bed-grid" role={onSelect ? 'group' : 'img'} aria-label={`Mapa visual de ${hospitalName}: ${summary}`}>
    {beds.map((bed) => {
      const block = app.blocks.find((item) => item.id === bed.blockId);
      const description = `${bed.code} · ${block?.name || 'Bloco'} · ${BED_STATUS[bed.status].label} · ${BED_TYPE[bed.type]}`;
      return onSelect
        ? <button key={bed.id} type="button" className={'mini-bed mini-bed-interactive mini-bed-' + bed.status} title={description} aria-label={`${description}. Abrir mapa filtrado por este status.`} onClick={() => onSelect(bed.status)} />
        : <span key={bed.id} className={'mini-bed mini-bed-' + bed.status} title={description} aria-hidden="true" />;
    })}
  </div>;
}

function BedStatusLegend() {
  return <div className="bed-legend" aria-label="Legenda dos status do mapa visual">
    {(['available', 'occupied', 'reserved', 'cleaning', 'maintenance', 'blocked'] as BedStatus[]).map((status) => <span key={status}><i className={'mini-bed-swatch mini-bed-' + status} />{BED_STATUS[status].label}{status === 'available' ? ' (sem pintura)' : ''}</span>)}
  </div>;
}

function BedsView({ app, beds, query, setQuery, statusFilter, setStatusFilter, typeFilter, setTypeFilter, onAction, hospitalId }: {
  app: AppState; beds: Bed[]; query: string; setQuery: (value: string) => void; statusFilter: BedStatus | '';
  setStatusFilter: (value: BedStatus | '') => void; typeFilter: BedType | ''; setTypeFilter: (value: BedType | '') => void;
  onAction: (modal: Modal) => void; hospitalId: string;
}) {
  const [blockFilter, setBlockFilter] = useState('');
  const patientMap = new Map(app.patients.map((p) => [p.id, p]));
  const activeAdmissions = new Map(app.admissions.filter((a) => a.status === 'active').map((a) => [a.id, a]));
  const visible = beds.filter((bed) => !blockFilter || bed.blockId === blockFilter);
  const blocks = app.blocks.filter((block) => hospitalId === 'all' || block.hospitalId === hospitalId);
  return <section className="panel">
    <div className="panel-heading"><div><h2>Leitos cadastrados</h2><p>{visible.length} leitos encontrados · Selecione um status ou tipo para filtrar</p></div><button className="btn btn-primary" onClick={() => onAction({ kind: 'entry' })}><Plus size={16} /> Nova entrada</button></div>
    <div className="filters"><label className="search-box"><Search size={17} /><input aria-label="Buscar leito, paciente ou registro" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar leito, paciente ou registro..." /></label>
      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as BedStatus | '')}><option value="">Todos os status</option>{Object.entries(BED_STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select>
      <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as BedType | '')}><option value="">Todos os tipos</option>{Object.entries(BED_TYPE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)}><option value="">Todos os blocos</option>{blocks.map((block) => <option key={block.id} value={block.id}>{hospitalName(app, block.hospitalId)} · {block.name}</option>)}</select>
    </div>
    {visible.length ? <div className="bed-grid">{visible.map((bed) => {
      const block = app.blocks.find((item) => item.id === bed.blockId);
      const admission = bed.currentAdmissionId ? activeAdmissions.get(bed.currentAdmissionId) : undefined;
      const patient = admission ? patientMap.get(admission.patientId) : undefined;
      return <article className={'bed-card bed-' + bed.status} key={bed.id}>
        <div className="bed-card-top"><span className="bed-number"><BedDouble size={17} />{bed.code}</span><span className={'status-pill ' + bed.status}>{statusText(bed.status)}</span></div>
        <div className="bed-card-detail"><span>{hospitalName(app, bed.hospitalId)}</span><b>{block?.name || 'Bloco'}</b><span>{BED_TYPE[bed.type]}</span></div>
        {patient ? <div className="bed-patient"><span className="patient-avatar">{patient.displayName.slice(0, 1)}</span><span><strong>{patient.displayName}</strong><small>Registro {patient.localRecord}</small>{admission && <small className="bed-stay">No leito há {stayDuration(admission.admittedAt)}</small>}</span></div> : <div className="bed-patient bed-empty"><span className="patient-avatar"><BedDouble size={15} /></span><span><strong>{bed.status === 'available' ? 'Pronto para entrada' : bed.status === 'maintenance' ? 'Leito em manutenção' : statusText(bed.status)}</strong><small>{bed.status === 'reserved' ? 'Consulte a reserva' : 'Sem paciente vinculado'}</small></span></div>}
        <div className="bed-card-actions">{bed.status === 'available' && <><button className="mini-primary" onClick={() => onAction({ kind: 'entry', bedId: bed.id })}>Registrar entrada</button><button className="mini-icon" title="Colocar em manutenção" onClick={() => onAction({ kind: 'maintenance', bedId: bed.id })}><Wrench size={15} /></button><button className="mini-icon" title="Reservar leito" onClick={() => onAction({ kind: 'reserve', bedId: bed.id })}><ClipboardList size={15} /></button></>}
          {bed.status === 'occupied' && admission && <button className="mini-primary mini-exit" onClick={() => onAction({ kind: 'exit', admissionId: admission.id })}>Registrar saída</button>}
          {bed.status === 'cleaning' && <button className="mini-primary" onClick={() => onAction({ kind: 'clean', bedId: bed.id })}>Concluir higienização</button>}
          {bed.status === 'maintenance' && <button className="mini-primary" onClick={() => onAction({ kind: 'finish-maintenance', bedId: bed.id })}>Concluir manutenção</button>}
          {bed.status === 'reserved' && <button className="mini-primary mini-quiet" onClick={() => onAction({ kind: 'cancel-reservation', bedId: bed.id })}>Cancelar reserva</button>}
          {bed.status === 'blocked' && <button className="mini-primary mini-quiet" onClick={() => onAction({ kind: 'unblock', bedId: bed.id })}>Retirar bloqueio</button>}</div>
      </article>;
    })}</div> : <Empty text="Nenhum leito corresponde a esses filtros." />}
  </section>;
}

function EntryIntro({ app, hospitalId, onStart }: { app: AppState; hospitalId: string; onStart: () => void }) {
  const available = app.beds.filter((b) => b.status === 'available' && (hospitalId === 'all' || b.hospitalId === hospitalId)).length;
  return <div className="flow-grid"><section className="flow-card"><span className="flow-step">01 · NOVA INTERNAÇÃO</span><h2>Registre a entrada do paciente</h2><p>Selecione um cadastro existente ou informe os dados básicos. Depois, associe o motivo da internação ao hospital e ao leito disponível.</p><div className="flow-facts"><span><Check size={16} /> {available} leitos disponíveis na seleção atual</span><span><ShieldCheck size={16} /> Dados de demonstração salvos apenas aqui</span></div><button className="btn btn-primary" onClick={onStart}><Plus size={17} /> Iniciar entrada</button></section><section className="flow-side"><h3>O que será registrado</h3><div className="check-line"><b>1</b><span><strong>Paciente</strong><small>Nome, endereço e contato</small></span></div><div className="check-line"><b>2</b><span><strong>Internação</strong><small>Origem, motivo e procedimento</small></span></div><div className="check-line"><b>3</b><span><strong>Leito</strong><small>Hospital, bloco e tipo de leito</small></span></div></section></div>;
}

function ExitView({ app, admissions, query, setQuery, onSelect }: { app: AppState; admissions: ReturnType<typeof selectActiveAdmissions>; query: string; setQuery: (value: string) => void; onSelect: (id: string) => void }) {
  return <section className="panel"><div className="panel-heading"><div><h2>Internações ativas</h2><p>Pesquise por nome, registro, hospital ou leito para localizar a saída.</p></div><span className="count-badge">{admissions.length} ativos</span></div>
    <label className="search-box search-wide"><Search size={17} /><input aria-label="Buscar internação" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome, documento, telefone, endereço, procedimento, leito ou hospital..." /></label>
    {admissions.length ? <div className="table-wrap"><table><thead><tr><th>Paciente</th><th>Registro</th><th>Hospital e leito</th><th>Entrada</th><th>Tempo no leito</th><th>Motivo</th><th></th></tr></thead><tbody>{admissions.map((a) => {
      const patient = patientForAdmission(app, a); const bed = app.beds.find((b) => b.id === a.currentBedId);
      return <tr key={a.id}><td><strong>{patient?.displayName || 'Paciente'}</strong><small className="cell-sub">{patient?.contact || 'Cadastro demonstrativo'}</small></td><td>{patient?.localRecord}</td><td>{hospitalName(app, a.hospitalId)}<small className="cell-sub">{bed?.code} · {bed ? BED_TYPE[bed.type] : ''}</small></td><td>{fmt(a.admittedAt, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td><strong>{stayDuration(a.admittedAt)}</strong></td><td>{a.reason}</td><td><button className="btn btn-outline btn-small" onClick={() => onSelect(a.id)}>Registrar saída</button></td></tr>;
    })}</tbody></table></div> : <Empty text={query ? 'Nenhuma internação encontrada para esta busca.' : 'Não há internações ativas na seleção atual.'} />}
  </section>;
}

function PatientsView({ patients, app, query, setQuery }: { patients: AppState['patients']; app: AppState; query: string; setQuery: (value: string) => void }) {
  return <section className="panel"><div className="panel-heading"><div><h2>Cadastros de demonstração</h2><p>Dados sintéticos para simular a busca e o registro de entradas.</p></div><span className="count-badge">{patients.length} pacientes</span></div>
    <label className="search-box search-wide"><Search size={17} /><input aria-label="Buscar paciente" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome ou registro local..." /></label>
    <div className="table-wrap"><table><thead><tr><th>Paciente</th><th>Registro local</th><th>Contato</th><th>Situação</th><th>Hospital</th></tr></thead><tbody>{patients.slice(0, 100).map((p) => {
      const admission = app.admissions.find((a) => a.patientId === p.id && a.status === 'active');
      return <tr key={p.id}><td><strong>{p.displayName}</strong><small className="cell-sub">{p.birthDate ? fmt(p.birthDate, { dateStyle: 'short' }) : 'Data não informada'}</small></td><td>{p.localRecord}</td><td>{p.contact || '—'}</td><td><span className={'status-pill ' + (admission ? 'occupied' : 'available')}>{admission ? 'Internado' : 'Sem internação ativa'}</span></td><td>{admission ? hospitalName(app, admission.hospitalId) : '—'}</td></tr>;
    })}</tbody></table></div><p className="table-footnote">A lista exibe até 100 registros por vez. Todos os nomes e dados desta amostra são fictícios.</p>
  </section>;
}

function MaintenanceView({ app, hospitalId, onAction }: { app: AppState; hospitalId: string; onAction: (modal: Modal) => void }) {
  const beds = app.beds.filter((b) => (hospitalId === 'all' || b.hospitalId === hospitalId) && ['maintenance', 'cleaning', 'available'].includes(b.status));
  const active = beds.filter((b) => b.status === 'maintenance' || b.status === 'cleaning');
  return <><div className="metric-grid mini-metrics"><Metric label="Em manutenção" value={beds.filter((b) => b.status === 'maintenance').length} icon={<Wrench size={18} />} tint="amber" hint="Não entram na disponibilidade" onClick={() => undefined} /><Metric label="Em higienização" value={beds.filter((b) => b.status === 'cleaning').length} icon={<Activity size={18} />} tint="blue" hint="Aguardando liberação" onClick={() => undefined} /><Metric label="Leitos disponíveis" value={beds.filter((b) => b.status === 'available').length} icon={<Check size={18} />} tint="green" hint="Podem receber entradas" onClick={() => undefined} /><Metric label="Tarefas abertas" value={active.length} icon={<ClipboardList size={18} />} tint="purple" hint="Manutenção ou higienização" onClick={() => undefined} /></div>
    <section className="panel"><div className="panel-heading"><div><h2>Leitos que precisam de ação</h2><p>Ao concluir uma manutenção, o leito passa para higienização antes de ficar disponível.</p></div><button className="btn btn-outline" onClick={() => onAction({ kind: 'maintenance' })}><Wrench size={16} /> Registrar manutenção</button></div>
      <div className="table-wrap"><table><thead><tr><th>Leito</th><th>Hospital</th><th>Tipo</th><th>Situação</th><th>Detalhe</th><th></th></tr></thead><tbody>{beds.filter((b) => b.status !== 'available').map((b) => {
        const task = b.status === 'maintenance' ? app.maintenances.find((m) => m.bedId === b.id && m.status === 'open') : app.cleanings.find((c) => c.bedId === b.id && c.status === 'pending');
        return <tr key={b.id}><td><strong>{b.code}</strong></td><td>{hospitalName(app, b.hospitalId)}</td><td>{BED_TYPE[b.type]}</td><td><span className={'status-pill ' + b.status}>{statusText(b.status)}</span></td><td>{b.status === 'maintenance' ? task?.reason || 'Revisão técnica' : task?.reason || 'Higienização após saída'}</td><td>{b.status === 'maintenance' ? <button className="btn btn-small btn-outline" onClick={() => onAction({ kind: 'finish-maintenance', bedId: b.id })}>Concluir</button> : <button className="btn btn-small btn-primary" onClick={() => onAction({ kind: 'clean', bedId: b.id })}>Liberar leito</button>}</td></tr>;
      })}</tbody></table></div></section></>;
}

function MovementsView({ app, movements }: { app: AppState; movements: ReturnType<typeof selectMovements> }) {
  return <section className="panel"><div className="panel-heading"><div><h2>Histórico de movimentações</h2><p>Entradas, saídas, manutenção e mudanças no status dos leitos.</p></div><span className="count-badge">Últimos {movements.length}</span></div>
    {movements.length ? <div className="activity-list activity-full">{movements.map((event) => {
      const bed = event.bedId ? app.beds.find((b) => b.id === event.bedId) : undefined;
      const patient = event.patientId ? app.patients.find((p) => p.id === event.patientId) : undefined;
      return <div className="activity-item" key={event.id}><span className="activity-icon"><Activity size={15} /></span><div><strong>{movementLabel(event.type)}{bed ? ' · ' + bed.code : ''}</strong><small>{hospitalName(app, event.hospitalId)}{patient ? ' · ' + patient.displayName : ''}{event.reason ? ' · ' + event.reason : ''}</small></div><time>{fmt(event.happenedAt, { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></div>;
    })}</div> : <Empty text="Ainda não há movimentações para exibir." />}
  </section>;
}

function ReportView({ app, beds, hospitalId }: { app: AppState; beds: Bed[]; hospitalId: string }) {
  const patientByAdmission = new Map(app.admissions.map((a) => [a.id, app.patients.find((p) => p.id === a.patientId)]));
  const rows = beds.map((b) => {
    const block = app.blocks.find((item) => item.id === b.blockId);
    const patient = b.currentAdmissionId ? patientByAdmission.get(b.currentAdmissionId) : undefined;
    return { hospital: hospitalName(app, b.hospitalId), block: block?.name || '', bed: b.code, type: BED_TYPE[b.type], status: statusText(b.status), patient: patient?.displayName || '', localRecord: patient?.localRecord || '' };
  });
  return <><section className="panel"><div className="panel-heading"><div><h2>Relação de leitos</h2><p>Baixe a planilha em CSV para abrir no Excel ou no Google Sheets.</p></div><button className="btn btn-primary" onClick={() => downloadCsv('senso-de-leitos.csv', rows, [{ label: 'Hospital', key: 'hospital' }, { label: 'Bloco', key: 'block' }, { label: 'Leito', key: 'bed' }, { label: 'Tipo', key: 'type' }, { label: 'Status', key: 'status' }, { label: 'Paciente', key: 'patient' }, { label: 'Registro', key: 'localRecord' }])}><Download size={16} /> Baixar CSV</button></div>
      <div className="table-wrap"><table><thead><tr><th>Hospital</th><th>Bloco</th><th>Leito</th><th>Tipo</th><th>Status</th><th>Paciente</th><th>Registro</th></tr></thead><tbody>{rows.slice(0, 200).map((r) => <tr key={r.hospital + r.bed}><td>{r.hospital}</td><td>{r.block}</td><td><strong>{r.bed}</strong></td><td>{r.type}</td><td><span className={'status-pill ' + statusClass(r.status)}>{r.status}</span></td><td>{r.patient || '—'}</td><td>{r.localRecord || '—'}</td></tr>)}</tbody></table></div>
      <p className="table-footnote">Exibindo {rows.length} leitos {hospitalId === 'all' ? 'da rede' : 'do hospital selecionado'}. A exportação contém os mesmos dados mostrados aqui.</p>
    </section></>;
}

function SamuView({ app, onConfirm }: { app: AppState; onConfirm: (id: string) => void }) {
  return <><div className="samu-banner"><span><Siren size={21} /></span><div><strong>Consulta rápida de disponibilidade</strong><p>Esta visão não exibe nomes, documentos ou outros dados pessoais de pacientes.</p></div><span className="demo-tag">DADOS DE EXEMPLO</span></div><div className="samu-grid">{app.hospitals.map((h) => {
    const beds = app.beds.filter((b) => b.hospitalId === h.id);
    const counts = countByStatus(beds);
    const stale = Date.now() - Date.parse(h.lastVerifiedAt) > 15 * 60_000;
    const byType = Object.keys(BED_TYPE) as BedType[];
    return <article className="samu-card" key={h.id}><div className="samu-card-title"><div className="hospital-symbol"><Building2 size={18} /></div><div><h2>{h.name}</h2><span>{h.city} · {h.state}</span></div></div>
      <div className="samu-available"><strong>{counts.available}</strong><span>leitos disponíveis</span><small>de {beds.length} leitos cadastrados</small></div>
      <div className="type-availability">{byType.map((type) => <div key={type}><span>{BED_TYPE[type]}</span><strong>{beds.filter((b) => b.type === type && b.status === 'available').length}</strong></div>)}</div>
      <div className="hospital-bedmap samu-bedmap"><div className="mini-map-heading"><strong>Mapa dos leitos</strong><span>{beds.length} leitos</span></div><BedTileMap app={app} beds={beds} hospitalName={h.name} /></div>
      <div className={'samu-fresh' + (stale ? ' old' : '')}><span className="status-dot" />{stale ? 'Confirmação necessária' : 'Situação confirmada'} · {fmt(h.lastVerifiedAt, { hour: '2-digit', minute: '2-digit' })}</div>
      {stale && <button className="btn btn-outline btn-small full-btn" onClick={() => onConfirm(h.id)}><Check size={15} /> Confirmar disponibilidade</button>}
    </article>;
  })}</div><BedStatusLegend /><p className="samu-caveat"><CircleHelp size={16} /> Este painel demonstra o fluxo. A capacidade e os status são fictícios, salvos localmente e não representam disponibilidade assistencial real.</p></>;
}

function ModalView({ modal, app, queueItem, onClose, onSubmit }: { modal: Modal; app: AppState; queueItem?: WaitlistItem; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const [entryStep, setEntryStep] = useState(1);
  const [matchingBeds, setMatchingBeds] = useState(0);
  const selectedBed = 'bedId' in modal && modal.bedId ? app.beds.find((b) => b.id === modal.bedId) : undefined;
  const available = app.beds.filter((b) => b.status === 'available');
  const unusedPatients = app.patients.filter((p) => !app.admissions.some((a) => a.patientId === p.id && a.status === 'active'));
  const admission = modal.kind === 'exit' ? app.admissions.find((a) => a.id === modal.admissionId) : undefined;
  const patient = admission ? patientForAdmission(app, admission) : undefined;
  const bed = admission?.currentBedId ? app.beds.find((b) => b.id === admission.currentBedId) : selectedBed;
  const titles: Record<Modal['kind'], string> = {
    entry: 'Nova entrada de paciente', exit: 'Registrar saída', maintenance: 'Registrar manutenção',
    'finish-maintenance': 'Concluir manutenção', clean: 'Concluir higienização', reserve: 'Reservar leito',
    'cancel-reservation': 'Cancelar reserva', unblock: 'Retirar bloqueio',
  };
  const descriptions: Record<Modal['kind'], string> = {
    entry: queueItem ? 'Conclua os dados da internação quando houver uma vaga compatível.' : 'Informe os dados do paciente e, em seguida, os dados da internação.',
    exit: 'Informe o tipo de saída. O leito seguirá para higienização.',
    maintenance: 'O leito ficará indisponível até a manutenção ser concluída.',
    'finish-maintenance': 'Ao concluir, o leito passará para higienização.',
    clean: 'Confirme a higienização para liberar o leito para novas entradas.',
    reserve: 'Informe quem acompanha a reserva e a previsão de chegada.',
    'cancel-reservation': 'Registre o motivo para liberar a reserva.',
    unblock: 'O leito passará para higienização após a conferência do bloqueio.',
  };
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
    <header className="dialog-head"><div><h2 id="dialog-title">{titles[modal.kind]}</h2><p>{descriptions[modal.kind]}</p></div><button className="icon-plain" onClick={onClose} aria-label="Fechar"><X size={19} /></button></header>
    {bed && <div className="dialog-bed"><BedDouble size={16} /><strong>{bed.code}</strong><span>{hospitalName(app, bed.hospitalId)} · {BED_TYPE[bed.type]}</span><span className={'status-pill ' + bed.status}>{statusText(bed.status)}</span></div>}
    <form onSubmit={onSubmit} className="dialog-form">
      {modal.kind === 'entry' && <>
        <div className="entry-progress" aria-label={`Etapa ${entryStep} de 2`}><span className={entryStep === 1 ? 'current' : 'done'}><i>1</i><b>Paciente</b></span><i className={entryStep === 2 ? 'done' : ''} /><span className={entryStep === 2 ? 'current' : ''}><i>2</i><b>Internação</b></span></div>
        <EntryFields app={app} selectedBed={selectedBed} available={available} patients={unusedPatients} queueItem={queueItem} step={entryStep} onAvailableChange={setMatchingBeds} />
      </>}
      {modal.kind === 'exit' && <><div className="person-highlight"><span className="patient-avatar">{patient?.displayName.slice(0, 1) || '?'}</span><span><strong>{patient?.displayName || 'Paciente'}</strong><small>{patient?.localRecord} · {hospitalName(app, admission?.hospitalId || '')} · {bed?.code}</small></span></div>
        <Field label="Tipo de saída" required><select name="dischargeType" defaultValue="discharge" required><option value="discharge">Alta</option><option value="external_transfer">Transferência externa</option><option value="evasion">Evasão</option><option value="death">Óbito</option><option value="other">Outro</option></select></Field>
        <Field label="Destino (se transferência)"><input name="destination" placeholder="Hospital ou unidade de destino" /></Field><Field label="Observação"><textarea name="note" rows={2} placeholder="Complemento do registro, se necessário" /></Field></>}
      {modal.kind === 'maintenance' && <>{!modal.bedId && <Field label="Leito" required><select name="bedId" required defaultValue=""><option value="" disabled>Selecione um leito disponível</option>{available.map((b) => <option key={b.id} value={b.id}>{b.code} · {hospitalName(app, b.hospitalId)} · {BED_TYPE[b.type]}</option>)}</select></Field>}<Field label="Motivo da manutenção" required><input name="reason" required placeholder="Ex.: ajuste elétrico, troca de equipamento" /></Field><Field label="Responsável" required><input name="responsible" required placeholder="Nome da pessoa responsável" /></Field></>}
      {modal.kind === 'finish-maintenance' && <Field label="O que foi concluído ou verificado?" required><textarea name="note" required rows={3} placeholder="Descreva a conclusão da manutenção" /></Field>}
      {modal.kind === 'clean' && <Field label="Responsável pela conferência" required><input name="responsible" required placeholder="Nome da pessoa responsável" /></Field>}
      {modal.kind === 'reserve' && <><Field label="Responsável pela reserva" required><input name="responsible" required placeholder="Nome da pessoa responsável" /></Field><Field label="Previsão de chegada" required><input name="expectedAt" required type="datetime-local" defaultValue={localDateTimeValue(60)} /></Field><Field label="Protocolo (opcional)"><input name="protocol" placeholder="Número de referência" /></Field></>}
      {modal.kind === 'cancel-reservation' && <Field label="Motivo do cancelamento" required><input name="reason" required placeholder="Informe o motivo" /></Field>}
      {modal.kind === 'unblock' && <Field label="Motivo da retirada do bloqueio" required><input name="reason" required placeholder="Informe a conferência realizada" /></Field>}
      <div className="dialog-actions"><button type="button" className="btn btn-light" onClick={modal.kind === 'entry' && entryStep === 2 ? () => setEntryStep(1) : onClose}>{modal.kind === 'entry' && entryStep === 2 ? 'Voltar' : 'Cancelar'}</button>
        {modal.kind === 'entry' && entryStep === 1 ? <button type="button" className="btn btn-primary" onClick={(event) => {
          const form = event.currentTarget.form;
          const patientId = String(new FormData(form!).get('patientId') || '');
          const name = form?.elements.namedItem('patientName') as HTMLInputElement | null;
          if (!patientId && name && !name.checkValidity()) { name.reportValidity(); return; }
          setEntryStep(2);
        }}>Próximo <ArrowRight size={15} /></button>
          : modal.kind === 'entry' && matchingBeds === 0 ? <button type="submit" name="intent" value="queue" className="btn btn-primary">Adicionar à fila</button>
            : <button type="submit" className="btn btn-primary">{modal.kind === 'entry' ? 'Registrar entrada' : modal.kind === 'exit' ? 'Confirmar saída' : modal.kind === 'maintenance' ? 'Iniciar manutenção' : modal.kind === 'reserve' ? 'Confirmar reserva' : 'Confirmar'}</button>}
      </div>
    </form>
  </section></div>;
}

function EntryFields({ app, selectedBed, available, patients, queueItem, step, onAvailableChange }: {
  app: AppState; selectedBed?: Bed; available: Bed[]; patients: AppState['patients']; queueItem?: WaitlistItem;
  step: number; onAvailableChange: (count: number) => void;
}) {
  const [selectedPatient, setSelectedPatient] = useState(queueItem?.patientId || '');
  const [hospitalId, setHospitalId] = useState(selectedBed?.hospitalId || queueItem?.hospitalId || app.hospitals[0]?.id || '');
  const [bedType, setBedType] = useState<BedType>(selectedBed?.type || queueItem?.type || 'clinical');
  const [bedId, setBedId] = useState(selectedBed?.id || '');
  const bedsForSelection = available.filter((bed) => bed.hospitalId === hospitalId && bed.type === bedType);
  useEffect(() => { onAvailableChange(bedsForSelection.length); }, [bedsForSelection.length, onAvailableChange]);
  return <>
    <section className="entry-step" hidden={step !== 1} aria-label="Dados do paciente">
      <div className="step-copy"><h3>Dados do paciente</h3><p>Selecione um cadastro existente ou comece um novo.</p></div>
      <Field label="Paciente já cadastrado?"><select name="patientId" value={selectedPatient} onChange={(event) => setSelectedPatient(event.target.value)}><option value="">Novo cadastro</option>{patients.slice(0, 100).map((patient) => <option key={patient.id} value={patient.id}>{patient.displayName} · {patient.localRecord}</option>)}</select></Field>
      <div hidden={Boolean(selectedPatient)}>
        <Field label="Nome completo" required={!selectedPatient}><input name="patientName" defaultValue={queueItem?.patientName || ''} placeholder="Nome do paciente" required={step === 1 && !selectedPatient} /></Field>
        <div className="form-grid"><Field label="Data de nascimento"><input name="birthDate" type="date" defaultValue={queueItem?.birthDate || ''} /></Field><Field label="Telefone para contato"><input name="contact" placeholder="Opcional" defaultValue={queueItem?.contact || ''} /></Field></div>
      </div>
    </section>
    <section className="entry-step" hidden={step !== 2} aria-label="Informações da internação">
      <div className="step-copy"><h3>Informações da internação</h3><p>Escolha onde o paciente será atendido.</p></div>
      <Field label="Hospital" required><select name="hospitalId" value={hospitalId} onChange={(event) => { setHospitalId(event.target.value); setBedId(''); }} required>{app.hospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name}</option>)}</select></Field>
      <div className="form-grid"><Field label="Tipo de leito" required><select name="bedType" value={bedType} onChange={(event) => { setBedType(event.target.value as BedType); setBedId(''); }}>{Object.entries(BED_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        {bedsForSelection.length > 0 ? <Field label="Leito disponível" required><select name="bedId" value={bedId} onChange={(event) => setBedId(event.target.value)} required><option value="" disabled>Selecione um leito</option>{bedsForSelection.map((bed) => <option key={bed.id} value={bed.id}>{bed.code} · {app.blocks.find((block) => block.id === bed.blockId)?.name || 'Bloco'}</option>)}</select></Field> : <div className="no-bed-notice"><Clock3 size={18} /><span><strong>Sem vaga de {BED_TYPE[bedType].toLowerCase()}</strong><small>Adicione à fila para acompanhar a disponibilidade.</small></span></div>}</div>
      <div className="form-grid"><Field label="Origem" required><select name="origin" defaultValue={queueItem?.origin || 'samu'}><option value="samu">SAMU</option><option value="spontaneous">Demanda espontânea</option><option value="transfer">Transferência</option><option value="other">Outra origem</option></select></Field><Field label="Código do procedimento"><input name="procedureCode" defaultValue={queueItem?.procedureCode || ''} placeholder="Opcional" /></Field></div>
      <Field label="Motivo da internação" required><textarea name="reason" required rows={2} defaultValue={queueItem?.reason || ''} placeholder="Descreva brevemente o motivo" /></Field>
    </section>
  </>;
}

function WaitlistView({ app, items, onRegister, onRemove }: { app: AppState; items: WaitlistItem[]; onRegister: (item: WaitlistItem, bedId: string) => void; onRemove: (id: string) => void }) {
  const orderedItems = [...items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return <section className="panel waitlist-panel"><div className="panel-heading"><div><h2>Pacientes aguardando por leito</h2><p>Vagas compatíveis aparecem aqui para concluir a entrada.</p></div><span className="count-badge">{items.length} {items.length === 1 ? 'paciente' : 'pacientes'}</span></div>
    {orderedItems.length ? <div className="waitlist-items">{orderedItems.map((item, index) => {
      const freeBed = app.beds.find((bed) => bed.status === 'available' && bed.hospitalId === item.hospitalId && bed.type === item.type);
      return <article className="waitlist-item" key={item.id}><span className="waitlist-number">{index + 1}</span><div className="waitlist-person"><strong>{item.patientName || app.patients.find((patient) => patient.id === item.patientId)?.displayName || 'Paciente'}</strong><span>{hospitalName(app, item.hospitalId)} · {BED_TYPE[item.type]}</span><small>{item.reason} · aguardando desde {fmt(item.createdAt, { hour: '2-digit', minute: '2-digit' })}</small></div><div className="waitlist-status"><span className={'status-pill ' + (freeBed ? 'available' : 'reserved')}>{freeBed ? `Vaga ${freeBed.code} disponível` : 'Aguardando vaga'}</span><div><button type="button" className="btn btn-primary btn-small" disabled={!freeBed} onClick={() => freeBed && onRegister(item, freeBed.id)}>Registrar entrada</button><button type="button" className="waitlist-remove" onClick={() => onRemove(item.id)}>Remover</button></div></div></article>;
    })}</div> : <Empty text="Ainda não há pacientes aguardando. Se não houver uma vaga do tipo solicitado, inclua o paciente na fila durante o cadastro." />}
  </section>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) { return <label className="field"><span>{label}{required && <b> *</b>}</span>{children}</label>; }
function Empty({ text }: { text: string }) { return <div className="empty-state"><span><Search size={20} /></span><strong>{text}</strong></div>; }

function hospitalName(app: AppState, id: string) { return app.hospitals.find((h) => h.id === id)?.name || id; }
function statusClass(status: string) {
  if (status === 'Disponível') return 'available';
  if (status === 'Ocupado') return 'occupied';
  if (status === 'Reservado') return 'reserved';
  if (status === 'Em manutenção') return 'maintenance';
  if (status === 'Bloqueado') return 'blocked';
  return 'cleaning';
}
function movementLabel(type: string) {
  const names: Record<string, string> = {
    admission: 'Entrada registrada', discharge: 'Saída registrada', transfer_in: 'Transferência interna recebida',
    transfer_out: 'Transferência interna enviada', cleaning_complete: 'Higienização concluída',
    maintenance_start: 'Manutenção iniciada', maintenance_complete: 'Manutenção concluída',
    reserve: 'Leito reservado', reservation_cancel: 'Reserva cancelada', block: 'Leito bloqueado',
    unblock: 'Bloqueio retirado', hospital_confirm: 'Mapa do hospital conferido', baseline: 'Situação inicial',
  };
  return names[type] || 'Situação atualizada';
}

