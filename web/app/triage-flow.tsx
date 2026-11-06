const examples = [
  { title: 'Low battery', finding: '4% charge and BAT-LOW before the stop', reference: 'Battery alarm guidance', review: 'Confirm power and stop reason. Low charge is a possible explanation.' },
  { title: 'Motor fault', finding: '80% charge and MOTOR_FAULT at shutdown', reference: 'Drive-system alarm guidance', review: 'Preserve the diagnostic log. The immediate stop reason is logged and the underlying cause remains open.' },
  { title: 'Missing evidence', finding: 'No incident log, alarm or reading available', reference: 'Missing-evidence procedure', review: 'Request the missing records. Add evidence and rerun. Cause stays undetermined.' },
];

const modelRoles = [
  {
    role: 'Intake extractor',
    contract: 'Small, fast model (Haiku-class). Schema-constrained JSON. Temperature 0 where supported.',
    low: 'Capture the reported stop and restart. Keep the reporter’s battery suspicion separate from observed symptoms.',
    motor: 'Capture the reported motor fault and restart. Preserve the battery suspicion as a reported statement.',
    missing: 'Capture the reported stop. Keep event time, patient outcome, alarm and battery reading unknown.',
  },
  {
    role: 'Triage reasoner',
    contract: 'Sonnet-class default. Opus-class for complex flagged cases. Cited structured output and extended reasoning where supported.',
    low: 'Assess the stop against the SOP and device risk context. Treat 4% and BAT-LOW as evidence of low charge. Ask for power and stop records.',
    motor: 'Use 80% and the logged MOTOR_FAULT to explain the immediate stop. Keep the underlying cause open and propose preserving the log.',
    missing: 'Abstain when the evidence cannot support a finding. Recommend obtaining event time, alarm details and device logs.',
  },
  {
    role: 'Verifier',
    contract: 'Independent model or prompt. Binary support verdict for each claim, alongside citation-ID checks.',
    low: 'Check the log supports low charge before the stop. Flag an unsupported defective-battery claim.',
    motor: 'Check the log supports the stop reason and the manual explains the alarm. Flag claims about the failed component or battery health.',
    missing: 'Check that the lookup supports unavailable records. Flag invented readings or claims that no event was logged.',
  },
  {
    role: 'Embedding model',
    contract: 'Versioned domain-capable embeddings. Rebuild the index when the embedding model changes.',
    low: 'Retrieve the versioned battery alarm section for a low-charge query.',
    motor: 'Retrieve the drive-system alarm section for a motor-fault query.',
    missing: 'Retrieve the evidence-gap SOP for incomplete incident records.',
  },
  {
    role: 'Reranker',
    contract: 'Cross-encoder or LLM. Proposed production shortlist of up to 20 candidates, returning the 5–8 best supported matches.',
    low: 'Prioritize applicable battery-alarm and power-source guidance.',
    motor: 'Prioritize the exact MOTOR_FAULT manual passage over battery guidance.',
    missing: 'Prioritize the evidence-gap procedure over alarm-specific passages.',
  },
];

export default function TriageFlow() {
  return <>
    <section className="panel">
      <h2>Complaint to reporting</h2>
      <ol className="triage-flow">
        <li><strong>Capture the complaint</strong><p>Preserve the narrative, channel and receipt time. Validate the selected pump case.</p><span className="badge">Intake · application rules</span></li>
        <li><strong>Gather evidence in parallel</strong><p>Look up the incident record by scenario. Search the versioned manual and procedure for the alarm or evidence gap.</p><span className="badge">Tool calls · incident lookup + RAG</span></li>
        <li><strong>Draft and verify</strong><p>Evidence rules produce the finding. If configured, OpenAI ranks three proposed follow-ups. The workflow checks that citation IDs resolve.</p><span className="badge">Optional model call · follow-up ranking</span></li>
        <li><strong>Pause for review</strong><p>Quality reviews the evidence, approves or revises the draft, or requests more information and reruns with the new evidence.</p><span className="badge">Human gate · investigation draft</span></li>
        <li><strong>Record a reporting disposition</strong><p>A person records the decision and rationale. Choosing Prepare report creates a cited handoff. An external filing reference can be recorded afterward.</p><span className="badge">Human decision · application write</span></li>
      </ol>
    </section>
    <div className="scenario-grid">{examples.map(item => <section className="panel" key={item.title}><h2>{item.title}</h2><p><strong>Incident lookup</strong><br />{item.finding}</p><p><strong>RAG</strong><br />{item.reference}</p><p><strong>Review</strong><br />{item.review}</p></section>)}</div>
    <section className="panel">
      <h2>Model roles across the three cases</h2>
      <p><strong>Proposed model layer.</strong> Route uncertain or potentially serious cases to human review. The triage reasoner recommends severity and possible reportability using applicable rules. The authorized reviewer records the decision.</p>
      <div className="table-wrap"><table><thead><tr><th>Role and settings</th><th>Low battery</th><th>Motor fault</th><th>Missing evidence</th></tr></thead>
        <tbody>{modelRoles.map(item => <tr key={item.role}><th scope="row">{item.role}<small>{item.contract}</small></th><td>{item.low}</td><td>{item.motor}</td><td>{item.missing}</td></tr>)}</tbody>
      </table></div>
      <p><strong>Running cohort app.</strong> Scenario fields and evidence rules replace model extraction and triage. LangChain uses local token vectors for candidate retrieval. OpenAI can rerank the passages, with exact alarm-code priority as the local fallback. The verifier checks citation IDs. When configured, OpenAI ranks the three proposed evidence requests.</p>
      <p>In <strong>Human review</strong>, select any ranked follow-up and record your rationale, or write your own request, revise the draft, or escalate. The selected request and its origin are recorded in review history. Reporting disposition is a separate human action.</p>
    </section>
    <section className="panel"><h2>Evaluate the workflow separately</h2><p>Evaluation Lab replays all three scenarios against an evaluator-only answer key and checks cause status, references, citations, the review flag and missing-evidence routing.</p></section>
  </>;
}
