# DeviceTrail

*Trace the evidence. Document the decision.*

Follow the evidence from a complaint through investigation, human review, and reporting handoff. The cohort demo includes three fictional Demo-P1 pump cases.

[Clinical workspace preview](docs/clinical-overview.jpg) · [Investigation workflow](docs/investigation-workflow.jpg) · [Historical case context](docs/historical-context.jpg) · [Monitoring dashboard](docs/monitoring-dashboard.jpg) · [Evaluation metrics](docs/eval-dashboard.jpg)

## Run locally

Use Node.js 22 or later, Python 3.12 and [uv](https://docs.astral.sh/uv/). From this directory, open two terminals.

```sh
uv sync --locked --python 3.12
uv run --no-sync uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

```sh
cd web
npm ci
npm run dev -- --hostname 127.0.0.1
```

Open http://127.0.0.1:3000. FastAPI's interactive API is at http://127.0.0.1:8000/docs. Next.js proxies API requests to FastAPI. Set `DEVICETRAIL_BACKEND_URL` before starting or building the UI if FastAPI runs on a different port. Run one backend process with its own writable state directory.

## Walk through the demo

1. Load **Low battery** from Overview and start an investigation. Open the event log and manual citations. The 4% charge and BAT-LOW alarm support a possible explanation. The stop reason and battery health remain unconfirmed.
2. Load **Motor fault**. Compare the reporter's battery suspicion with the logged 80% charge and MOTOR_FAULT stop reason. Open the versioned manual passage. The underlying cause remains unconfirmed. Enter a reviewer name and rationale to approve the summary wording.
3. Load **Missing evidence**. Request records in Human review, add a reviewer evidence note, and run again. Reviewer notes appear as separately labeled evidence. The scenario's fixture-backed log lookup still reports unavailable records and the cause stays undetermined.
4. Filter the queue by status. Search for BAT-LOW or MOTOR FAULT in the RAG explorer. Run the Evaluation Lab suite and inspect each result against the claim-support rubric. Open Monitoring for measured run latency and trace links when configured.

## Workflow and integrations

- FastAPI writes case state, review history and run records to SQLite. A separate SQLite checkpointer persists LangGraph runs at the human review interrupt. Approving a summary resumes that run. Adding evidence invalidates the current draft and opens a new revision. Version checks reject stale actions.
- LangChain indexes the supplied fictional manual and SOP chunks using local token embeddings and cosine search, followed by a configurable OpenAI reranker or the local alarm-match fallback. Incident logs and the evaluator answer key stay outside the index. The checked-in sources are already split into versioned sections.
- The default draft is deterministic. For optional OpenAI follow-up prioritization and reference reranking, copy `.env.example` to `.env`, set `OPENAI_API_KEY` and `OPENAI_MODEL` to a model available to your project with Responses API structured output, and restart FastAPI. The follow-up model returns a permutation of three proposed requests. The separate rerank step orders reference passages before the draft is built. Evidence wording, cause status and review transitions remain controlled by the application. See the [OpenAI text generation guide](https://developers.openai.com/api/docs/guides/text).
- For LangSmith, set `LANGSMITH_API_KEY`, `LANGSMITH_TRACING=true` and `LANGSMITH_PROJECT`, then restart FastAPI. Run a case for traces and use **Run LangSmith experiment** in the lab to create or reuse the three-example dataset and run the structured checks. See [LangSmith evaluations](https://docs.langchain.com/langsmith/evaluate-llm-application).
- The eight offline checks cover cause status, citations, reference retrieval, historical matches and references, historical citation isolation, the human-review flag, and missing-evidence routing. Claim support has a separate human-readable rubric. This three-case suite is a smoke test.

The demo accepts fictional inputs only. Reviewer names are entered locally for the demo audit trail. Summary approval covers wording. Regulatory decisions remain outside the demo and belong to authorized humans. Keep this single-user application on loopback.

`DEVICETRAIL_STATE_DIR` selects a separate case and checkpoint database directory for each cohort or verification run.

## Complaint to reporting

Open **Workflow map** for the high-level sequence, the tool and model boundaries, and the three scenario paths. In **Case workspace**, review the evidence and approve the current investigation summary. Then open **Reporting handoff** and record a separate human disposition with a reviewer name and rationale.

- **Low battery** demonstrates an unconfirmed cause. Review the BAT-LOW log and manual. To exercise the no-report branch, record a fictional human decision and rationale after approving the draft.
- **Motor fault** demonstrates a logged stop reason with an unconfirmed underlying cause. Review the log and manual, approve the wording, and choose **Prepare report for external filing** to exercise the reporting branch. The demo creates a cited handoff from the approved draft. Enter a fictional reference such as `SIM-001` to demonstrate recording a receipt.
- **Missing evidence** demonstrates the follow-up loop. Request evidence in Case Workspace, or record **Request more information** in Reporting handoff after reviewing a partial draft. Add an evidence note and rerun. A new evidence revision clears the active approval and disposition while retaining the previous reporting audit history.

These are suggested demonstration branches. The pump scenario does not select a reporting outcome. The app prepares a local handoff record and logs a simulated receipt. Authorized personnel own external submission. Reviewer names are self-entered in this single-user demo.

The design document describes a broader QMS workflow with model-based intake extraction, severity and reportability recommendations, and independent claim verification. The cohort rebuild retains fixture-based tool calls, deterministic findings and citation-ID checks, and the optional OpenAI follow-up ranking call. The Reporting handoff uses application writes after a human decision.

### Show a live model call in the demo

Create `.env` in the project root using `.env.example` as a template. Set `OPENAI_API_KEY` locally and set `OPENAI_MODEL` to an available model that supports Responses API structured output. Restart FastAPI, then start a **new** Motor fault investigation with fictional data. In **Case Workspace**, open **OpenAI follow-up ranking** above Human review to see the model and response ID, evidence, retrieved manual passage, original candidate order, returned indices, and ranked requests. A run without a captured response says so in the panel.

### Model roles and human selection

**Workflow map** explains the proposed extractor, triage reasoner, verifier, embedding model and reranker across all three pump cases. The running demo ranks follow-ups using OpenAI when configured and labels the preset ordering as evidence rules otherwise. In **Case Workspace → Human review**, select any proposed follow-up and record your rationale. The case moves to **Needs information**, and review history stores the request, its rank and its origin. A reviewer can also write a separate evidence request or escalate. Recording a follow-up does not send it externally or make a reporting decision.

### Compare reference reranking

Open **RAG explorer → Load motor-fault comparison query → Search and rerank**. Compare the original cosine ranking with the final order. The same retrieval pipeline runs in a new case, where **Reference retrieval and reranking** shows the candidates and the selected order. The first passage feeds the investigation draft.

Set `OPENAI_API_KEY` and `OPENAI_RERANK_MODEL` in the project-root `.env` to enable the model-based reranker. The model must support Responses API Structured Outputs. If `OPENAI_RERANK_MODEL` is unset, the app uses `OPENAI_MODEL`, which also enables the separate follow-up-ranking call. Restart FastAPI after changing these values. A missing configuration, provider error, or invalid candidate permutation uses local alarm-match ranking, and the app labels which path ran. The preset motor-fault comparison query intentionally mixes battery terms with the alarm code so the local ranking change is visible.

The overview's fictional infusion-pump illustration is stored in `web/public/clinical-pump.jpg`. The rest of the workspace uses the same clinical-blue color and typography theme.


## Historical case context and evals

The synthetic closed-case source in `backend/data/historical_cases.json` includes issue, resolution, closure date, and a simulated historical compliance item when one exists. The motor-fault scenario matches two closed cases with different past reporting outcomes. Historical context is never a finding or a reporting decision for the current case.

- LangGraph calls incident lookup, reference retrieval, and the historical lookup in parallel. The historical tool matches device model and scenario. Case Workspace shows the matched records separately from cited evidence. The optional follow-up model receives that same context.
- RAG Explorer has separate **Manuals and procedures** and **Closed historical cases** scopes over the LangChain in-memory index. When enabled, OpenAI reranks candidates within the selected scope. Investigation citations still use the current evidence and reference corpus.
- Reporting handoff snapshots the historical context in a separate section after a human chooses to prepare a handoff. A historical simulated reference is distinct from the current simulated receipt.
- **Offline evals** run eight checks per golden fixture, including matched history, expected historical report references, and historical citation isolation. The optional hosted LangSmith dataset uses a new version name.
- **Online evals** automatically score saved review, disposition, and receipt actions. They check reviewer attribution, resolving citation IDs, matching selected follow-ups, and linking handoffs and receipts to the right decisions. Results are persisted in SQLite and visible in Evaluation Lab. Monitoring shows per-run matches and eval counts. These checks cover workflow integrity. Semantic claim support remains a human rubric.

## Monitoring dashboard

Open **Monitoring** for a snapshot of local activity. It shows complaint counts by scenario and status, quality flags, current reporting handoffs and simulated receipts, fictional closed-case counts by issue, and historical simulated filing references. It also shows all saved investigation runs, failures, median duration, and OpenAI rerank usage. The recent-runs table shows up to 100 entries and includes configured trace links.

**Evaluation health** shows the latest completed local offline suite, its fully passed checks, and the cumulative checks from saved online reviewer actions. Use **Open Evaluation Lab** to run the offline suite. Offline summaries start accumulating with this version. An empty workspace shows unavailable scores until checks have run.
