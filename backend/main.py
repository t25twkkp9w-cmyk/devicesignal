import json
import logging
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from time import perf_counter
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import FastAPI, Header, HTTPException, Query
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from langsmith import get_current_run_tree, traceable
from pydantic import BaseModel, Field, StringConstraints

from .evaluation import evaluate_local, publish_experiment
from .online_evaluation import evaluate_action
from .monitoring import build_dashboard, summarize_checks
from .workflow import FIXTURES, HISTORY, HISTORY_REFERENCES, REFERENCES, build_graph, configured_reranker, rank_references, search

ROOT = Path(os.getenv("DEVICETRAIL_STATE_DIR") or os.getenv("MDR_STATE_DIR", ".state"))
ROOT.mkdir(parents=True, exist_ok=True)
LOCK = RLock()
checkpoint_db = sqlite3.connect(ROOT / "checkpoints.sqlite", check_same_thread=False)
GRAPH = build_graph(SqliteSaver(checkpoint_db))
app = FastAPI(title="DeviceTrail")
LABELS = {"DEMO-001": "Low battery", "DEMO-002": "Motor fault", "DEMO-003": "Missing evidence"}
Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
Narrative = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


@contextmanager
def db():
    with LOCK:
        connection = sqlite3.connect(ROOT / "cases.sqlite")
        try:
            with connection:
                yield connection
        finally:
            connection.close()


