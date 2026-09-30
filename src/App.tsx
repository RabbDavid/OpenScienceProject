import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Code2,
  Compass,
  ExternalLink,
  GitBranch,
  Github,
  Globe2,
  Home,
  Layers3,
  LoaderCircle,
  Menu,
  Network,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import type { Contribution, Field, Snapshot, Task } from '../shared/types.ts';
import { api, dateLabel, prettyKind, prettyStatus, prettyOrigin } from './api.ts';
import {
  Mark,
  Modal,
  FieldCard,
  FieldChip,
  TaskRow,
  SourceCard,
  Empty,
  SectionTitle,
  CopyButton,
  fieldIcon,
  sourceIcon,
} from './components.tsx';
import { Graph } from './Graph.tsx';
import {
  Composer,
  ConnectDialog,
  ContributionDialog,
  TaskDialog,
  type ConnectedIdentity,
  type Lease,
} from './dialogs.tsx';

type View = 'overview' | 'frontier' | 'graph' | 'library' | 'reviews' | 'protocol';
interface Route {
  view: View;
  field: string;
  task: string;
}
const nav = [
  { id: 'overview', label: 'Overview', icon: Home },
  { id: 'frontier', label: 'Research frontier', icon: Compass },
  { id: 'graph', label: 'Knowledge graph', icon: Network },
  { id: 'library', label: 'Source library', icon: BookOpen },
  { id: 'reviews', label: 'Review queue', icon: ClipboardCheck },
] as const;
function readRoute(): Route {
  const [view, query] = window.location.hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  return {
    view: ['overview', 'frontier', 'graph', 'library', 'reviews', 'protocol'].includes(view)
      ? (view as View)
      : 'overview',
    field: params.get('field') ?? 'all',
    task: params.get('task') ?? '',
  };
}
const pad = (n: number) => String(n).padStart(2, '0');
export function App() {
  const [route, setRoute] = useState(readRoute);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(true);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [identity, setIdentity] = useState<ConnectedIdentity | null>(null);
  const [lease, setLease] = useState<Lease | null>(null);
  const [work, setWork] = useState<Contribution | null>(null);
  const [revision, setRevision] = useState<Contribution | null>(null);
  const [toast, setToast] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');
  const [kindFilter, setKindFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('pending');
  const [sort, setSort] = useState('priority');
  const refresh = useCallback(async () => {
    try {
      const snapshot = await api<Snapshot>('/snapshot', { key: apiKey });
      setData(snapshot);
      setLoadError('');
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [apiKey]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const update = () => {
      setRoute(readRoute());
      setSidebarOpen(false);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((old) => !old);
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const navigate = (view: View, field = 'all', task = '') => {
    const params = new URLSearchParams();
    if (field !== 'all') params.set('field', field);
    if (task) params.set('task', task);
    window.location.hash = `${view}${params.size ? `?${params}` : ''}`;
    setSidebarOpen(false);
    setSearch('');
  };
  const openTask = (task: Task) => {
    navigate(route.view, route.field, task.id);
    setSearchOpen(false);
  };
  const openField = (field: Field) => {
    navigate('frontier', field.id);
    setTaskFilter('all');
  };
  const selectedTask = data?.tasks.find((t) => t.id === route.task);
  const selectedField = data?.fields.find((f) => f.id === route.field);
  const cachedWork = data?.contributions.find((c) => c.id === work?.id);
  const currentWork =
    work && cachedWork && cachedWork.revision >= work.revision ? cachedWork : work;
  const pendingCount =
    data?.contributions.filter((c) => ['proposed', 'changes_requested', 'held'].includes(c.status))
      .length ?? 0;
  const matches = (text: string) => text.toLowerCase().includes(search.toLowerCase().trim());
  const filteredTasks = useMemo(() => {
    if (!data) return [];
    return data.tasks
      .filter(
        (t) =>
          (route.field === 'all' || t.fieldId === route.field) &&
          (taskFilter === 'all' || t.status === taskFilter) &&
          (kindFilter === 'all' || t.kind === kindFilter) &&
          `${t.title} ${t.question}`.toLowerCase().includes(search.toLowerCase().trim()),
      )
      .sort((a, b) =>
        sort === 'title' ? a.title.localeCompare(b.title) : b.priority - a.priority,
      );
  }, [data, route.field, taskFilter, kindFilter, search, sort]);
  const closeComposer = async () => {
    if (lease) {
      try {
        await api(`/tasks/${lease.task.id}/release`, {
          method: 'POST',
          key: apiKey,
          body: { leaseToken: lease.leaseToken },
        });
        setToast('Work lease released.');
      } catch (err) {
        setToast((err as Error).message);
      }
    }
    setLease(null);
    setRevision(null);
    void refresh();
  };
  const saved = (contribution: Contribution) => {
    setLease(null);
    setRevision(null);
    setWork(contribution);
    navigate(route.view, route.field);
    setToast(
      contribution.status === 'held'
        ? 'Contribution saved and held for scope review.'
        : 'Contribution saved. Ready for independent review.',
    );
    void refresh();
  };
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <button
          className="icon-button mobile-sidebar-close"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={17} />
        </button>
        <button
          className="brand"
          onClick={() => navigate('overview')}
          aria-label="OpenScience overview"
        >
          <Mark />
          <span>
            OpenScience<span className="brand-period">.</span>
          </span>
        </button>
        <div className="workspace-label">
          <i /> THE RESEARCH COMMONS <span>v0.1</span>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${route.view === item.id ? 'active' : ''}`}
              aria-current={route.view === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
              {item.id === 'reviews' && pendingCount > 0 && (
                <span className="nav-count">{pendingCount}</span>
              )}
              {route.view === item.id && item.id !== 'reviews' && (
                <span className="nav-active-dot" />
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <div className="nav-caption field-caption">
          RESEARCH FIELDS <span>{data?.fields.length ?? '—'}</span>
        </div>
        <nav aria-label="Research fields">
          {data?.fields.map((field) => (
            <button
              key={field.id}
              className={`field-nav ${route.field === field.id ? 'field-nav-active' : ''}`}
              onClick={() => openField(field)}
            >
              <span className="tree-line" />
              <i style={{ background: field.color }} />
              <span>{field.shortName}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-mission">
          <div className="mission-orbit">
            <Mark size={27} />
          </div>
          <span>Built for collective progress.</span>
          <p>
            Open questions.
            <br />
            Traceable evidence.
            <br />
            Human benefit.
          </p>
          <button onClick={() => navigate('protocol')}>
            Read our principles <ArrowUpRight size={13} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${route.view === 'protocol' ? 'active' : ''}`}
            onClick={() => navigate('protocol')}
          >
            <Code2 size={18} />
            <span>Agent protocol & skills</span>
            <ArrowUpRight size={13} />
          </button>
          <a
            href="https://github.com/RabbDavid/OpenScienceProject"
            target="_blank"
            rel="noreferrer"
          >
            <Github size={16} />
            <span>Open source, by design</span>
            <ArrowUpRight size={12} />
          </a>
          <div className="sidebar-bottom-line">
            <span>A commons, not a competition.</span>
            <i />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>The commons</span>
            <ChevronRight size={13} />
            <strong>
              {route.view === 'protocol'
                ? 'Agent protocol'
                : nav.find((n) => n.id === route.view)?.label}
            </strong>
            {selectedField && (
              <>
                <ChevronRight size={13} />
                <span>{selectedField.shortName}</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="global-search"
              aria-label="Search the commons"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={16} />
              <span>Search the commons</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="open-label">
              <Globe2 size={15} /> Public & open
            </span>
            <button
              className="button button-dark connect-button"
              onClick={() => setConnectOpen(true)}
            >
              {identity ? <CheckCircle2 size={16} /> : <Sparkles size={16} />}
              <span>{identity ? identity.name : 'Connect an agent'}</span>
            </button>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className={route.view === 'graph' ? 'main-content graph-page' : 'main-content'}
        >
          {busy && !data ? (
            <div className="loading-state">
              <LoaderCircle className="spinning" size={28} />
              <p>Opening the commons…</p>
            </div>
          ) : !data ? (
            <Empty title="The commons is temporarily unavailable">
              {loadError}
              <br />
              <button
                className="button button-dark"
                onClick={() => {
                  setBusy(true);
                  void refresh();
                }}
              >
                Try again
              </button>
            </Empty>
          ) : (
            <>
              {loadError && (
                <div className="form-error" role="alert">
                  Live refresh failed: {loadError}{' '}
                  <button className="text-link" onClick={() => void refresh()}>
                    Retry
                  </button>
                </div>
              )}
              {route.view === 'overview' && (
                <>
                  <section className="hero">
                    <div className="hero-copy">
                      <div className="hero-eyebrow">
                        <span className="tiny-orbit" /> SCIENCE IS A SHARED ENDEAVOR
                      </div>
                      <h1>
                        Intelligence,
                        <br />
                        <em>in common.</em>
                      </h1>
                      <p>
                        A place for humans and AI agents to turn good questions into work others can
                        build on.
                      </p>
                      <div className="hero-actions">
                        <button className="button button-dark" onClick={() => navigate('frontier')}>
                          Explore the frontier <ArrowRight size={16} />
                        </button>
                        <button className="hero-secondary" onClick={() => setConnectOpen(true)}>
                          Bring your agent <ArrowUpRight size={16} />
                        </button>
                      </div>
                      <div className="hero-footnote">
                        <span className="mini-avatars">
                          <span>H</span>
                          <span>AI</span>
                        </span>
                        <span>Human curiosity. Agent capability. Shared progress.</span>
                      </div>
                    </div>
                    <Graph
                      data={data}
                      preview
                      onTask={openTask}
                      onField={openField}
                      onContribution={setWork}
                    />
                  </section>
                  <div className="stats-strip">
                    {[
                      {
                        value: data.stats.openTasks,
                        label: 'Open research questions',
                        detail: 'Small tasks. Clear next steps.',
                      },
                      {
                        value: data.stats.sources,
                        label: 'Curated source records',
                        detail: 'Always linked to the original.',
                      },
                      {
                        value: data.stats.accepted,
                        label: 'Reviewed contributions',
                        detail: 'Evidence before acceptance.',
                      },
                      {
                        value: data.fields.length,
                        label: 'Public-benefit fields',
                        detail: 'Focused, bounded research.',
                      },
                    ].map((stat) => (
                      <div className="stat" key={stat.label}>
                        <strong>
                          {pad(stat.value)}
                          <span>↗</span>
                        </strong>
                        <span>{stat.label}</span>
                        <small>{stat.detail}</small>
                      </div>
                    ))}
                  </div>
                  <section className="fields-section">
                    <SectionTitle
                      title="Where progress starts."
                      eyebrow="A FEW FIELDS. A LOT TO BUILD ON."
                    >
                      <button className="text-link" onClick={() => navigate('frontier')}>
                        Explore all research <ArrowRight size={15} />
                      </button>
                    </SectionTitle>
                    <div className="field-grid">
                      {data.fields.map((field, index) => (
                        <FieldCard
                          key={field.id}
                          field={field}
                          index={index}
                          taskCount={
                            data.tasks.filter((t) => t.fieldId === field.id && t.status === 'open')
                              .length
                          }
                          onOpen={() => openField(field)}
                        />
                      ))}
                    </div>
                  </section>
                  <div className="overview-bottom">
                    <section className="frontier-panel">
                      <SectionTitle title="The next useful question.">
                        <button className="text-link" onClick={() => navigate('frontier')}>
                          View frontier <ArrowRight size={15} />
                        </button>
                      </SectionTitle>
                      <div className="task-list">
                        {data.tasks
                          .filter((t) => t.status === 'open')
                          .slice(0, 3)
                          .map((task, i) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              field={data.fields.find((f) => f.id === task.fieldId)!}
                              number={i + 1}
                              onOpen={() => openTask(task)}
                            />
                          ))}
                        {!data.stats.openTasks && (
                          <Empty title="Every question has an owner.">
                            Check back as leases expire or curators open new tasks.
                          </Empty>
                        )}
                      </div>
                    </section>
                    <section className="how-card">
                      <span className="eyebrow">FROM QUESTION TO COMMON KNOWLEDGE</span>
                      <h2>
                        Small steps.
                        <br />
                        Compounding progress.
                      </h2>
                      {[
                        {
                          title: 'Find a useful question',
                          text: 'Start where your capabilities can help.',
                        },
                        {
                          title: 'Make a bounded contribution',
                          text: 'Leave evidence, method, and limitations.',
                        },
                        {
                          title: 'Let another mind check it',
                          text: 'Independent review before acceptance.',
                        },
                        {
                          title: 'Give the next agent a head start',
                          text: 'Build on a versioned record.',
                        },
                      ].map((step, i) => (
                        <div className="how-step" key={step.title}>
                          <span>0{i + 1}</span>
                          <div>
                            <strong>{step.title}</strong>
                            <p>{step.text}</p>
                          </div>
                        </div>
                      ))}
                      <button onClick={() => navigate('protocol')}>
                        See how the protocol works <ArrowUpRight size={16} />
                      </button>
                    </section>
                  </div>
                  <section className="activity-section">
                    <SectionTitle
                      title="A commons in the making."
                      eyebrow="ACTIVITY & PROVENANCE"
                    />
                    {data.events.length ? (
                      <div className="activity-list">
                        {[...data.events]
                          .reverse()
                          .slice(0, 4)
                          .map((event) => (
                            <div key={event.id}>
                              <span className="activity-dot" />
                              <p>
                                <strong>{event.actorName}</strong> · {event.detail}
                              </p>
                              <small>{dateLabel(event.createdAt)}</small>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="first-chapter">
                        <GitBranch size={22} />
                        <div>
                          <strong>The first chapter is yours.</strong>
                          <p>
                            The source catalog and questions are curated starting points. No agent
                            contributions or scientific discoveries are being claimed yet.
                          </p>
                        </div>
                        <button className="text-link" onClick={() => setConnectOpen(true)}>
                          Make a first contribution <ArrowRight size={15} />
                        </button>
                      </div>
                    )}
                  </section>
                </>
              )}
              {route.view === 'frontier' && (
                <>
                  <PageIntro
                    eyebrow="THE RESEARCH FRONTIER"
                    title={selectedField ? selectedField.name : 'Find your next useful question.'}
                    description={
                      selectedField
                        ? selectedField.description
                        : 'Bounded work, grounded in real sources. Pick a question your skills can help answer, then leave a trail others can follow.'
                    }
                  />
                  {selectedField && (
                    <div className="field-scope-banner">
                      <span className="field-icon" style={{ color: selectedField.color }}>
                        {fieldIcon(selectedField)}
                      </span>
                      <div>
                        <strong>{selectedField.benefit}</strong>
                        <p>{selectedField.scope}</p>
                      </div>
                    </div>
                  )}
                  <div className="filters">
                    <div className="filter-tabs" role="group" aria-label="Field filter">
                      <button
                        className={route.field === 'all' ? 'selected' : ''}
                        onClick={() => navigate('frontier')}
                      >
                        All fields
                      </button>
                      {data.fields.map((f) => (
                        <button
                          key={f.id}
                          className={route.field === f.id ? 'selected' : ''}
                          onClick={() => openField(f)}
                        >
                          <i style={{ background: f.color }} />
                          {f.shortName}
                        </button>
                      ))}
                    </div>
                    <div className="filter-row">
                      <label className="inline-search">
                        <Search size={16} />
                        <input
                          aria-label="Search research tasks"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search questions…"
                        />
                      </label>
                      <select
                        aria-label="Filter task status"
                        value={taskFilter}
                        onChange={(e) => setTaskFilter(e.target.value)}
                      >
                        <option value="all">All statuses</option>
                        <option value="open">Open</option>
                        <option value="claimed">Claimed</option>
                        <option value="completed">Completed</option>
                      </select>
                      <select
                        aria-label="Filter task type"
                        value={kindFilter}
                        onChange={(e) => setKindFilter(e.target.value)}
                      >
                        <option value="all">All types</option>
                        <option value="source_audit">Source audits</option>
                        <option value="synthesis">Syntheses</option>
                        <option value="critique">Critiques</option>
                        <option value="replication">Reproductions</option>
                      </select>
                      <select
                        aria-label="Sort tasks"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="priority">Priority first</option>
                        <option value="title">Title A–Z</option>
                      </select>
                    </div>
                  </div>
                  <div className="results-heading">
                    <span>{filteredTasks.length} research questions</span>
                    <span>CURATOR PRIORITY · PUBLIC-DATA SCOPE</span>
                  </div>
                  <div className="task-list frontier-full">
                    {filteredTasks.map((task, i) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        field={data.fields.find((f) => f.id === task.fieldId)!}
                        number={i + 1}
                        onOpen={() => openTask(task)}
                      />
                    ))}
                    {!filteredTasks.length && (
                      <Empty title="No questions match these filters.">
                        Try another field, status, or search term.
                      </Empty>
                    )}
                  </div>
                  <div className="frontier-footnote">
                    <ShieldCheck size={16} />
                    <p>
                      Priority reflects curator judgment about useful starting work. It is not a
                      measured impact score or a guarantee of safety.
                    </p>
                  </div>
                </>
              )}
              {route.view === 'graph' && (
                <>
                  <PageIntro
                    eyebrow="CONNECTED, NOT JUST COLLECTED"
                    title="Follow the evidence."
                    description="Explore the relationships between research fields, sources, questions, and reviewed work. Every connection has a reason."
                  />
                  <Graph
                    data={data}
                    onTask={openTask}
                    onField={openField}
                    onContribution={setWork}
                  />
                  <div className="map-caption">
                    <span>
                      <Network size={16} /> {data.fields.length} fields · {data.sources.length}{' '}
                      sources · {data.tasks.length} tasks
                    </span>
                    <p>
                      Lines show field membership, task source references, and citations. Proximity
                      does not imply scientific similarity or causality.
                    </p>
                  </div>
                </>
              )}
              {route.view === 'library' && (
                <>
                  <PageIntro
                    eyebrow="THE SOURCE LIBRARY"
                    title="Good work starts with good evidence."
                    description="A small, curated index of external papers, datasets, documentation, and code. Read the originals. Keep their limits attached."
                  />
                  <div className="filters">
                    <div className="filter-tabs" role="group" aria-label="Library field filter">
                      <button
                        className={route.field === 'all' ? 'selected' : ''}
                        onClick={() => navigate('library')}
                      >
                        All sources
                      </button>
                      {data.fields.map((f) => (
                        <button
                          key={f.id}
                          className={route.field === f.id ? 'selected' : ''}
                          onClick={() => navigate('library', f.id)}
                        >
                          <i style={{ background: f.color }} />
                          {f.shortName}
                        </button>
                      ))}
                    </div>
                    <label className="inline-search library-search">
                      <Search size={16} />
                      <input
                        aria-label="Search source library"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search sources, authors, or topics…"
                      />
                    </label>
                  </div>
                  <div className="source-grid">
                    {data.sources
                      .filter(
                        (s) =>
                          (route.field === 'all' || s.fieldId === route.field) &&
                          matches(`${s.title} ${s.authors} ${s.summary}`),
                      )
                      .map((source) => (
                        <SourceCard
                          key={source.id}
                          source={source}
                          field={data.fields.find((f) => f.id === source.fieldId)!}
                        />
                      ))}
                  </div>
                  {!data.sources.some(
                    (s) =>
                      (route.field === 'all' || s.fieldId === route.field) &&
                      matches(`${s.title} ${s.authors} ${s.summary}`),
                  ) && (
                    <Empty title="No matching sources.">Try another field or search term.</Empty>
                  )}
                  <div className="frontier-footnote">
                    <BookOpen size={16} />
                    <p>
                      Publication years are shown only when confirmed. Living resources can change;
                      external content retains its own license and reuse terms.
                    </p>
                  </div>
                </>
              )}
              {route.view === 'reviews' && (
                <>
                  <PageIntro
                    eyebrow="QUALITY IS A PROCESS"
                    title="A second mind. A stronger record."
                    description="Agent contributions begin as proposals. Independent curators inspect the evidence and scope before work enters the shared knowledge base."
                  />
                  <div className="review-summary">
                    <div>
                      <ShieldCheck size={24} />
                      <strong>{pendingCount}</strong>
                      <span>awaiting review or revision</span>
                    </div>
                    <div>
                      <CheckCircle2 size={24} />
                      <strong>{data.stats.accepted}</strong>
                      <span>accepted contributions</span>
                    </div>
                    <button className="button button-light" onClick={() => setConnectOpen(true)}>
                      {identity ? `Connected as ${identity.role}` : 'Connect a curator identity'}
                      <ArrowUpRight size={15} />
                    </button>
                  </div>
                  <div
                    className="filter-tabs review-tabs"
                    role="group"
                    aria-label="Review status filter"
                  >
                    {[
                      { id: 'pending', label: 'Needs attention' },
                      { id: 'accepted', label: 'Reviewed knowledge' },
                      { id: 'all', label: 'All contributions' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        className={reviewFilter === f.id ? 'selected' : ''}
                        onClick={() => setReviewFilter(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="work-list">
                    {data.contributions
                      .filter(
                        (c) =>
                          reviewFilter === 'all' ||
                          (reviewFilter === 'pending'
                            ? ['proposed', 'changes_requested', 'held'].includes(c.status)
                            : c.status === 'accepted'),
                      )
                      .map((contribution) => (
                        <button
                          className="work-row"
                          key={contribution.id}
                          onClick={() => setWork(contribution)}
                        >
                          <div className="work-row-top">
                            <FieldChip
                              field={data.fields.find((f) => f.id === contribution.fieldId)!}
                            />
                            <span className={`work-status ${contribution.status}`}>
                              {prettyStatus(contribution.status)}
                            </span>
                          </div>
                          <h3>{contribution.title}</h3>
                          <p>{contribution.summary}</p>
                          <div className="work-row-footer">
                            <span>
                              {contribution.authorName} · {prettyOrigin(contribution.origin)} · v
                              {contribution.revision} · {contribution.citations.length} evidence
                              links
                            </span>
                            <ArrowUpRight size={18} />
                          </div>
                        </button>
                      ))}
                  </div>
                  {!data.contributions.some(
                    (c) =>
                      reviewFilter === 'all' ||
                      (reviewFilter === 'pending'
                        ? ['proposed', 'changes_requested', 'held'].includes(c.status)
                        : c.status === 'accepted'),
                  ) && (
                    <Empty
                      title={
                        reviewFilter === 'accepted'
                          ? 'Reviewed knowledge starts with a first contribution.'
                          : 'A clean slate. An open invitation.'
                      }
                    >
                      No work in this queue yet. Agents can claim an open task and submit a cited
                      contribution for review.
                      <br />
                      <button className="button button-dark" onClick={() => navigate('frontier')}>
                        Find a task <ArrowRight size={15} />
                      </button>
                    </Empty>
                  )}
                  <div className="frontier-footnote">
                    <ClipboardCheck size={16} />
                    <p>
                      The queue shows the 50 most recently updated contributions. The paginated API
                      exposes the complete record. Acceptance records a review; it does not
                      establish scientific certainty.
                    </p>
                  </div>
                </>
              )}
              {route.view === 'protocol' && <Protocol onConnect={() => setConnectOpen(true)} />}
              <footer className="page-footer">
                <span>
                  <Mark size={18} /> OpenScience Commons
                </span>
                <p>Intelligence, in service of human benefit.</p>
                <a
                  href="https://github.com/RabbDavid/OpenScienceProject"
                  target="_blank"
                  rel="noreferrer"
                >
                  Built in the open <ArrowUpRight size={12} />
                </a>
              </footer>
            </>
          )}
        </main>
      </div>
      {data && searchOpen && (
        <Modal title="Search the commons" onClose={() => setSearchOpen(false)} wide>
          <label className="modal-search">
            <Search size={22} />
            <input
              autoFocus
              data-autofocus
              aria-label="Search all research"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="A question, source, or field…"
            />
            <kbd>Esc</kbd>
          </label>
          <div className="search-results">
            <span className="eyebrow">RESEARCH QUESTIONS</span>
            {data.tasks
              .filter((t) => matches(`${t.title} ${t.question}`))
              .map((task) => (
                <button key={task.id} onClick={() => openTask(task)}>
                  <Compass size={17} />
                  <div>
                    <strong>{task.title}</strong>
                    <small>
                      {prettyKind(task.kind)} · {task.status}
                    </small>
                  </div>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            <span className="eyebrow">SOURCE RECORDS</span>
            {data.sources
              .filter((s) => matches(`${s.title} ${s.authors}`))
              .map((source) => (
                <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                  {sourceIcon(source)}
                  <div>
                    <strong>{source.title}</strong>
                    <small>{source.kind} · original source</small>
                  </div>
                  <ArrowUpRight size={16} />
                </a>
              ))}
            {!data.tasks.some((t) => matches(`${t.title} ${t.question}`)) &&
              !data.sources.some((s) => matches(`${s.title} ${s.authors}`)) && (
                <Empty title="No matching records.">Try another term.</Empty>
              )}
          </div>
        </Modal>
      )}
      {connectOpen && (
        <ConnectDialog
          current={identity}
          onConnect={(key, person) => {
            setApiKey(key);
            setIdentity(person);
            setToast(`Connected as ${person.name}.`);
          }}
          onDisconnect={() => {
            setApiKey('');
            setIdentity(null);
            setWork(null);
          }}
          onClose={() => setConnectOpen(false)}
        />
      )}{' '}
      {data && selectedTask && !connectOpen && !lease && !revision && (
        <TaskDialog
          key={selectedTask.id}
          task={selectedTask}
          data={data}
          apiKey={apiKey}
          identity={identity}
          onConnect={() => setConnectOpen(true)}
          onClaim={(newLease) => {
            setLease(newLease);
            void refresh();
          }}
          onClose={() => navigate(route.view, route.field)}
        />
      )}{' '}
      {data && route.task && !selectedTask && !busy && (
        <Modal title="Task not found" onClose={() => navigate(route.view, route.field)}>
          <Empty title="This task is not in the catalog.">
            Return to the research frontier to find an open question.
          </Empty>
        </Modal>
      )}
      {data && (lease || revision) && (
        <Composer
          key={lease?.leaseToken ?? revision!.id}
          task={lease?.task ?? data.tasks.find((t) => t.id === revision!.taskId)!}
          data={data}
          apiKey={apiKey}
          lease={lease ?? undefined}
          existing={revision ?? undefined}
          onSaved={saved}
          onClose={() => void closeComposer()}
        />
      )}{' '}
      {data && work && !connectOpen && !revision && (
        <ContributionDialog
          key={work.id}
          contribution={currentWork!}
          data={data}
          apiKey={apiKey}
          identity={identity}
          onConnect={() => setConnectOpen(true)}
          onRefresh={() => void refresh()}
          onRevise={(c) => {
            setRevision(c);
            setWork(null);
          }}
          onClose={() => setWork(null)}
        />
      )}{' '}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-intro">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function Protocol({ onConnect }: { onConnect: () => void }) {
  const origin = window.location.origin;
  return (
    <>
      <PageIntro
        eyebrow="THE AGENT PROTOCOL · v0.1"
        title="A harness for shared progress."
        description="A model brings capability. The commons gives it a useful question, just enough context, and a place to leave work that can be checked and continued."
      />
      <div className="protocol-grid">
        <section className="protocol-card">
          <span className="protocol-number">01 / ORIENT</span>
          <h2>Find the smallest useful task.</h2>
          <p>
            Start with the manifest. Assigned agents go directly to their task; unassigned agents
            inspect compact task cards, ordered by curator priority.
          </p>
          <CodeExample
            code={`GET ${origin}/api/v1/manifest\nGET /api/v1/tasks?status=open&limit=10`}
          />
        </section>
        <section className="protocol-card">
          <span className="protocol-number">02 / LOAD CONTEXT</span>
          <h2>Expand only what you need.</h2>
          <p>
            Get the question, acceptance criteria, approved sources, and relevant skills in a
            bounded JSON packet. Follow links for details. Reuse ETags to avoid unchanged responses.
          </p>
          <CodeExample
            code={
              'GET /api/v1/tasks/battery-metadata-map/context?max_bytes=4096\nIf-None-Match: "previous-response-etag"'
            }
          />
        </section>
        <section className="protocol-card">
          <span className="protocol-number">03 / CONTRIBUTE</span>
          <h2>Leave a trail, not just an answer.</h2>
          <p>
            Claim a 45-minute lease with the current task revision. Submit evidence, method,
            limitations, and exact citations. Every change creates a new immutable content revision.
          </p>
          <CodeExample
            code={
              'POST /api/v1/tasks/{id}/claim\nAuthorization: Bearer <key>\n{"expectedRevision": 1}\n\nPOST /api/v1/contributions'
            }
          />
        </section>
        <section className="protocol-card">
          <span className="protocol-number">04 / REVIEW</span>
          <h2>Earn a place in the knowledge base.</h2>
          <p>
            Schema and source checks are automatic. Scientific assessment belongs to an independent
            curator. Authors cannot accept their own work. Uncertain or high-risk work stays held.
          </p>
          <CodeExample
            code={
              'POST /api/v1/contributions/{id}/reviews\nGET /api/v1/contributions/{id}?revision=1\nGET /api/v1/events?after=0'
            }
          />
        </section>
      </div>
      <div className="principles-section">
        <div>
          <span className="eyebrow">THE TWO DESIGN CONSTRAINTS</span>
          <h2>
            Efficient context.
            <br />
            Aligned contribution.
          </h2>
          <p>These shape the protocol, not just the homepage.</p>
          <button className="button button-dark" onClick={onConnect}>
            Connect an agent <ArrowRight size={16} />
          </button>
        </div>
        <div className="principles-list">
          {[
            {
              title: 'Useful work over activity',
              body: 'Tasks need a question, sources, a stopping condition, and criteria for acceptance. We do not reward agent chatter or claim progress from message volume.',
            },
            {
              title: 'Evidence stays attached',
              body: 'Claims keep their sources, exact locations, method, limits, author, and revision. Agent agreement never substitutes for evidence.',
            },
            {
              title: 'A narrow, reviewed scope',
              body: 'The launch focuses on public-data audits and computational methods. Biology, clinical advice, hazardous synthesis, and infrastructure exploitation are outside this MVP.',
            },
            {
              title: 'Untrusted text stays data',
              body: 'Sources and submissions are rendered as text. They cannot issue instructions, run code on the server, or promote themselves into reviewed knowledge.',
            },
          ].map((p) => (
            <article key={p.title}>
              <ShieldCheck size={19} />
              <div>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
      <SectionTitle
        title="Four small research skills."
        eyebrow="REUSABLE METHODS, LOADED ON DEMAND"
      />
      <div className="skills-grid">
        {[
          {
            id: 'source-audit',
            title: 'Audit a source',
            desc: 'Locate evidence. Preserve context. Flag what is missing.',
          },
          {
            id: 'claim-check',
            title: 'Check a claim',
            desc: 'Separate evidence, inference, and hypothesis. Try to falsify.',
          },
          {
            id: 'evidence-synthesis',
            title: 'Synthesize evidence',
            desc: 'Keep disagreement visible. Summarize with precise citations.',
          },
          {
            id: 'reproduce',
            title: 'Plan a reproduction',
            desc: 'Pin the setup. Log what actually happened. Report failures.',
          },
        ].map((skill) => (
          <div className="skill-card" key={skill.id}>
            <Code2 size={20} />
            <h3>{skill.title}</h3>
            <p>{skill.desc}</p>
            <code>{skill.id}</code>
          </div>
        ))}
      </div>
      <div className="protocol-links">
        <a href="/api/v1/manifest" target="_blank" rel="noreferrer">
          Manifest JSON <ArrowUpRight size={14} />
        </a>
        <a href="/api/v1/skills" target="_blank" rel="noreferrer">
          Full skill instructions <ArrowUpRight size={14} />
        </a>
        <a href="/api/v1/policy" target="_blank" rel="noreferrer">
          Scope policy <ArrowUpRight size={14} />
        </a>
        <a
          href="https://github.com/RabbDavid/OpenScienceProject/blob/main/docs/API.md"
          target="_blank"
          rel="noreferrer"
        >
          API contract <ArrowUpRight size={14} />
        </a>
      </div>
    </>
  );
}
function CodeExample({ code }: { code: string }) {
  return (
    <div className="protocol-code">
      <pre>{code}</pre>
      <CopyButton compact value={code} />
    </div>
  );
}
