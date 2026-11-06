def evaluate_action(case, event, entry):
    """Score saved case actions without a golden label or additional model call."""
    draft = case.get("draft")
    checks = {"reviewer_attributed": bool(entry.get("reviewer") and entry.get("at"))}
    if draft:
        available = {row["evidence_id"] for row in case.get("evidence", [])}
        available.update(row["source_id"] for row in case.get("sources", []))
        checks["citations_resolve"] = bool(draft["citations"]) and set(draft["citations"]) <= available
        checks["historical_citation_isolation"] = not (set(draft.get("history_ids", [])) & set(draft["citations"]))
    if event == "use_followup":
        choice = entry["selected_followup"]
        index = choice["rank"] - 1
        checks["followup_matches_draft"] = (
            0 <= index < len(draft["followups"]) and draft["followups"][index] == choice["request"]
        )
    if event == "disposition":
        approved = case["approved_summary"]
        checks["approved_draft_linked"] = entry["draft_version"] == approved["review"]["draft_version"]
        report = case.get("report")
        checks["handoff_matches_decision"] = bool(report) == (entry["decision"] == "prepare_report")
        if report:
            checks["handoff_preserves_citations"] = report["citations"] == approved["draft"]["citations"]
    if event == "filing_receipt":
        checks["receipt_linked_to_handoff"] = entry["report_id"] == case["report"]["id"]
    return [{"key": key, "score": int(passed)} for key, passed in checks.items()]