with db() as connection:
    connection.execute("CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
    connection.execute("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, body TEXT NOT NULL)")
    connection.execute("""CREATE TABLE IF NOT EXISTS online_evals (
        id TEXT PRIMARY KEY, run_id TEXT, body TEXT NOT NULL
    )""")
    connection.execute("CREATE INDEX IF NOT EXISTS online_evals_run ON online_evals(run_id)")
    connection.execute("CREATE TABLE IF NOT EXISTS offline_eval_suites (id TEXT PRIMARY KEY, body TEXT NOT NULL)")


def now():
    return datetime.now(timezone.utc).isoformat()


def save(conn, table, record):
    conn.execute(f"INSERT OR REPLACE INTO {table} VALUES (?, ?)", (record["id"], json.dumps(record)))


def get_case(conn, case_id):
    row = conn.execute("SELECT body FROM cases WHERE id = ?", (case_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Case unavailable.")
    return json.loads(row[0])


def version(case, expected):
    if case["version"] != expected:
        raise HTTPException(409, "Case changed. Refresh and retry.")


def update(conn, case, **changes):
    case.update(changes, version=case["version"] + 1, updated_at=now())
    save(conn, "cases", case)
    return case


def evaluate_saved_action(conn, case, event, entry):
    row = {"id": str(uuid4()), "case_id": case["id"], "case_version": case["version"],
           "run_id": case.get("run_id"), "event": event, "at": entry["at"],
           "checks": evaluate_action(case, event, entry)}
    conn.execute("INSERT INTO online_evals VALUES (?, ?, ?)",
                 (row["id"], row["run_id"], json.dumps(row)))
    return case


class Intake(BaseModel):
    scenario: Literal["DEMO-001", "DEMO-002", "DEMO-003"]
    complaint: Narrative
    channel: Literal["Call center", "Email", "Field service", "Distributor"] = "Field service"
    urgent: bool = False


class ReferenceQuery(BaseModel):
    corpus: Literal["reference", "history"] = "reference"
    query: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


class Version(BaseModel):
    expected_version: int


class Disposition(Version):
    reviewer: Short
    rationale: Narrative
    decision: Literal["prepare_report", "no_report", "more_information"]


class FilingReceipt(Version):
    reviewer: Short
    reference: Short


class Evidence(Version):
    label: Short
    text: Narrative


class Review(Version):
    action: Literal["approve_summary", "request_information", "use_followup", "revise_assessment", "escalate_to_quality"]
    reviewer: Short
    rationale: Narrative
    revision: Narrative | None = None
    followup_index: Annotated[int, Field(ge=0)] | None = None


@app.get("/api/health")
def health():
    return {
        "status": "ok", "rerank_model": configured_reranker(), "model": os.getenv("OPENAI_MODEL") if os.getenv("OPENAI_API_KEY") else None,
        "tracing": bool(os.getenv("LANGSMITH_API_KEY") and os.getenv("LANGSMITH_TRACING", "").lower() == "true"),
        "langsmith_configured": bool(os.getenv("LANGSMITH_API_KEY")),
    }


@app.get("/api/scenarios")
def scenarios():
    return [{"id": key, "label": LABELS[key], **{field: fixture[field] for field in ("complaint", "device", "incident")}}
            for key, fixture in FIXTURES.items()]


@app.get("/api/cases")
def list_cases():
    with db() as conn:
        return [json.loads(row[0]) for row in conn.execute("SELECT body FROM cases ORDER BY rowid DESC")]


@app.get("/api/cases/{case_id}")
def read_case(case_id: str):
    with db() as conn:
        return get_case(conn, case_id)


@app.post("/api/cases", status_code=201)
def create_case(body: Intake):
    fixture = FIXTURES[body.scenario]
    case = {
        "id": f"DS-{uuid4().hex[:8].upper()}", **body.model_dump(),
        "title": LABELS[body.scenario], "device": fixture["device"], "incident": fixture["incident"],
        "version": 1, "status": "draft", "updated_at": now(), "received_at": now(), "added_evidence": [],
        "draft": None, "review_history": [], "run_id": None, "run_keys": {},
    }
    with db() as conn:
        save(conn, "cases", case)
    return case


@traceable(name="DeviceTrail investigation")
def investigate(case, run_id):
    trace = get_current_run_tree()
    result = GRAPH.invoke({"case": case}, config={"configurable": {"thread_id": run_id}})
    if not result.get("__interrupt__"):
        raise RuntimeError("Investigation did not pause at the human review gate.")
    trace_url = None
    if trace:
        try:
            trace_url = trace.get_url()
        except Exception:
            logging.warning("Trace URL unavailable for %s", run_id, exc_info=True)
    return result, trace_url


@app.post("/api/cases/{case_id}/runs")
def run_case(case_id: str, body: Version, idempotency_key: Annotated[str | None, Header(max_length=80)] = None):
    with db() as conn:
        case = get_case(conn, case_id)
        if idempotency_key and idempotency_key in case["run_keys"]:
            return case
        version(case, body.expected_version)
        if case["status"] == "reviewed":
            raise HTTPException(409, "Add evidence to open a new draft revision.")
        run_id = str(uuid4())
        start = perf_counter()
        run = {"id": run_id, "case_id": case_id, "created_at": now(), "trace_url": None, "tokens": None}
        try:
            result, trace_url = investigate(case, run_id)
            draft = result["draft"]
            status = "needs_information" if draft["needs_information"] else "ready_for_review"
            run.update(status=status, trace_url=trace_url, tokens=draft["tokens"], mode=draft["mode"], rerank_mode=result["retrieval"]["mode"],
                       history_ids=draft["history_ids"], historical_report_refs=draft["historical_report_refs"])
            changes = {"draft": draft, "evidence": result["evidence"], "sources": result["sources"], "retrieval": result["retrieval"], "historical_cases": result["historical_cases"], "error": None}
        except Exception:
            logging.exception("Investigation failed (%s)", run_id)
            status = "failed"
            run["status"] = status
            changes = {"draft": None, "historical_cases": None, "retrieval": None, "error": "Investigation failed. Check backend configuration and retry."}
        run["duration_ms"] = round((perf_counter() - start) * 1000)
        if idempotency_key:
            case["run_keys"][idempotency_key] = run_id
        save(conn, "runs", run)
        return update(conn, case, run_id=run_id, status=status, **changes)


@app.post("/api/cases/{case_id}/evidence")
def add_evidence(case_id: str, body: Evidence):
    with db() as conn:
        case = get_case(conn, case_id)
        version(case, body.expected_version)
        item = {"evidence_id": f"NOTE-{uuid4().hex[:8]}", "kind": "reviewer_note", "label": body.label,
                "text": body.text, "location": "Reviewer evidence", "timestamp": now()}
        return update(conn, case, added_evidence=[*case["added_evidence"], item], status="draft", draft=None, retrieval=None, historical_cases=None, approved_summary=None, disposition=None, report=None)


@app.post("/api/cases/{case_id}/review")
def review_case(case_id: str, body: Review):
    with db() as conn:
        case = get_case(conn, case_id)
        version(case, body.expected_version)
        if body.action != "escalate_to_quality" and (
            not case["draft"] or case["status"] not in ("ready_for_review", "needs_information")
        ):
            raise HTTPException(409, "A current draft is required for this review action.")
        if body.action == "revise_assessment" and not body.revision:
            raise HTTPException(422, "Enter revised wording.")
        selected = None
        if body.action == "use_followup":
            options = case["draft"]["followups"]
            index = body.followup_index
            if index is None or index >= len(options):
                raise HTTPException(422, "Select one follow-up from the current draft.")
            selected = {"request": options[index], "rank": index + 1,
                        "origin": "OpenAI ranking" if case["draft"].get("model_call") else "Evidence rules"}
        elif body.followup_index is not None:
            raise HTTPException(422, "Use the selected follow-up action to record a recommendation.")
        entry = {**body.model_dump(exclude={"followup_index"}), "selected_followup": selected,
                 "at": now(), "draft_version": case["version"], "run_id": case["run_id"]}
        changes = {"review_history": [*case["review_history"], entry]}
        if body.action == "escalate_to_quality":
            changes["urgent"] = True
        elif body.action in ("request_information", "use_followup"):
            changes["status"] = "needs_information"
        elif body.action == "revise_assessment":
            changes["draft"] = {**case["draft"], "reviewer_revision": body.revision}
        else:
            config = {"configurable": {"thread_id": case["run_id"]}}
            if GRAPH.get_state(config).next:
                GRAPH.invoke(Command(resume=entry), config=config)
            changes["status"] = "reviewed"
            changes["approved_summary"] = {"draft": case["draft"], "review": entry}
        updated = update(conn, case, **changes)
        return evaluate_saved_action(conn, updated, body.action, entry)


@app.post("/api/cases/{case_id}/disposition")
def record_disposition(case_id: str, body: Disposition):
    with db() as conn:
        case = get_case(conn, case_id)
        version(case, body.expected_version)
        approved = case.get("approved_summary")
        if case["status"] != "reviewed" or not approved or case.get("disposition"):
            raise HTTPException(409, "A current approved draft without a disposition is required.")
        decision = {**body.model_dump(exclude={"expected_version"}), "at": now(),
                    "run_id": case["run_id"], "draft_version": approved["review"]["draft_version"]}
        report = None
        if body.decision == "prepare_report":
            draft = approved["draft"]
            report = {
                "id": f"RPT-{uuid4().hex[:8].upper()}", "case_id": case_id,
                "draft_version": decision["draft_version"], "status": "draft_for_external_filing",
                "device": case["device"], "complaint": case["complaint"], "incident": case["incident"],
                "narrative": draft.get("reviewer_revision") or draft["interpretation"],
                "cause_status": draft["cause_status"], "citations": draft["citations"],
                "historical_context": case.get("historical_cases") or [],
                "decision": decision, "synthetic": True,
            }
        updated = update(conn, case, disposition=decision, report=report,
                      reporting_history=[*case.get("reporting_history", []), {"decision": decision, "report": report}])
        return evaluate_saved_action(conn, updated, "disposition", decision)


@app.post("/api/cases/{case_id}/filing-receipt")
def record_filing_receipt(case_id: str, body: FilingReceipt):
    with db() as conn:
        case = get_case(conn, case_id)
        version(case, body.expected_version)
        report = case.get("report")
        if case["status"] != "reviewed" or not report or report["status"] != "draft_for_external_filing":
            raise HTTPException(409, "A current reporting handoff without a receipt is required.")
        receipt = {**body.model_dump(exclude={"expected_version"}), "at": now(), "report_id": report["id"]}
        report = {**report, "status": "external_receipt_recorded", "receipt": receipt}
        updated = update(conn, case, report=report,
                      reporting_history=[*case.get("reporting_history", []), {"receipt": receipt}])
        return evaluate_saved_action(conn, updated, "filing_receipt", receipt)


@app.get("/api/rag")
def rag(q: str = Query("", max_length=1000)):
    return search(q) if q.strip() else REFERENCES


@app.post("/api/rag/rank")
def rerank_references(body: ReferenceQuery):
    return rank_references(body.query, body.corpus)


@app.get("/api/rag/history")
def history_corpus():
    return HISTORY_REFERENCES


@app.get("/api/evals/online")
def online_evals():
    with db() as conn:
        return [json.loads(row[0]) for row in conn.execute("SELECT body FROM online_evals ORDER BY rowid DESC LIMIT 100")]


@app.get("/api/monitoring")
def monitoring():
    with db() as conn:
        return [{**json.loads(body), "online_eval_count": count} for body, count in conn.execute(
            """SELECT body, (SELECT count(*) FROM online_evals WHERE run_id = runs.id)
               FROM runs ORDER BY rowid DESC LIMIT 100"""
        )]


@app.get("/api/monitoring/dashboard")
def monitoring_dashboard():
    with db() as conn:
        cases = [json.loads(row[0]) for row in conn.execute("SELECT body FROM cases")]
        runs = [json.loads(row[0]) for row in conn.execute("SELECT body FROM runs")]
        online = [json.loads(row[0]) for row in conn.execute("SELECT body FROM online_evals")]
        offline = [json.loads(row[0]) for row in conn.execute("SELECT body FROM offline_eval_suites ORDER BY rowid DESC")]
    return build_dashboard(cases, runs, online, offline, HISTORY, LABELS)


@app.post("/api/evals")
def evals(publish: bool = False):
    if publish and not os.getenv("LANGSMITH_API_KEY"):
        raise HTTPException(400, "Configure LANGSMITH_API_KEY to publish an experiment.")
    try:
        results = evaluate_local()
        checks = summarize_checks([check for result in results for check in result["checks"]])
        with db() as conn:
            save(conn, "offline_eval_suites", {"id": str(uuid4()), "at": now(),
                 "case_count": len(results), **checks})
        return {"results": results, "experiment": publish_experiment() if publish else None}
    except Exception:
        logging.exception("Evaluation failed")
        raise HTTPException(502, "Evaluation failed. Check backend logs and provider configuration.")
