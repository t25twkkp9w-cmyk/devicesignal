export type HistoricalCompliance = { disposition: string; reference: string | null; item: string | null };
export type HistoricalCase = { id: string; model: string; closed_at: string; issue: string; resolution: string; compliance: HistoricalCompliance };

export default function HistoricalContext({ cases }: { cases: HistoricalCase[] }) {
  return <>
    <p className="muted">Fictional closed cases for comparison. Their resolutions and reporting outcomes apply to those cases only.</p>
    {cases.length === 0 && <p className="empty">No historical matches for this investigation.</p>}
    {cases.map(item => <article className="history-record" key={item.id}>
      <div className="history-heading"><strong>{item.issue}</strong><span className="mono">{item.id} · Closed {item.closed_at}</span></div>
      <p><strong>Resolution</strong> · {item.resolution}</p>
      <p><strong>Historical compliance</strong> · {item.compliance.disposition}</p>
      {item.compliance.reference && <p><span className="mono">{item.compliance.reference}</span> · {item.compliance.item}</p>}
    </article>)}
  </>;
}
