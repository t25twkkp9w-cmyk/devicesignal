import json
import os

from langsmith import Client, traceable

from .workflow import DATA, FIXTURES, build_graph

GRAPH = build_graph()
EXPECTED = json.loads((DATA / "evaluator_only_expected_results.json").read_text())


def examples():
    for expected in EXPECTED:
        case_id = expected["case_id"]
        yield {
            "inputs": {"scenario": case_id},
            "outputs": expected,
        }


@traceable(name="MDR Sentinel eval target")
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
        {"key": "missing_evidence_route", "score": int(actual["needs_information"] == (expected["expected_cause_status"] == "undetermined"))},
    ]


def evaluate_local():
    results = []
    for example in examples():
        actual = target(example["inputs"])
        expected = example["outputs"]
        results.append({"actual": actual, "expected": expected, "checks": checks(actual, expected)})
    return results


def publish_experiment():
    client = Client()
    name = os.getenv("LANGSMITH_DATASET", "MDR Sentinel · Demo-P1 v1")
    if not client.has_dataset(dataset_name=name):
        dataset = client.create_dataset(name, description="Three synthetic pump investigation scenarios")
        client.create_examples(dataset_id=dataset.id, examples=list(examples()))
    experiment = client.evaluate(
        target, data=name, evaluators=[checks], experiment_prefix="mdr-sentinel", max_concurrency=1
    )
    return experiment.experiment_name
