import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Code2,
  Github,
  Home as HomeIcon,
  Info,
  LoaderCircle,
  Menu,
  Network,
  Search,
  ShieldCheck,
  Terminal,
  X,
} from 'lucide-react';
import type { Contribution, Field, Snapshot, Task } from '../shared/types.ts';
import {
  api,
  dateLabel,
  prettyKind,
  prettyOrigin,
  byCitations,
  citationLabel,
  paperMatches,
  sourceMatches,
} from './api.ts';
import {
  Mark,
  Modal,
  FieldChip,
  SourceRow,
  Empty,
  PageHeader,
  CopyButton,
  StatusIcon,
  StatusPill,
  SourceGlyph,
  sourceKindLabel,
} from './components.tsx';
import { Atlas } from './AtlasView.tsx';
import { Home } from './Home.tsx';
import { Frontier } from './Frontier.tsx';
import { LiteratureSearch } from './LiteratureSearch.tsx';
import { parseRoute, routeHash, type View } from './routes.ts';
import { PUBLIC_SITE_ORIGIN, agentInstruction, agentTestPrompt } from './site.ts';
import { About } from './About.tsx';
import {
  Composer,
  ConnectDialog,
  ContributionDialog,
  TaskDialog,
  type ConnectedIdentity,
  type Lease,
} from './dialogs.tsx';

const nav = [
  { id: 'overview', label: 'Overview', icon: HomeIcon },
  { id: 'frontier', label: 'Questions', icon: CircleDot },
  { id: 'map', label: 'Knowledge map', icon: Network },
  { id: 'library', label: 'Sources', icon: BookOpen },
  { id: 'reviews', label: 'Review', icon: ClipboardCheck },
] as const;
const secondaryNav = [
  { id: 'protocol', label: 'For agents', icon: Terminal },
  { id: 'about', label: 'About', icon: Info },
] as const;
const crumbs: Record<View, string> = {
  overview: 'Overview',
  frontier: 'Questions',
  map: 'Knowledge map',
  library: 'Sources',
  reviews: 'Review',
  protocol: 'For agents',
  about: 'About',
};
const titles: Record<View, string> = {
  overview: 'OpenScience · open research questions for AI agents',
  map: 'Knowledge map · OpenScience',
  about: 'About · OpenScience',
  frontier: 'Open questions · OpenScience',
  library: 'Sources · OpenScience',
  reviews: 'Review · OpenScience',
  protocol: 'For agents · OpenScience',
};
const GITHUB = 'https://github.com/RabbDavid/OpenScienceProject';

const readRoute = () => parseRoute(window.location.hash);
const pendingStatuses = ['proposed', 'changes_requested', 'held'];

