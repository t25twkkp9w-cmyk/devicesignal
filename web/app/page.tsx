'use client';

import TriageFlow from './triage-flow';
import RankingComparison, { type RetrievalRanking } from './retrieval-ranking';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Activity, ArrowRight, BookOpen, ClipboardList, FlaskConical, LayoutDashboard, Plus, Search, ShieldCheck, TriangleAlert, Workflow } from 'lucide-react';

type Scenario = { id: string; label: string; complaint: string; device: { device_id: string; model: string }; incident: Incident };
type Incident = { event_date: string; event_time: string | null; battery_percent: number | null; alarm_code: string | null; shutdown_reason: string | null };
type Evidence = { evidence_id: string; label: string; kind: string; location: string; text: string; timestamp: string | null };
type Source = { source_id: string; document_id: string; section: string; version: string; text: string; score?: number };
type ModelCall = {
  model: string; response_id: string | null; instruction: string; reference_id: string; tokens: number | null;
  input: { evidence: Evidence[]; reference: string; followups: string[] };
  output: { order: number[] };
};
type Draft = { model_call?: ModelCall | null; interpretation: string; cause_status: string; citations: string[]; followups: string[]; mode: string; reviewer_revision?: string };
type Review = { action: string; reviewer: string; rationale: string; at: string; draft_version: number; selected_followup?: { request: string; rank: number; origin: string } | null };
type Disposition = { decision: string; reviewer: string; rationale: string; at: string };
type Report = { id: string; status: string; narrative: string; citations: string[]; receipt?: { reviewer: string; reference: string; at: string } };
type Case = { retrieval?: RetrievalRanking | null; disposition?: Disposition | null; report?: Report | null; reporting_history?: { decision?: Disposition; receipt?: Report['receipt'] }[]; id: string; scenario: string; title: string; complaint: string; status: string; version: number; device: Scenario['device']; incident: Incident; urgent: boolean; draft: Draft | null; evidence?: Evidence[]; sources?: Source[]; added_evidence: Evidence[]; updated_at: string; error?: string; review_history: Review[] };
type Run = { id: string; case_id: string; created_at: string; status: string; duration_ms: number; tokens: number | null; trace_url: string | null; mode?: string; rerank_mode?: string };
type Evaluation = { experiment: string | null; results: { actual: Draft; expected: { case_id: string; expected_cause_status: string; must_include: string[]; must_not_claim: string[]; extra_check: string }; checks: { key: string; score: number }[] }[] };
type Health = { model: string | null; tracing: boolean; langsmith_configured: boolean };

const nav = [
  ['overview', 'Overview', LayoutDashboard], ['intake', 'Complaint intake', Plus],
  ['queue', 'Investigation queue', ClipboardList], ['case', 'Case workspace', Workflow],
  ['flow', 'Workflow map', Workflow],
  ['reporting', 'Reporting handoff', ShieldCheck],
  ['rag', 'RAG explorer', BookOpen], ['evals', 'Evaluation lab', FlaskConical],
  ['monitor', 'Monitoring', Activity],
] as const;
type Screen = typeof nav[number][0];
const names: Record<string, string> = {
  draft: 'Draft', ready_for_review: 'Ready for review', needs_information: 'Needs information',
  reviewed: 'Summary approved', failed: 'Run failed', approve_summary: 'Approve summary',
  use_followup: 'Use a recommended follow-up', request_information: 'Write my own evidence request', revise_assessment: 'Revise wording', escalate_to_quality: 'Escalate to quality',
};
const summaries = ['4% charge and BAT-LOW before the reported stop.', '80% charge and a logged MOTOR_FAULT stop reason.', 'Event time, device logs and readings are unavailable.'];

