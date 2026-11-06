export type RankedReference = { source_id: string; document_id: string; section: string; version: string; text: string; score: number };

export type RetrievalRanking = {
  query: string;
  mode: 'openai' | 'alarm_rules' | 'vector_only';
  model: string | null;
  response_id: string | null;
  fallback: string | null;
  before: RankedReference[];
  after: RankedReference[];
};

export default function RankingComparison({ ranking }: { ranking: RetrievalRanking }) {
  const columns = [
    { label: 'Before · Cosine similarity', rows: ranking.before },
    { label: 'After · Relevance ranking', rows: ranking.after },
  ];

  return <div className="ranking-comparison">
    <div className="ranking-meta">
      <strong>{ranking.mode === 'openai' ? 'OpenAI reranker · ' + ranking.model : ranking.mode === 'vector_only' ? 'Local cosine ranking' : 'Local alarm-match ranking'}</strong>
      {ranking.response_id && <span className="mono">{ranking.response_id}</span>}
      <p>{ranking.fallback === 'provider_error' ? 'The model call failed or returned an invalid order. Local ranking was used.' :
        ranking.fallback === 'not_configured' ? 'Configure an OpenAI key and rerank model to enable model ranking.' :
        ranking.fallback === 'no_comparison_needed' ? 'There were too few candidates to rerank.' :
        'The model ordered the retrieved passages. Cosine scores are from the first pass.'}</p>
    </div>
    <div className="split">
      {columns.map(({ label, rows }) =>
        <div key={label} className="ranking-list"><h3>{label}</h3>
          <ol>{rows.map(row => <li key={row.source_id}>
            <strong>{row.section}</strong><span className="mono">{row.score.toFixed(3)}</span>
          </li>)}</ol>
        </div>
      )}
    </div>
  </div>;
}
