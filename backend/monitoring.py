from collections import Counter
from statistics import median


def summarize_checks(checks):
    return {"checks": len(checks), "passed": sum(item["score"] == 1 for item in checks)}


def build_dashboard(cases, runs, online_evals, offline_suites, history, labels):
    statuses = Counter(case["status"] for case in cases)
    scenarios = Counter(case["scenario"] for case in cases)
    history_counts = Counter(row["scenario"] for row in history)
    history_report_counts = Counter(row["scenario"] for row in history if row["compliance"]["reference"])
    reports = [case["report"] for case in cases if case.get("report")]
    latencies = [run["duration_ms"] for run in runs if run.get("duration_ms") is not None]
    return {
        "complaints": {
            "total": len(cases),
            "by_status": dict(statuses),
            "by_scenario": [{"label": label, "count": scenarios[key]} for key, label in labels.items()],
            "quality_flags": sum(bool(case.get("urgent")) for case in cases),
            "handoffs": len(reports),
            "simulated_receipts": sum(bool(report.get("receipt")) for report in reports),
        },
        "history": {
            "total": len(history),
            "with_reference": sum(history_report_counts.values()),
            "by_scenario": [{"label": label, "count": history_counts[key], "with_reference": history_report_counts[key]}
                            for key, label in labels.items()],
        },
        "investigations": {
            "total": len(runs),
            "failed": sum(run["status"] == "failed" for run in runs),
            "median_latency_ms": round(median(latencies), 1) if latencies else None,
            "openai_reranks": sum(run.get("rerank_mode") == "openai" for run in runs),
        },
        "evals": {
            "offline_suites": len(offline_suites),
            "latest_offline": offline_suites[0] if offline_suites else None,
            "online_actions": len(online_evals),
            "online_checks": summarize_checks([check for action in online_evals for check in action["checks"]]),
        },
    }
