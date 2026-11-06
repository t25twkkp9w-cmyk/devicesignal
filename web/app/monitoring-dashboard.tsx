type Count = { label: string; count: number };
type Score = { checks: number; passed: number };

export type MonitoringStats = {
  complaints: { total: number; by_status: Record<string, number>; by_scenario: Count[]; quality_flags: number; handoffs: number; simulated_receipts: number };
  history: { total: number; with_reference: number; by_scenario: (Count & { with_reference: number })[] };
  investigations: { total: number; failed: number; median_latency_ms: number | null; openai_reranks: number };
  evals: { golden_revision: number; offline_suites: number; latest_offline: (Score & { at: string; case_count: number; golden_revision?: number }) | null; online_actions: number; online_checks: Score };
};

function Metric({ title, value, detail }: { title: string; value: string | number; detail: string }) {
  return <div className="stat monitor-stat"><span>{title}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function Breakdown({ title, rows }: { title: string; rows: Count[] }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return <div className="monitor-breakdown"><h3>{title}</h3>{rows.map(row =>
    <div className="monitor-bar-row" key={row.label}>
      <span>{row.label}</span><strong>{row.count}</strong>
      <div className="monitor-bar" aria-hidden="true"><div style={{ width: `${row.count / max * 100}%` }} /></div>
    </div>
  )}</div>;
}

export default function MonitoringDashboard({ stats }: { stats: MonitoringStats }) {
  const { complaints, history, investigations, evals } = stats;
  const latest = evals.latest_offline;
  const statuses = [
    ['draft', 'Draft'], ['ready_for_review', 'Ready for review'], ['needs_information', 'Needs information'],
    ['reviewed', 'Summary approved'], ['failed', 'Run failed'],
  ];
  return <>
    <section className="panel"><h2>Complaints and reporting</h2>
      <div className="monitor-metrics">
        <Metric title="Complaints" value={complaints.total} detail="All local cases" />
        <Metric title="Quality flags" value={complaints.quality_flags} detail="Marked for prompt review" />
        <Metric title="Reporting handoffs" value={complaints.handoffs} detail="Current case revisions" />
        <Metric title="Simulated receipts" value={complaints.simulated_receipts} detail="Recorded for current handoffs" />
      </div>
      <div className="split">
        <Breakdown title="By status" rows={statuses.map(([id, label]) => ({ label, count: complaints.by_status[id] ?? 0 }))} />
        <Breakdown title="By scenario" rows={complaints.by_scenario} />
      </div>
    </section>
    <section className="panel"><h2>Historical device issues</h2>
      <p className="muted">Fictional closed cases, separate from current complaints and reporting handoffs.</p>
      <div className="monitor-metrics">
        <Metric title="Closed historical cases" value={history.total} detail="All records in the history source" />
        <Metric title="Past filing references" value={history.with_reference} detail="Simulated references on historical cases" />
      </div>
      <div className="table-wrap"><table><thead><tr><th>Issue type</th><th>Closed cases</th><th>With simulated filing reference</th></tr></thead>
        <tbody>{history.by_scenario.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.count}</td><td>{row.with_reference}</td></tr>)}</tbody>
      </table></div>
    </section>
    <section className="panel"><h2>Evaluation health</h2>
      <div className="monitor-metrics">
        <Metric title="Offline checks passed" value={latest ? `${latest.passed} / ${latest.checks}` : '—'}
          detail={latest ? `Latest local suite · Golden revision ${latest.golden_revision ?? "unrecorded"} · ${latest.case_count} cases · ${new Date(latest.at).toLocaleString()}` : 'Run the offline suite in Evaluation Lab'} />
        <Metric title="Golden dataset revision" value={evals.golden_revision} detail="Approved reviewer updates" />
        <Metric title="Offline suites run" value={evals.offline_suites} detail="Completed local replays" />
        <Metric title="Online checks passed" value={evals.online_checks.checks ? `${evals.online_checks.passed} / ${evals.online_checks.checks}` : '—'}
          detail="Checks on saved reviewer actions" />
        <Metric title="Online actions scored" value={evals.online_actions} detail="Reviews, dispositions, and receipts" />
      </div>
    </section>
    <section className="panel"><h2>Investigation performance</h2>
      <div className="monitor-metrics">
        <Metric title="Investigation runs" value={investigations.total} detail="All saved runs" />
        <Metric title="Failed runs" value={investigations.failed} detail="Across all saved runs" />
        <Metric title="Median duration" value={investigations.median_latency_ms == null ? '—' : `${investigations.median_latency_ms} ms`} detail="Includes failed runs" />
        <Metric title="OpenAI reranks" value={investigations.openai_reranks} detail="Runs with a model-ranked reference" />
      </div>
    </section>
  </>;
}
