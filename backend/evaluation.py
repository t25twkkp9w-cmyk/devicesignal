import hashlib
import json
import os

from langsmith import Client, traceable

from .workflow import DATA, FIXTURES, build_graph

GRAPH = build_graph()
EXPECTED = json.loads((DATA / "evaluator_only_expected_results.json").read_text())


def golden_snapshot(feedback):
    overrides = {entry["scenario"]: entry["expected_top_followup"] for entry in feedback}
    return [{**row, "expected_top_followup": overrides.get(row["case_id"], row["expected_top_followup"])}
            for row in EXPECTED]


def examples(snapshot):
    for expected in snapshot:
        case_id = expected["case_id"]
        yield {
            "inputs": {"scenario": case_id},
            "outputs": expected,
        }


@traceable(name="DeviceTrail eval target")
def target(inputs):
    scenario = inputs["scenario"]
    case = {"scenario": scenario, "complaint": FIXTURES[scenario]["complaint"], "added_evidence": []}
    return GRAPH.invoke({"case": case})["draft"]


def checks(outputs, reference_outputs):
    expected = reference_outputs
    actual = outputs
    required = set(expected["required_evidence_ids"])
    return [
        {"key": "cause_status", "score": int(actual["cause_status"] == expected["expected_cause_status"])},
        {"key": "citation_coverage", "score": len(required & set(actual["citations"])) / len(required)},
        {"key": "reference_retrieval", "score": int(set(actual["reference_ids"]) == {key for key in required if key.startswith(("MAN-", "SOP-"))})},
        {"key": "human_gate", "score": int(actual["human_review_required"] and expected["human_review_required"])},
        {"key": "historical_case_match", "score": int(set(actual["history_ids"]) == set(expected["expected_history_ids"]))},
        {"key": "historical_report_refs", "score": int(set(actual["historical_report_refs"]) == set(expected["expected_history_report_refs"]))},
        {"key": "historical_citation_isolation", "score": int(not (set(actual["history_ids"]) & set(actual["citations"])))},
        {"key": "top_followup_matches_golden", "score": int(
            bool(actual["followups"]) and actual["followups"][0] == expected["expected_top_followup"]
        )},
        {"key": "missing_evidence_route", "score": int(actual["needs_information"] == (expected["expected_cause_status"] == "undetermined"))},
    ]


def evaluate_local(snapshot=EXPECTED):
    results = []
    for example in examples(snapshot):
        actual = target(example["inputs"])
        expected = example["outputs"]
        results.append({"actual": actual, "expected": expected, "checks": checks(actual, expected)})
    return results


def publish_experiment(snapshot=EXPECTED):
    client = Client()
    fingerprint = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()[:12]
    base = os.getenv("LANGSMITH_DATASET", "DeviceTrail · Demo-P1 v3")
    name = f"{base} · {fingerprint}"
    if not client.has_dataset(dataset_name=name):
        dataset = client.create_dataset(name, description="Three synthetic pump investigation scenarios")
        client.create_examples(dataset_id=dataset.id, examples=list(examples(snapshot)))
    experiment = client.evaluate(
        target, data=name, evaluators=[checks], experiment_prefix="devicetrail", max_concurrency=1
    )
    return experiment.experiment_name
