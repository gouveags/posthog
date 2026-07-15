import pytest
from unittest.mock import patch

from posthog.temporal.ai_observability.eval_reports.types import (
    CheckCountTriggeredEvalReportOutput,
    CheckCountTriggeredEvalReportsBatchOutput,
)
from posthog.temporal.ai_observability.eval_reports.workflow import (
    _check_count_triggered_eval_report_candidates,
    _check_count_triggered_eval_report_candidates_batched,
)


@pytest.mark.asyncio
async def test_count_triggered_report_check_continues_after_activity_failure() -> None:
    checked_report_ids: list[str] = []
    skipped_reasons = {
        "cooldown": "cooldown",
        "daily_cap": "daily_cap",
        "not_deliverable": "not_deliverable",
    }

    async def fake_execute_activity(_activity, inputs, **_kwargs):
        checked_report_ids.append(inputs.report_id)
        if inputs.report_id == "failed":
            raise RuntimeError("clickhouse at capacity")
        return CheckCountTriggeredEvalReportOutput(
            report_id=inputs.report_id,
            due=inputs.report_id == "due",
            skipped_reason=skipped_reasons.get(inputs.report_id),
        )

    with (
        patch(
            "posthog.temporal.ai_observability.eval_reports.workflow.temporalio.workflow.execute_activity",
            new=fake_execute_activity,
        ),
        patch("posthog.temporal.ai_observability.eval_reports.workflow.record_coordinator_reports_found") as record,
        patch("posthog.temporal.ai_observability.eval_reports.workflow.temporalio.workflow.logger") as logger,
    ):
        report_ids = await _check_count_triggered_eval_report_candidates(
            ["due", "failed", "not_due", "cooldown", "daily_cap", "not_deliverable"]
        )

    assert report_ids == ["due"]
    assert checked_report_ids == ["due", "failed", "not_due", "cooldown", "daily_cap", "not_deliverable"]
    record.assert_called_once_with(1, "count_triggered")
    logger.warning.assert_called_once()
    assert logger.warning.call_args.args == ("count_triggered_eval_report_check.activity_errors",)
    assert logger.warning.call_args.kwargs["extra"]["failed_count"] == 1
    logger.info.assert_called_once_with(
        "llma_eval_reports_coordinator_count_triggered_poll",
        extra={
            "reports_found": 1,
            "total_checked": 6,
            "skipped_cooldown": 1,
            "skipped_daily_cap": 1,
            "skipped_not_deliverable": 1,
        },
    )


@pytest.mark.asyncio
async def test_batched_count_check_aggregates_across_batches_and_isolates_batch_failure() -> None:
    # One failing batch activity must not sink the others: every report in it is recorded as
    # failed, while due/skipped reports from the surviving batch still aggregate correctly.
    async def fake_execute_activity(_activity, inputs, **_kwargs):
        if any(report_id.startswith("boom") for report_id in inputs.report_ids):
            raise RuntimeError("clickhouse at capacity")
        return CheckCountTriggeredEvalReportsBatchOutput(
            results=[
                CheckCountTriggeredEvalReportOutput(
                    report_id=report_id,
                    due=report_id == "due",
                    skipped_reason="cooldown" if report_id == "skip" else None,
                )
                for report_id in inputs.report_ids
            ]
        )

    with (
        patch(
            "posthog.temporal.ai_observability.eval_reports.workflow.temporalio.workflow.execute_activity",
            new=fake_execute_activity,
        ),
        # Force two activity batches so we exercise cross-batch aggregation and per-batch failure.
        patch("posthog.temporal.ai_observability.eval_reports.workflow.COUNT_TRIGGER_REPORTS_PER_ACTIVITY", 2),
        patch("posthog.temporal.ai_observability.eval_reports.workflow.record_coordinator_reports_found") as record,
        patch("posthog.temporal.ai_observability.eval_reports.workflow.temporalio.workflow.logger") as logger,
    ):
        report_ids = await _check_count_triggered_eval_report_candidates_batched(["due", "skip", "boom1", "boom2"])

    assert report_ids == ["due"]
    record.assert_called_once_with(1, "count_triggered")
    logger.warning.assert_called_once()
    assert logger.warning.call_args.kwargs["extra"]["failed_count"] == 2
    logger.info.assert_called_once_with(
        "llma_eval_reports_coordinator_count_triggered_poll",
        extra={
            "reports_found": 1,
            "total_checked": 4,
            "skipped_cooldown": 1,
            "skipped_daily_cap": 0,
            "skipped_not_deliverable": 0,
        },
    )