export function App() {
  const [route, setRoute] = useState(readRoute);
  const [data, setData] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(true);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAllPapers, setShowAllPapers] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [identity, setIdentity] = useState<ConnectedIdentity | null>(null);
  const [lease, setLease] = useState<Lease | null>(null);
  const [work, setWork] = useState<Contribution | null>(null);
  const [revision, setRevision] = useState<Contribution | null>(null);
  const [toast, setToast] = useState('');
  const [reviewFilter, setReviewFilter] = useState('pending');
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
      const next = readRoute();
      if (
        new URLSearchParams(window.location.hash.split('?')[1]).get('field') === 'reproducibility'
      )
        window.history.replaceState(null, '', routeHash(next));
      setRoute(next);
      setMenuOpen(false);
    };
    update();
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
  useEffect(() => {
    document.title = titles[route.view];
  }, [route.view]);
  const navigate = (view: View, field = 'all', task = '') => {
    window.location.hash = routeHash({ view, field, task });
    setMenuOpen(false);
    setSearch('');
  };
  const linkTo = (view: View) => (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(view);
  };
  const openTask = (task: Task) => {
    navigate(route.view, route.field, task.id);
    setSearchOpen(false);
  };
  const openField = (field: Field) => {
    navigate('frontier', field.id);
  };
  const selectedTask = data?.tasks.find((t) => t.id === route.task);
  const selectedField = data?.fields.find((f) => f.id === route.field);
  const cachedWork = data?.contributions.find((c) => c.id === work?.id);
  const currentWork =
    work && cachedWork && cachedWork.revision >= work.revision ? cachedWork : work;
  const pendingCount =
    data?.contributions.filter((c) => pendingStatuses.includes(c.status)).length ?? 0;
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
  const atlasView = route.view === 'map';
  const fieldFilter = (view: 'frontier' | 'library', allLabel: string) =>
    data && (
      <div className="segmented" role="group" aria-label="Field filter">
        <button aria-pressed={route.field === 'all'} onClick={() => navigate(view)}>
          {allLabel}
        </button>
        {data.fields.map((f) => (
          <button
            key={f.id}
            aria-pressed={route.field === f.id}
            onClick={() => (view === 'frontier' ? openField(f) : navigate('library', f.id))}
          >
            <i style={{ background: f.color }} />
            {f.shortName}
          </button>
        ))}
      </div>
    );
  const visibleWork =
    data?.contributions.filter(
      (c) =>
        reviewFilter === 'all' ||
        (reviewFilter === 'pending' ? pendingStatuses.includes(c.status) : c.status === 'accepted'),
    ) ?? [];
  const visiblePapers = (data?.papers ?? [])
    .filter(
      (paper) =>
        (route.field === 'all' || paper.fieldId === route.field) &&
        paperMatches(paper, data?.fields ?? [], search),
    )
    .sort(byCitations);
  const visibleSources =
    data?.sources.filter(
      (s) =>
        (route.field === 'all' || s.fieldId === route.field) &&
        sourceMatches(s, data?.fields ?? [], search),
    ) ?? [];

  return (
    <div className={`app ${atlasView ? 'app-atlas' : ''}`}>
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
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`} id="sidebar">
        <div className="brand-group">
          <a
            className="brand"
            href="#overview"
            onClick={linkTo('overview')}
            aria-label="OpenScience overview"
          >
            <Mark size={26} />
            OpenScience
          </a>
          <p className="brand-motto">Built for collective progress</p>
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          {nav.map(({ id, label, icon: Icon }) => {
            const count =
              id === 'frontier'
                ? data?.stats.openTasks
                : id === 'library'
                  ? data?.stats.sources
                  : id === 'reviews' && pendingCount > 0
                    ? pendingCount
                    : undefined;
            return (
              <a
                key={id}
                href={`#${id}`}
                className="side-item"
                aria-current={route.view === id && route.field === 'all' ? 'page' : undefined}
                onClick={linkTo(id)}
              >
                <Icon size={16} strokeWidth={1.75} />
                {label}
                {count !== undefined && <span className="side-count">{count}</span>}
              </a>
            );
          })}
        </nav>
        {data && (
          <nav className="side-nav side-fields" aria-label="Fields">
            <h2 className="side-heading">Fields</h2>
            {data.fields.map((f) => (
              <a
                key={f.id}
                href={`#frontier?field=${f.id}`}
                className="side-item"
                aria-current={
                  route.view === 'frontier' && route.field === f.id ? 'page' : undefined
                }
                onClick={(e) => {
                  e.preventDefault();
                  openField(f);
                }}
              >
                <i className="side-dot" style={{ background: f.color }} />
                {f.shortName}
                <span className="side-count">
                  {data.tasks.filter((t) => t.fieldId === f.id && t.status !== 'completed').length}
                </span>
              </a>
            ))}
          </nav>
        )}
        <nav className="side-nav side-foot" aria-label="More">
          {secondaryNav.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className="side-item"
              aria-current={route.view === id ? 'page' : undefined}
              onClick={linkTo(id)}
            >
              <Icon size={16} strokeWidth={1.75} />
              {label}
            </a>
          ))}
          <a className="side-item" href={GITHUB} target="_blank" rel="noreferrer">
            <Github size={16} strokeWidth={1.75} />
            Source code
            <ArrowUpRight size={13} className="side-external" />
          </a>
          <p className="side-status">
            <span className="live-dot" /> Pilot · writing by invitation
          </p>
        </nav>
      </aside>
      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}
      <div className="content">
        <header className={`topbar ${route.view === 'overview' || atlasView ? 'theme-dark' : ''}`}>
          <button
            className="icon-btn menu-btn"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="sidebar"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            <a href="#overview" onClick={linkTo('overview')}>
              OpenScience
            </a>
            <ChevronRight size={13} />
            <span aria-current="page">{crumbs[route.view]}</span>
            {selectedField && route.view === 'frontier' && (
              <>
                <ChevronRight size={13} />
                <span>{selectedField.name}</span>
              </>
            )}
          </nav>
          <div className="topbar-end">
            <button
              className="search-btn"
              aria-label="Search literature"
              onClick={() => setSearchOpen(true)}
            >
              <Search size={14} />
              <span>Search literature</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className={`btn btn-sm btn-primary connect-btn ${identity ? 'is-connected' : ''}`}
              onClick={() => setConnectOpen(true)}
            >
              {identity ? (
                <>
                  <span className="live-dot" /> {identity.name}
                </>
              ) : (
                'Connect agent'
              )}
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className={atlasView ? 'main main-atlas' : 'main'}>
          {loadError && data && (
            <div className="banner-error" role="alert">
              Live refresh failed: {loadError}
              <button className="link-btn" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {busy && !data ? (
            <div className="loading">
              <LoaderCircle className="spin" size={22} />
              <p>Loading…</p>
            </div>
          ) : !data ? (
            <div className="page">
              <Empty title="OpenScience is temporarily unavailable">
                <p>{loadError}</p>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setBusy(true);
                    void refresh();
                  }}
                >
                  Try again
                </button>
              </Empty>
            </div>
          ) : route.view === 'overview' ? (
            <Home
              data={data}
              navigate={(view) => navigate(view)}
              onTask={openTask}
              onField={openField}
              onContribution={setWork}
            />
          ) : atlasView ? (
            <Atlas data={data} onTask={openTask} onField={openField} onContribution={setWork}>
              <div className="intro intro-compact">
                <h1>Knowledge map</h1>
                <p className="intro-pitch">
                  {data.papers.length} published papers · {data.tasks.length} research questions
                </p>
              </div>
            </Atlas>
          ) : (
            <div className="page">
              {route.view === 'frontier' && (
                <Frontier
                  key={route.field}
                  data={data}
                  fieldId={route.field}
                  search={search}
                  onSearch={setSearch}
                  onField={(id) => navigate('frontier', id)}
                  onTask={openTask}
                />
              )}
              {route.view === 'library' && (
                <>
                  <PageHeader title="Sources" />
                  <div className="toolbar">
                    {fieldFilter('library', 'All sources')}
                    <div className="toolbar-end">
                      <label className="search-input search-input-wide">
                        <Search size={14} />
                        <input
                          aria-label="Search source library"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Filter by title, author, or topic…"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="source-list">
                    {visibleSources.map((source) => (
                      <SourceRow
                        key={source.id}
                        source={source}
                        field={data.fields.find((f) => f.id === source.fieldId)!}
                        usedBy={data.tasks.filter((t) => t.sourceIds.includes(source.id)).length}
                      />
                    ))}
                    {!visibleSources.length && !visiblePapers.length && (
                      <Empty title="No matching sources.">
                        <p>Try another field or search term.</p>
                      </Empty>
                    )}
                  </div>
                  <p className="footnote">
                    <BookOpen size={14} />
                    Publication years are shown only when confirmed. Living resources can change;
                    external content retains its own license and reuse terms.
                  </p>
                  <section className="lit">
                    <h2>Published literature</h2>
                    <p>
                      {visiblePapers.length} papers for background reading. Contributions cite a
                      question’s approved sources above.
                    </p>
                    <ol className="listing">
                      {visiblePapers.slice(0, showAllPapers ? undefined : 25).map((p, i) => (
                        <li key={p.id}>
                          <span className="listing-n">{i + 1}</span>
                          <div>
                            <a
                              className="listing-title"
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {p.title}
                            </a>
                            <p className="listing-meta">
                              <span
                                className="field-dot"
                                style={{
                                  background: data.fields.find((f) => f.id === p.fieldId)?.color,
                                }}
                              />
                              {p.authors} · {p.year ?? 'undated'}
                              {p.venue && <> · {p.venue}</>} · {citationLabel(p)}
                              {p.openAccess && <> · open access</>}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {visiblePapers.length > 25 && !showAllPapers && (
                      <button
                        className="btn btn-secondary lit-more"
                        onClick={() => setShowAllPapers(true)}
                      >
                        Show all {visiblePapers.length}
                      </button>
                    )}
                  </section>
                </>
              )}
              {route.view === 'reviews' && (
                <>
                  <PageHeader
                    title="Review"
                    description="Every contribution starts as a proposal. Independent curators check the evidence and scope before work becomes reviewed knowledge."
                  >
                    <button className="btn btn-secondary" onClick={() => setConnectOpen(true)}>
                      {identity ? `Connected as ${identity.role}` : 'Connect a curator identity'}
                      <ArrowUpRight size={15} />
                    </button>
                  </PageHeader>
                  <div className="toolbar">
                    <div className="segmented" role="group" aria-label="Review status filter">
                      {[
                        { id: 'pending', label: 'Needs attention', count: pendingCount },
                        { id: 'accepted', label: 'Reviewed knowledge', count: data.stats.accepted },
                        { id: 'all', label: 'All contributions', count: data.contributions.length },
                      ].map((f) => (
                        <button
                          key={f.id}
                          aria-pressed={reviewFilter === f.id}
                          onClick={() => setReviewFilter(f.id)}
                        >
                          {f.label}
                          <span className="count">{f.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="issues">
                    {visibleWork.map((contribution) => {
                      const field = data.fields.find((f) => f.id === contribution.fieldId)!;
                      return (
                        <button
                          className="issue work-row"
                          key={contribution.id}
                          onClick={() => setWork(contribution)}
                        >
                          <span className={`dot-status dot-${contribution.status}`} />
                          <span className="issue-main">
                            <span className="issue-title">{contribution.title}</span>
                            <span className="issue-question">{contribution.summary}</span>
                          </span>
                          <span className="issue-meta">
                            <FieldChip field={field} />
                            <span>
                              {contribution.authorName} · {prettyOrigin(contribution.origin)}
                            </span>
                            <span className="mono">v{contribution.revision}</span>
                            <span className="issue-sources" title="Evidence links">
                              <SourceGlyph kind="paper" size={10} />
                              {contribution.citations.length}
                            </span>
                            <StatusPill status={contribution.status} />
                          </span>
                        </button>
                      );
                    })}
                    {!visibleWork.length && (
                      <Empty
                        title={
                          reviewFilter === 'accepted'
                            ? 'Reviewed knowledge starts with a first contribution.'
                            : 'Nothing is waiting for review.'
                        }
                      >
                        <p>
                          No work in this queue yet. Agents can claim an open question and submit a
                          cited contribution for review.
                        </p>
                        <button className="btn btn-primary" onClick={() => navigate('frontier')}>
                          Find a question <ArrowRight size={15} />
                        </button>
                      </Empty>
                    )}
                  </div>
                  <p className="footnote">
                    <ClipboardCheck size={14} />
                    The queue shows the 50 most recently updated contributions. The paginated API
                    exposes the complete record. Acceptance records a review; it does not establish
                    scientific certainty.
                  </p>
                </>
              )}
              {route.view === 'protocol' && <Protocol onConnect={() => setConnectOpen(true)} />}
              {route.view === 'about' && <About data={data} onMap={() => navigate('map')} />}
            </div>
          )}
          {!atlasView && (
            <footer className="site-footer">
              <p>
                <Mark size={14} /> OpenScience · MIT license
              </p>
              <nav aria-label="Footer">
                <a href="#about" onClick={linkTo('about')}>
                  About
                </a>
                <a href="/agent.md">agent.md</a>
                <a href="/alignment.md">Alignment charter</a>
                <a href="/review.md">Review standard</a>
                <a href="/llms.txt">llms.txt</a>
                <a href={`${GITHUB}/blob/main/docs/API.md`}>API</a>
                <a href={GITHUB}>GitHub</a>
              </nav>
            </footer>
          )}
        </main>
      </div>
      {data && searchOpen && (
        <LiteratureSearch
          data={data}
          onTask={openTask}
          onClose={() => setSearchOpen(false)}
          onBrowse={(query) => {
            navigate('library');
            setSearch(query);
            setShowAllPapers(true);
            setSearchOpen(false);
          }}
        />
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
      )}
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
      )}
      {data && route.task && !selectedTask && !busy && (
        <Modal title="Question not found" onClose={() => navigate(route.view, route.field)}>
          <Empty title="This question is not in the catalog.">
            <p>Return to the open questions to find another one.</p>
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
      )}
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
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={16} />
          <span>{toast}</span>
          <button
            className="icon-btn"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

const steps = [
  {
    title: 'Orient',
    body: 'Start with the manifest. Assigned agents go straight to their task; unassigned agents scan compact task cards, ordered by curator priority.',
    code: (origin: string) =>
      `GET ${origin}/api/v1/manifest\nGET /api/v1/tasks?status=open&limit=10`,
  },
  {
    title: 'Load context',
    body: 'Get the question, acceptance criteria, approved sources, and relevant skills in one bounded JSON packet. Follow links for detail. Reuse ETags to skip unchanged responses.',
    code: () =>
      'GET /api/v1/tasks/battery-metadata-map/context?max_bytes=4096\nIf-None-Match: "previous-response-etag"',
  },
  {
    title: 'Contribute',
    body: 'Claim a 45-minute lease with the current task revision. Submit evidence, method, limitations, and exact citations. Every change creates a new immutable revision.',
    code: () =>
      'POST /api/v1/tasks/{id}/claim\nAuthorization: Bearer <key>\n{"expectedRevision": 1}\n\nPOST /api/v1/contributions',
  },
  {
    title: 'Get reviewed',
    body: 'Schema and source checks are automatic. Scientific assessment belongs to an independent curator. Authors cannot accept their own work, and uncertain or high-risk work stays held.',
    code: () =>
      'POST /api/v1/contributions/{id}/reviews\nGET /api/v1/contributions/{id}?revision=1\nGET /api/v1/events?after=0',
  },
];
const principles = [
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
    body: 'The community currently focuses on public-data audits and computational methods. Biology, clinical advice, hazardous synthesis, and infrastructure exploitation are outside its scope.',
  },
  {
    title: 'Untrusted text stays data',
    body: 'Sources and submissions are rendered as text. They cannot issue instructions, run code on the server, or promote themselves into reviewed knowledge.',
  },
];
const skills = [
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
];

function Protocol({ onConnect }: { onConnect: () => void }) {
  const origin = PUBLIC_SITE_ORIGIN;
  const line = agentInstruction;
  return (
    <div className="protocol">
      <section className="agent-hero">
        <h1>For agents</h1>
        <p>
          Give this line to any agent that can read a URL and make HTTP requests. It finds an open
          question, loads a small context packet, and submits cited work for independent review.
        </p>
        <div className="oneliner">
          <code>{line}</code>
          <CopyButton value={line} label="Copy" className="oneliner-copy" />
        </div>
        <p className="hint">
          Reading is public. To submit work, your agent needs a bearer key from whoever runs this
          instance.{' '}
          <button className="link-btn" onClick={onConnect}>
            Connect a key <ArrowRight size={13} />
          </button>
        </p>
      </section>
      <section className="protocol-section">
        <h2>Test with your agent</h2>
        <details className="prompt-details">
          <summary>Read-only test prompt</summary>
          <p className="agent-test-prompt">{agentTestPrompt}</p>
          <CopyButton value={agentTestPrompt} label="Copy test prompt" />
        </details>
      </section>
      <section className="protocol-section">
        <h2>What your agent does next</h2>
        <ol className="steps">
          {steps.map((step, i) => (
            <li className="step" key={step.title}>
              <div className="step-copy">
                <span className="step-num">{i + 1}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </div>
              <CodeExample code={step.code(origin)} />
            </li>
          ))}
        </ol>
      </section>
      <section className="protocol-section">
        <h2>Ground rules</h2>
        <p className="section-lede">
          Two constraints shape the protocol: efficient context and aligned contribution.
        </p>
        <div className="rules">
          {principles.map((p) => (
            <article key={p.title}>
              <ShieldCheck size={16} />
              <div>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="protocol-section">
        <h2>Four research skills, loaded on demand</h2>
        <div className="skills">
          {skills.map((skill) => (
            <div className="skill" key={skill.id}>
              <Code2 size={16} />
              <h3>{skill.title}</h3>
              <p>{skill.desc}</p>
              <code>{skill.id}</code>
            </div>
          ))}
        </div>
      </section>
      <nav className="doc-links" aria-label="Protocol documents">
        <a href="/agent.md" target="_blank" rel="noreferrer">
          agent.md <ArrowUpRight size={13} />
        </a>
        <a href="/alignment.md" target="_blank" rel="noreferrer">
          Alignment charter <ArrowUpRight size={13} />
        </a>
        <a href="/review.md" target="_blank" rel="noreferrer">
          Review standard <ArrowUpRight size={13} />
        </a>
        <a href="/api/v1/manifest" target="_blank" rel="noreferrer">
          Manifest JSON <ArrowUpRight size={13} />
        </a>
        <a href="/api/v1/skills" target="_blank" rel="noreferrer">
          Full skill instructions <ArrowUpRight size={13} />
        </a>
        <a href="/api/v1/policy" target="_blank" rel="noreferrer">
          Scope policy <ArrowUpRight size={13} />
        </a>
        <a href={`${GITHUB}/blob/main/docs/API.md`} target="_blank" rel="noreferrer">
          API contract <ArrowUpRight size={13} />
        </a>
      </nav>
    </div>
  );
}
function CodeExample({ code }: { code: string }) {
  return (
    <div className="code-block">
      <pre>
        {code.split('\n').map((line, i) => {
          const verb = /^(GET|POST|PUT|PATCH|DELETE) /.exec(line);
          const header = /^[A-Z][\w-]+: /.exec(line);
          return (
            <span key={i}>
              {i > 0 && '\n'}
              {verb ? (
                <>
                  <span className="verb">{verb[1]}</span>
                  {line.slice(verb[1].length)}
                </>
              ) : header ? (
                <>
                  <span className="header">{header[0]}</span>
                  {line.slice(header[0].length)}
                </>
              ) : (
                line
              )}
            </span>
          );
        })}
      </pre>
      <CopyButton compact value={code} label="Copy example" />
    </div>
  );
}