async function api<T>(path: string, body?: object, headers?: Record<string, string>): Promise<T> {
  const response = await fetch('/api' + path, {
    cache: 'no-store',
    ...(body && { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || 'Request failed.'));
  return data;
}

function Badge({ status }: { status: string }) {
  return <span className={'badge ' + status}>{names[status] || status.replaceAll('_', ' ')}</span>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

export default function Home() {
  const [screen, setScreen] = useState<Screen>('overview');
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [cases, setCases] = useState<Case[]>([]);
  const [active, setActive] = useState<Case | null>(null);
  const [health, setHealth] = useState<Health>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [selected, setSelected] = useState('');
  const [complaint, setComplaint] = useState('');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<Source[]>([]);
  const [ranking, setRanking] = useState<RetrievalRanking | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [evaluation, setEvaluation] = useState<Evaluation>();
  const [previous, setPrevious] = useState<Evaluation>();
  const [sourceView, setSourceView] = useState<{ label: string; location: string; text: string } | null>(null);
  const [reviewAction, setReviewAction] = useState('approve_summary');
  const [selectedFollowup, setSelectedFollowup] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const currentScenario = scenarios.find(item => item.id === selected);

  async function task(label: string, work: () => Promise<void>) {
    setError('');
    setNotice('');
    setBusy(label);
    try { await work(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Request failed.'); }
    finally { setBusy(''); }
  }

  async function refresh() {
    const [fixtures, records, status] = await Promise.all([
      api<Scenario[]>('/scenarios'), api<Case[]>('/cases'), api<Health>('/health'),
    ]);
    setScenarios(fixtures);
    setCases(records);
    setHealth(status);
    if (!selected && fixtures.length) choose(fixtures[0]);
  }

  useEffect(() => { void task('Connecting', refresh); }, []); // Load the demo once on mount.

  function choose(scenario: Scenario) {
    setSelected(scenario.id);
    setComplaint(scenario.complaint);
  }

  function open(screen: Screen) {
    setError('');
    setNotice('');
    setScreen(screen);
    if (screen === 'queue' || screen === 'overview' || screen === 'reporting') void task('Refreshing cases', refresh);
    if (screen === 'rag') void task('Loading corpus', async () => {
      setRanking(null);
      setSources(await api<Source[]>('/rag'));
    });
    if (screen === 'monitor') void task('Loading runs', async () => setRuns(await api<Run[]>('/monitoring')));
  }

  function store(record: Case) {
    setActive(record);
    setSelectedFollowup(null);
    setCases(items => [record, ...items.filter(item => item.id !== record.id)]);
  }

  async function run(record: Case) {
    const key = crypto.randomUUID();
    store(await api<Case>('/cases/' + record.id + '/runs', { expected_version: record.version }, { 'Idempotency-Key': key }));
  }

  function submitIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const start = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'start';
    void task(start ? 'Running investigation' : 'Saving case', async () => {
      const record = await api<Case>('/cases', { scenario: selected, complaint, channel: data.get('channel'), urgent: data.has('urgent') });
      store(record);
      setReviewAction('approve_summary');
      setScreen('case');
      if (start) await run(record);
    });
  }

  function submitReview(event: FormEvent<HTMLFormElement>, record: Case) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const form = event.currentTarget;
    void task('Recording review', async () => {
      store(await api<Case>('/cases/' + record.id + '/review', {
        expected_version: record.version, action: reviewAction, reviewer: data.get('reviewer'),
        rationale: data.get('rationale'), revision: data.get('revision'),
        followup_index: reviewAction === 'use_followup' && data.has('followup_index') ? Number(data.get('followup_index')) : null,
      }));
      form.reset();
      setReviewAction('approve_summary');
      setNotice('Reviewer action recorded.');
    });
  }

  function addEvidence(event: FormEvent<HTMLFormElement>, record: Case) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const form = event.currentTarget;
    void task('Saving evidence', async () => {
      store(await api<Case>('/cases/' + record.id + '/evidence', {
        expected_version: record.version, label: data.get('label'), text: data.get('text'),
      }));
      form.reset();
      setNotice('Evidence added. Run the investigation to create a new draft.');
    });
  }

  function submitReporting(event: FormEvent<HTMLFormElement>, record: Case, path: 'disposition' | 'filing-receipt') {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    void task('Saving reporting record', async () => {
      store(await api<Case>('/cases/' + record.id + '/' + path, { ...data, expected_version: record.version }));
      form.reset();
      setNotice('Reporting record saved.');
    });
  }

  const titles: Record<Screen, [string, string]> = {
    overview: ['Investigation overview', 'Explore three synthetic Demo-P1 complaints and follow the evidence through human review.'],
    intake: ['Complaint intake', 'Load a scenario and preserve the reporter’s original narrative.'],
    queue: ['Investigation queue', 'Open a case to inspect its evidence, findings and review history.'],
    case: ['Case workspace', 'Inspect reported facts, incident records and draft findings side by side.'],
    flow: ['Workflow map', 'Follow all three pump examples from intake through the human reporting decision.'],
    reporting: ['Reporting handoff', 'Review dispositions, prepare a handoff record and record a simulated external receipt.'],
    rag: ['RAG explorer', 'Search versioned passages from the fictional Demo-P1 manual and investigation procedure.'],
    evals: ['Evaluation lab', 'Run the three scenarios against a separate evaluator-only answer key.'],
    monitor: ['Monitoring', 'Inspect measured investigation runs and open LangSmith traces when configured.'],
  };

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span><ShieldCheck size={23} /></span><div>DeviceSignal<small>QUALITY & COMPLIANCE</small></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Workspace">{nav.map(([id, label, Icon], index) => <div key={id}>
        {index === 6 && <div className="nav-label tools">TECHNICAL TOOLS</div>}
        <button disabled={!!busy} aria-current={screen === id ? 'page' : undefined} className={screen === id ? 'selected' : ''} onClick={() => open(id)}><Icon size={17} />{label}</button>
      </div>)}</nav>
      <div className="sidebar-note"><span className="dot" /> Cohort demo <small>Fictional pump data</small></div>
    </aside>
    <main>
      <header className="top"><span>Workspace <b>/</b> {nav.find(item => item[0] === screen)?.[1]}</span><span className="demo"><span className="dot" /> DEMO ENVIRONMENT</span></header>
      <div className="content">
        <div className="heading"><div><p className="eyebrow">POST-MARKET QUALITY · DEMO-P1</p><h1>{titles[screen][0]}</h1><p className="muted">{titles[screen][1]}</p></div>
          {screen === 'overview' && <button className="primary" disabled={!!busy} onClick={() => open('intake')}><Plus size={17} /> New complaint</button>}
        </div>
        <div className="safety"><ShieldCheck size={18} /><div><strong>Human review required</strong><span> Synthetic data only. Summary approval covers draft wording. Regulatory decisions belong to authorized humans.</span></div></div>
        {error && <div role="alert" className="alert">{error} <button onClick={() => void task('Refreshing', refresh)} disabled={!!busy}>Reconnect / refresh</button></div>}
        {busy && <div role="status" className="progress"><Activity size={16} /> {busy}…</div>}
        {notice && <div role="status" className="progress">{notice}</div>}

        {screen === 'overview' && <>
          <section className="clinical-hero" aria-label="DeviceSignal quality and compliance">
            <p className="hero-kicker"><Activity size={16} /> MEDICAL DEVICE QUALITY</p>
            <h2>Investigate with evidence.<br />Review with confidence.</h2>
            <p>One workspace for device complaints, cited findings and human-controlled reporting.</p>
            <button onClick={() => open('flow')} disabled={!!busy}>Explore the workflow <ArrowRight size={16} /></button>
          </section>
          <div className="stats">
            {[['Cases in workspace', cases.length], ['Awaiting review', cases.filter(item => item.status === 'ready_for_review').length], ['Needs information', cases.filter(item => item.status === 'needs_information').length], ['Summaries approved', cases.filter(item => item.status === 'reviewed').length]].map(([label, count]) => <div className="stat" key={label}><span>{label}</span><strong>{count}</strong></div>)}
          </div>
          <div className="section-title"><div><h2>Demo scenarios</h2><p className="muted">Choose a starting point for your investigation.</p></div><span className="badge">3 scenarios</span></div>
          <div className="scenario-grid">{scenarios.map((item, index) => <article className="scenario" key={item.id}>
            <div className="scenario-top"><span className={'scenario-icon icon-' + index}>{index === 0 ? <Activity size={21} /> : index === 1 ? <Workflow size={21} /> : <TriangleAlert size={21} />}</span><span className="mono">{item.id}</span></div>
            <h3>{item.label}</h3><p>{summaries[index]}</p><small>{item.device.model} · {item.device.device_id}</small>
            <button disabled={!!busy} onClick={() => { choose(item); open('intake'); }}>Load scenario <ArrowRight size={16} /></button>
          </article>)}</div>
          <Panel title="Investigation flow"><div className="flow">{['Intake', 'Evidence lookup', 'Reference retrieval', 'Cited findings', 'Human review'].map((step, i) => <span key={step}><b>{i + 1}</b>{step}</span>)}</div></Panel>
        </>}

        {screen === 'intake' && <Panel title="Complaint details"><form onSubmit={submitIntake}>
          <div className="form-grid">
            <label>Demo scenario<select value={selected} onChange={e => { const scenario = scenarios.find(item => item.id === e.target.value); if (scenario) choose(scenario); }}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.label} · {item.device.device_id}</option>)}</select></label>
            <label>Source channel<select name="channel">{['Field service', 'Call center', 'Email', 'Distributor'].map(channel => <option key={channel}>{channel}</option>)}</select></label>
          </div>
          {currentScenario && <dl><dt>Device</dt><dd>{currentScenario.device.model} · {currentScenario.device.device_id}</dd><dt>Reported event</dt><dd>{currentScenario.incident.event_date} · {currentScenario.incident.event_time || 'Time unavailable'}</dd><dt>Patient outcome</dt><dd>Unknown</dd></dl>}
          <label>Original complaint<textarea required maxLength={4000} rows={5} value={complaint} onChange={e => setComplaint(e.target.value)} /></label>
          <label className="check"><input type="checkbox" name="urgent" /> Flag for prompt quality review</label>
          <div className="actions"><button disabled={!!busy || !selected}>Save draft</button><button className="primary" value="start" disabled={!!busy || !selected}>Start investigation <ArrowRight size={16} /></button></div>
        </form></Panel>}

        {screen === 'queue' && <Panel title="Cases">
          <label className="filter">Filter by status<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All statuses</option>{['draft','ready_for_review','needs_information','reviewed','failed'].map(key => <option key={key} value={key}>{names[key]}</option>)}</select></label>
          <div className="table-wrap"><table><thead><tr><th>Case</th><th>Scenario / device</th><th>Status</th><th>Review flag</th><th>Updated</th></tr></thead><tbody>
            {cases.filter(item => !filter || item.status === filter).map(item => <tr key={item.id}><td><button className="link mono" disabled={!!busy} onClick={() => void task('Opening case', async () => { store(await api<Case>('/cases/' + item.id)); setReviewAction('approve_summary'); setScreen('case'); })}>{item.id}</button></td><td>{item.title}<small>{item.device.device_id}</small></td><td><Badge status={item.status} /></td><td>{item.urgent ? 'Prompt quality review' : 'Human review'}</td><td>{new Date(item.updated_at).toLocaleString()}</td></tr>)}
          </tbody></table></div>
          {!cases.some(item => !filter || item.status === filter) && <p className="empty">No cases match this view.</p>}
        </Panel>}

        {screen === 'case' && (!active ? <Panel title="Choose a case"><p className="muted">Open an existing case from the queue or create a complaint.</p><button onClick={() => open('queue')}>Open queue <ArrowRight size={16} /></button></Panel> : <>
          <div className="case-header"><div><span className="mono">{active.id} · VERSION {active.version}</span><h2>{active.title}</h2><Badge status={active.status} /></div>
            <div className="actions"><button disabled={!!busy} onClick={() => void task('Refreshing case', async () => store(await api<Case>('/cases/' + active.id)))}>Refresh case</button>{active.status !== 'reviewed' && <button className="primary" disabled={!!busy} onClick={() => void task('Running investigation', () => run(active))}><Activity size={16} />{active.draft ? 'Run again' : 'Run investigation'}</button>}</div></div>
          {active.urgent && <p className="alert">Prompt quality review flagged.</p>}
          {active.error && <p role="alert" className="alert">{active.error}</p>}
          <div className="workspace-grid">
            <Panel title="Complaint & timeline"><p>{active.complaint}</p><dl><dt>Device</dt><dd>{active.device.model} · {active.device.device_id}</dd><dt>Event time</dt><dd>{active.incident.event_time || 'Unavailable'}</dd><dt>Charge</dt><dd>{active.incident.battery_percent === null ? 'Unavailable' : active.incident.battery_percent + '%'}</dd><dt>Alarm</dt><dd>{active.incident.alarm_code || 'Unavailable'}</dd><dt>Stop reason</dt><dd>{active.incident.shutdown_reason || 'Unavailable'}</dd><dt>Patient outcome</dt><dd>Unknown</dd></dl></Panel>
            <Panel title="Evidence & sources">
              {(active.draft ? active.evidence || [] : active.added_evidence).map(item => <button className="source" key={item.evidence_id} onClick={() => setSourceView(item)}><strong>{item.label}</strong><small>{item.location}{item.timestamp && ' · ' + item.timestamp}</small></button>)}
              {active.draft && active.sources?.map(item => <button className="source" key={item.source_id} onClick={() => setSourceView({ label: item.document_id, location: 'v' + item.version + ' · ' + item.section, text: item.text })}><strong>{item.document_id}</strong><small>v{item.version} · {item.section}</small></button>)}
              {!active.draft && <p className="muted">Run the investigation to retrieve case evidence and reference passages.</p>}
            </Panel>
            <Panel title="Draft findings">{active.draft ? <><Badge status={active.draft.cause_status} /><p>{active.draft.interpretation}</p><h3>Citations</h3><div className="citations">{active.draft.citations.map(id => <button className="link mono" key={id} onClick={() => {
              const evidence = active.evidence?.find(item => item.evidence_id === id);
              const source = active.sources?.find(item => item.source_id === id);
              if (evidence) setSourceView(evidence);
              if (source) setSourceView({ label: source.document_id, location: 'v' + source.version + ' · ' + source.section, text: source.text });
            }}>{id}</button>)}</div><h3>Proposed follow-up</h3><ul>{active.draft.followups.map(item => <li key={item}>{item}</li>)}</ul>
              {active.draft.reviewer_revision && <><h3>Reviewer wording</h3><p>{active.draft.reviewer_revision}</p></>}<small className="muted">Drafting mode · {active.draft.mode}</small></> : <p className="muted">A verified draft appears here after investigation.</p>}</Panel>
          </div>
          {active.draft && active.retrieval && <Panel title="Reference retrieval and reranking">
            <p>Query · <code>{active.retrieval.query}</code></p>
            <RankingComparison ranking={active.retrieval} />
          </Panel>}
          {active.draft && <Panel title="OpenAI follow-up ranking">
            {active.draft.model_call ? <>
              <p><strong>{active.draft.model_call.model}</strong>{active.draft.model_call.response_id && <> · <span className="mono">{active.draft.model_call.response_id}</span></>}</p>
              <div className="split">
                <div><h3>Evidence sent to OpenAI</h3>
                  {active.draft.model_call.input.evidence.map(item => <p key={item.evidence_id}><strong>{item.label}</strong><br />{item.text}</p>)}
                  <p><strong>RAG passage · {active.draft.model_call.reference_id}</strong><br />{active.draft.model_call.input.reference}</p>
                  <h3>Candidate requests in input order</h3>
                  <ul>{active.draft.model_call.input.followups.map((item, index) => <li key={item}><span className="mono">{index}</span> · {item}</li>)}</ul>
                </div>
                <div><h3>Ranking returned</h3>
                  <pre>{JSON.stringify(active.draft.model_call.output)}</pre>
                  <ol>{active.draft.followups.map(item => <li key={item}>{item}</li>)}</ol>
                  <p className="muted">This ranking informs follow-up. The cause finding and reporting decision are separate.</p>
                </div>
              </div>
              <details><summary>Inspect model instruction and exact JSON input</summary><p>{active.draft.model_call.instruction}</p>
                <pre className="model-payload">{JSON.stringify(active.draft.model_call.input, null, 2)}</pre></details>
            </> : <p className="muted">This run has no captured OpenAI response. New runs with OpenAI enabled show the evidence and returned ranking here.</p>}
          </Panel>}
          <div className="split">
            <Panel title="Human review"><form key={active.id} onSubmit={event => submitReview(event, active)}>
              <div className="form-grid"><label>Reviewer name<input required name="reviewer" maxLength={160} /></label><label>Action<select value={reviewAction} onChange={e => setReviewAction(e.target.value)}>
                {['approve_summary', 'use_followup', 'request_information', 'revise_assessment', 'escalate_to_quality'].map(key => <option key={key} value={key}>{names[key]}</option>)}</select></label></div>
              {active.draft && active.status !== 'reviewed' && <fieldset className="followup-options">
                <legend>Recommended follow-ups</legend>
                <p className="muted">{active.draft.model_call ? 'Ranked by ' + active.draft.model_call.model : 'Preset recommendations from evidence rules'}. Select one to use it, or choose another review action.</p>
                {active.draft.followups.map((request, index) => <label className="check" key={request}>
                  <input type="radio" name="followup_index" value={index} required={reviewAction === 'use_followup'}
                    checked={reviewAction === 'use_followup' && selectedFollowup === index}
                    onChange={() => { setSelectedFollowup(index); setReviewAction('use_followup'); }} />
                  <span><strong>{index + 1}.</strong> {request}</span>
                </label>)}
              </fieldset>}
              <label>Rationale / requested records<textarea name="rationale" required maxLength={4000} rows={3} /></label>
              {reviewAction === 'revise_assessment' && <label>Revised wording<textarea name="revision" required maxLength={4000} rows={3} /></label>}
              <button className="primary" disabled={!!busy || (reviewAction !== 'escalate_to_quality' && (!active.draft || active.status === 'reviewed'))}>Record review</button>
            </form></Panel>
            <Panel title="Add evidence"><form key={active.id} onSubmit={event => addEvidence(event, active)}><label>Source label<input name="label" required maxLength={160} /></label><label>Evidence note<textarea name="text" required maxLength={4000} rows={3} /></label><button disabled={!!busy}>Save evidence</button></form></Panel>
          </div>
          {active.status === 'reviewed' && <Panel title="Reporting disposition">
            <p>Summary wording has been approved. Record a separate human reporting decision in Reporting handoff.</p>
            <button onClick={() => open('reporting')} disabled={!!busy}>Open reporting handoff <ArrowRight size={16} /></button>
          </Panel>}
          <Panel title="Review history">{active.review_history.length === 0 ? <p className="muted">No human review actions recorded.</p> : active.review_history.map((entry, index) => <div className="record" key={index}><strong>{names[entry.action]} · {entry.reviewer}</strong><small>Version {entry.draft_version} · {new Date(entry.at).toLocaleString()}</small><p>{entry.rationale}</p>{entry.selected_followup && <p><strong>Selected follow-up</strong> · {entry.selected_followup.request} <small>Rank {entry.selected_followup.rank} · {entry.selected_followup.origin}</small></p>}</div>)}</Panel>
        </>)}

        {screen === 'flow' && <TriageFlow />}

        {screen === 'reporting' && <>
          <Panel title="Select a case"><label>Case
            <select value={active?.id || ''} onChange={event => setActive(cases.find(item => item.id === event.target.value) || null)}>
              <option value="">Choose a case</option>
              {cases.map(item => <option key={item.id} value={item.id}>{item.id} · {item.title} · {names[item.status]}</option>)}
            </select>
          </label><p className="muted">Synthetic records only. Filing occurs outside the app. Use a simulated receipt for the demo.</p></Panel>
          {active && <Panel title={active.title + ' · ' + active.id}>
            {active.status !== 'reviewed' && <p className="muted">Approve the current investigation summary in Case Workspace before recording a reporting disposition.</p>}
            {active.status === 'reviewed' && !active.disposition && <form key={active.id} onSubmit={event => submitReporting(event, active, 'disposition')}>
              <div className="form-grid"><label>Compliance reviewer<input name="reviewer" required maxLength={160} /></label>
                <label>Decision<select name="decision" required defaultValue=""><option value="" disabled>Select a decision</option><option value="prepare_report">Prepare report for external filing</option><option value="no_report">Record decision not to report</option><option value="more_information">Request more information</option></select></label></div>
              <label>Decision rationale<textarea name="rationale" required maxLength={4000} rows={3} /></label>
              <button className="primary" disabled={!!busy}>Record human decision</button>
            </form>}
            {active.disposition && <p><strong>{{prepare_report: 'Prepare report', no_report: 'No report', more_information: 'More information required'}[active.disposition.decision]}</strong> · {active.disposition.reviewer}<br />{active.disposition.rationale}</p>}
            {active.disposition?.decision === 'more_information' && <button onClick={() => open('case')}>Return to case to add evidence</button>}
            {active.report && <div className="record">
              <h3>Reporting handoff · {active.report.id}</h3><p>{active.report.narrative}</p>
              <p className="mono">{active.report.citations.join(' · ')}</p>
              {active.report.receipt ? <p>External receipt recorded · {active.report.receipt.reference} · {active.report.receipt.reviewer}</p> :
                <form key={active.report.id} onSubmit={event => submitReporting(event, active, 'filing-receipt')}>
                  <div className="form-grid"><label>Recorded by<input name="reviewer" required maxLength={160} /></label><label>Simulated external reference<input name="reference" required maxLength={160} /></label></div>
                  <button disabled={!!busy}>Record external receipt</button>
                </form>}
            </div>}
            <details><summary>Reporting audit history</summary>
              {(active.reporting_history || []).map((entry, i) => <p key={i}>{entry.decision ? <>{entry.decision.decision.replaceAll('_', ' ')} · {entry.decision.reviewer} · {new Date(entry.decision.at).toLocaleString()}<br />{entry.decision.rationale}</> : entry.receipt ? <>Receipt {entry.receipt.reference} · {entry.receipt.reviewer} · {new Date(entry.receipt.at).toLocaleString()}</> : null}</p>)}
            </details>
          </Panel>}
        </>}

        {screen === 'rag' && <><Panel title="Search reference corpus">
          <form className="search" onSubmit={e => { e.preventDefault(); void task('Retrieving and reranking passages', async () => {
            const result = await api<RetrievalRanking>('/rag/rank', { query });
            setRanking(result);
            setSources(result.after);
          }); }}>
            <label><span className="sr-only">Search query</span><input required value={query} maxLength={1000} onChange={e => setQuery(e.target.value)} placeholder="Try BAT-LOW or MOTOR FAULT" /></label>
            <button className="primary" disabled={!!busy}><Search size={16} /> Search and rerank</button>
          </form>
          <p className="muted">Compare first-pass cosine similarity with the final relevance order.</p>
          <button disabled={!!busy} onClick={() => setQuery('MOTOR_FAULT battery charge external power low reported battery charge')}>Load motor-fault comparison query</button>
          {ranking && <RankingComparison ranking={ranking} />}
        </Panel>
          {sources.map(source => <Panel key={source.source_id} title={source.section}><span className="mono">{source.document_id} · v{source.version}</span>{source.score !== undefined && <span className="badge">Cosine {source.score.toFixed(3)}</span>}<p>{source.text}</p><small className="muted">{source.source_id}</small></Panel>)}</>}

        {screen === 'evals' && <><Panel title="Three-scenario smoke suite"><p>Checks cause status, citation coverage, reference retrieval, the human-review flag and routing for missing evidence. Read the draft against the rubric for claim support.</p><div className="actions">
          <button className="primary" disabled={!!busy} onClick={() => void task('Running local evaluations', async () => { const result = await api<Evaluation>('/evals', {}); setPrevious(evaluation); setEvaluation(result); })}><FlaskConical size={16} /> Run local suite</button>
          <button disabled={!!busy || !health?.langsmith_configured} onClick={() => void task('Publishing LangSmith experiment', async () => { const result = await api<Evaluation>('/evals?publish=true', {}); setPrevious(evaluation); setEvaluation(result); })}>Run LangSmith experiment</button></div>
          {!health?.langsmith_configured && <p className="muted">Set LANGSMITH_API_KEY in the backend to enable experiments.</p>}
          {evaluation?.experiment && <p>LangSmith experiment · {evaluation.experiment}</p>}
          {previous && <p className="muted">Previous suite · {previous.results.flatMap(item => item.checks).filter(check => check.score === 1).length} fully passed checks</p>}
        </Panel>
          {evaluation?.results.map(row => <Panel key={row.expected.case_id} title={row.expected.case_id}><p>Expected cause status <strong>{row.expected.expected_cause_status}</strong> · Actual <strong>{row.actual.cause_status}</strong></p><p>{row.actual.interpretation}</p><div className="checks">{row.checks.map(check => <span className="badge" key={check.key}>{check.key.replaceAll('_', ' ')} · {Math.round(check.score * 100)}%</span>)}</div><details><summary>Read claim-support rubric</summary><p>{row.expected.extra_check}</p><ul>{row.expected.must_include.map(claim => <li key={claim}>{claim}</li>)}</ul><p>Unsupported claims to watch for</p><ul>{row.expected.must_not_claim.map(claim => <li key={claim}>{claim}</li>)}</ul></details></Panel>)}</>}

        {screen === 'monitor' && <Panel title="Investigation runs"><div className="actions"><Badge status={health?.tracing ? 'LangSmith tracing configured' : 'Local metrics'} /><button disabled={!!busy} onClick={() => open('monitor')}>Refresh runs</button></div>
          <div className="table-wrap"><table><thead><tr><th>Run / Case</th><th>Status</th><th>Latency</th><th>Tokens</th><th>Trace</th></tr></thead><tbody>
            {runs.map(run => <tr key={run.id}><td><strong>{run.case_id}</strong><small className="mono">{run.id}</small><small>{new Date(run.created_at).toLocaleString()} · {run.mode || '—'}</small>{run.rerank_mode && <small>Rerank · {run.rerank_mode === 'openai' ? 'OpenAI' : 'Local rules'}</small>}</td><td><Badge status={run.status} /></td><td>{run.duration_ms} ms</td><td>{run.tokens ?? '—'}</td><td>{run.trace_url ? <a href={run.trace_url} target="_blank" rel="noreferrer">Open trace ↗</a> : '—'}</td></tr>)}
          </tbody></table></div>{runs.length === 0 && <p className="empty">Run a case to see its investigation metrics here.</p>}</Panel>}
      </div>
    </main>
    {sourceView && <dialog open className="drawer" aria-label="Evidence detail"><button autoFocus onClick={() => setSourceView(null)}>Close evidence</button><h2>{sourceView.label}</h2><p className="mono">{sourceView.location}</p><p>{sourceView.text}</p></dialog>}
  </div>;
}
