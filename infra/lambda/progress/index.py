import json
import os
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import unquote

import boto3
from boto3.dynamodb.conditions import Key


ddb = boto3.resource("dynamodb")

MAX_TRIALS_PER_SET = 10


def get_sub(event) -> str | None:
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        return claims.get("sub")
    except Exception:
        return None


def parse_path(event) -> tuple[str, str | None]:
    """Returns (path, trial_id) from the request path."""
    raw_path = event.get("rawPath", "")
    # /progress/trials/{trialId}/complete
    # /progress/trials/{trialId}
    # /progress/trials
    # /progress

    if raw_path.startswith("/progress/trials"):
        parts = raw_path.split("/")
        # ['', 'progress', 'trials', ...]
        if len(parts) >= 4 and parts[3]:
            # URL decode the trialId (e.g., %3A -> :, %2B -> +)
            trial_id = unquote(parts[3])
            if len(parts) >= 5 and parts[4] == "complete":
                return "trial_complete", trial_id
            return "trial", trial_id
        return "trials", None
    return "progress", None


def compute_summary(state: dict, total_questions: int | None = None) -> dict:
    """Compute trial summary from progress state."""
    attempts = state.get("attemptsByQuestionId", {})

    answered = 0
    correct = 0
    incorrect = 0
    unknown = 0
    flagged = 0

    for attempt in attempts.values():
        selected = attempt.get("selectedChoiceIds")
        if selected and len(selected) > 0:
            answered += 1
            is_correct = attempt.get("isCorrect")
            if is_correct is True:
                correct += 1
            elif is_correct is False:
                incorrect += 1
            else:
                unknown += 1
        if attempt.get("flagged"):
            flagged += 1

    graded = correct + incorrect
    # Use Decimal for DynamoDB compatibility
    accuracy_rate = Decimal(str(round((correct / graded) * 100, 1))) if graded > 0 else Decimal("0")

    return {
        "totalQuestions": total_questions or answered,
        "answeredQuestions": answered,
        "correctAnswers": correct,
        "incorrectAnswers": incorrect,
        "unknownAnswers": unknown,
        "accuracyRate": accuracy_rate,
        "flaggedCount": flagged,
        "durationSeconds": None,  # TODO: implement duration tracking
    }


def decimal_to_native(obj):
    """Convert DynamoDB Decimals to native Python types for JSON serialization."""
    if isinstance(obj, Decimal):
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    if isinstance(obj, dict):
        return {k: decimal_to_native(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [decimal_to_native(v) for v in obj]
    return obj


def response(status_code: int, body: dict):
    # Convert Decimals to native types before JSON serialization
    converted_body = decimal_to_native(body)
    return {
        "statusCode": status_code,
        "headers": {"content-type": "application/json; charset=utf-8"},
        "body": json.dumps(converted_body, ensure_ascii=False),
    }


def handler(event, context):
    sub = get_sub(event)
    if not sub:
        return response(401, {"message": "unauthorized"})

    table_name = os.environ.get("PROGRESS_TABLE")
    if not table_name:
        return response(500, {"message": "missing PROGRESS_TABLE env"})

    table = ddb.Table(table_name)

    method = (
        event.get("requestContext", {})
        .get("http", {})
        .get("method", "GET")
        .upper()
    )

    path_type, trial_id = parse_path(event)
    pk = f"USER#{sub}"

    # ========== LEGACY /progress ENDPOINTS (backward compatible) ==========
    if path_type == "progress":
        return handle_legacy_progress(table, pk, sub, method, event)

    # ========== /progress/trials ENDPOINTS ==========
    if path_type == "trials":
        if method == "GET":
            return handle_list_trials(table, pk, event)
        if method == "POST":
            return handle_create_trial(table, pk, event)
        return response(405, {"message": "method not allowed"})

    # ========== /progress/trials/{trialId}/complete ==========
    if path_type == "trial_complete":
        if method == "POST":
            return handle_complete_trial(table, pk, trial_id, event)
        return response(405, {"message": "method not allowed"})

    # ========== /progress/trials/{trialId} ==========
    if path_type == "trial":
        if method == "GET":
            return handle_get_trial(table, pk, trial_id, event)
        if method == "PUT":
            return handle_update_trial(table, pk, trial_id, event)
        if method == "DELETE":
            return handle_delete_trial(table, pk, trial_id, event)
        return response(405, {"message": "method not allowed"})

    return response(404, {"message": "not found"})


def handle_legacy_progress(table, pk: str, sub: str, method: str, event: dict):
    """Handle legacy /progress endpoint for backward compatibility."""
    if method == "GET":
        qs = event.get("queryStringParameters") or {}
        set_id = (qs.get("setId") or "").strip()
        if not set_id:
            return response(400, {"message": "missing setId"})

        # First try to get active trial
        active_sk = f"SET#{set_id}#ACTIVE"
        active_res = table.get_item(Key={"pk": pk, "sk": active_sk}, ConsistentRead=True)
        active_item = active_res.get("Item")

        if active_item and active_item.get("activeTrialId"):
            # Get the active trial's state
            trial_id = active_item["activeTrialId"]
            trial_sk = f"SET#{set_id}#TRIAL#{trial_id}"
            trial_res = table.get_item(Key={"pk": pk, "sk": trial_sk}, ConsistentRead=True)
            trial_item = trial_res.get("Item")

            if trial_item:
                state_json = trial_item.get("stateJson")
                try:
                    state = json.loads(state_json) if isinstance(state_json, str) else None
                except Exception:
                    state = None

                return response(200, {
                    "pk": pk,
                    "sk": f"SET#{set_id}",
                    "setId": set_id,
                    "updatedAt": trial_item.get("updatedAt"),
                    "state": state,
                    "trialId": trial_id,
                    "trialNumber": decimal_to_native(trial_item.get("trialNumber", 1)),
                    "trialStatus": trial_item.get("status", "in_progress"),
                })

        # Fall back to legacy format
        sk = f"SET#{set_id}"
        res = table.get_item(Key={"pk": pk, "sk": sk}, ConsistentRead=True)
        item = res.get("Item")
        if not item:
            return response(404, {"message": "not found"})

        state_json = item.get("stateJson")
        try:
            state = json.loads(state_json) if isinstance(state_json, str) else None
        except Exception:
            state = None

        return response(
            200,
            {
                "pk": pk,
                "sk": sk,
                "setId": set_id,
                "updatedAt": item.get("updatedAt"),
                "state": state,
            },
        )

    if method == "PUT":
        try:
            body = json.loads(event.get("body") or "{}")
        except Exception:
            return response(400, {"message": "invalid json body"})

        set_id = (body.get("setId") or "").strip()
        if not set_id:
            return response(400, {"message": "missing setId"})

        state = body.get("state")
        updated_at = None
        if isinstance(state, dict):
            updated_at = state.get("updatedAt")
        if not isinstance(updated_at, str) or not updated_at:
            updated_at = body.get("updatedAt")
        if not isinstance(updated_at, str) or not updated_at:
            updated_at = datetime.now(timezone.utc).isoformat()

        # Check if there's an active trial
        active_sk = f"SET#{set_id}#ACTIVE"
        active_res = table.get_item(Key={"pk": pk, "sk": active_sk}, ConsistentRead=True)
        active_item = active_res.get("Item")

        if active_item and active_item.get("activeTrialId"):
            # Update the active trial
            trial_id = active_item["activeTrialId"]
            trial_sk = f"SET#{set_id}#TRIAL#{trial_id}"

            # Check if trial is completed
            trial_res = table.get_item(Key={"pk": pk, "sk": trial_sk}, ConsistentRead=True)
            trial_item = trial_res.get("Item")
            if trial_item and trial_item.get("status") == "completed":
                return response(400, {"message": "cannot update completed trial"})

            table.put_item(
                Item={
                    "pk": pk,
                    "sk": trial_sk,
                    "setId": set_id,
                    "trialId": trial_id,
                    "trialNumber": trial_item.get("trialNumber", 1) if trial_item else 1,
                    "status": "in_progress",
                    "startedAt": trial_item.get("startedAt", trial_id) if trial_item else trial_id,
                    "completedAt": None,
                    "updatedAt": updated_at,
                    "stateJson": json.dumps(state, ensure_ascii=False),
                    "summary": None,
                }
            )
            return response(200, {"ok": True, "setId": set_id, "updatedAt": updated_at, "trialId": trial_id})

        # No active trial - create one (migration case) or update legacy item
        # For backward compatibility, also maintain the legacy format
        sk = f"SET#{set_id}"
        table.put_item(
            Item={
                "pk": pk,
                "sk": sk,
                "setId": set_id,
                "updatedAt": updated_at,
                "stateJson": json.dumps(state, ensure_ascii=False),
            }
        )

        return response(200, {"ok": True, "setId": set_id, "updatedAt": updated_at})

    if method == "DELETE":
        qs = event.get("queryStringParameters") or {}
        set_id = (qs.get("setId") or "").strip()
        if not set_id:
            return response(400, {"message": "missing setId"})

        # Delete all trials for this set
        sk_prefix = f"SET#{set_id}#"
        query_res = table.query(
            KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(sk_prefix),
            ProjectionExpression="pk, sk",
        )
        for item in query_res.get("Items", []):
            table.delete_item(Key={"pk": item["pk"], "sk": item["sk"]})

        # Also delete legacy format
        sk = f"SET#{set_id}"
        table.delete_item(Key={"pk": pk, "sk": sk})

        return response(200, {"ok": True, "setId": set_id})

    return response(405, {"message": "method not allowed"})


def handle_list_trials(table, pk: str, event: dict):
    """GET /progress/trials?setId=X - List all trials for a question set."""
    qs = event.get("queryStringParameters") or {}
    set_id = (qs.get("setId") or "").strip()
    if not set_id:
        return response(400, {"message": "missing setId"})

    sk_prefix = f"SET#{set_id}#TRIAL#"
    query_res = table.query(
        KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(sk_prefix),
    )

    trials = []
    for item in query_res.get("Items", []):
        state_json = item.get("stateJson")
        try:
            state = json.loads(state_json) if isinstance(state_json, str) else {}
        except Exception:
            state = {}

        summary = item.get("summary")
        if summary:
            summary = decimal_to_native(summary)

        trials.append({
            "trialId": item.get("trialId"),
            "trialNumber": decimal_to_native(item.get("trialNumber", 1)),
            "status": item.get("status", "in_progress"),
            "startedAt": item.get("startedAt"),
            "completedAt": item.get("completedAt"),
            "summary": summary,
        })

    # Sort by trial number
    trials.sort(key=lambda t: t.get("trialNumber", 0))

    # Get active trial ID
    active_sk = f"SET#{set_id}#ACTIVE"
    active_res = table.get_item(Key={"pk": pk, "sk": active_sk}, ConsistentRead=True)
    active_item = active_res.get("Item")
    active_trial_id = active_item.get("activeTrialId") if active_item else None

    return response(200, {
        "setId": set_id,
        "activeTrialId": active_trial_id,
        "trialCount": len(trials),  # Return actual count of remaining trials, not cumulative count
        "trials": trials,
    })


def handle_create_trial(table, pk: str, event: dict):
    """POST /progress/trials - Create a new trial."""
    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return response(400, {"message": "invalid json body"})

    set_id = (body.get("setId") or "").strip()
    if not set_id:
        return response(400, {"message": "missing setId"})

    total_questions = body.get("totalQuestions")

    now = datetime.now(timezone.utc).isoformat()
    trial_id = now  # Use timestamp as trial ID

    # Get current trial count and check for active trial
    active_sk = f"SET#{set_id}#ACTIVE"
    active_res = table.get_item(Key={"pk": pk, "sk": active_sk}, ConsistentRead=True)
    active_item = active_res.get("Item")

    if active_item:
        current_active = active_item.get("activeTrialId")
        if current_active:
            # Check if active trial is still in_progress
            trial_sk = f"SET#{set_id}#TRIAL#{current_active}"
            trial_res = table.get_item(Key={"pk": pk, "sk": trial_sk}, ConsistentRead=True)
            trial_item = trial_res.get("Item")
            if trial_item and trial_item.get("status") == "in_progress":
                return response(400, {"message": "active trial already exists", "activeTrialId": current_active})

        trial_count = int(active_item.get("trialCount", 0)) + 1
    else:
        trial_count = 1

    trial_number = trial_count

    # Enforce max trials limit
    if trial_count > MAX_TRIALS_PER_SET:
        # Delete oldest trial
        sk_prefix = f"SET#{set_id}#TRIAL#"
        query_res = table.query(
            KeyConditionExpression=Key("pk").eq(pk) & Key("sk").begins_with(sk_prefix),
            ProjectionExpression="pk, sk, trialNumber",
        )
        items = sorted(query_res.get("Items", []), key=lambda x: x.get("trialNumber", 0))
        if items:
            oldest = items[0]
            table.delete_item(Key={"pk": oldest["pk"], "sk": oldest["sk"]})

    # Create empty initial state
    initial_state = {
        "currentIndex": 0,
        "attemptsByQuestionId": {},
        "updatedAt": now,
    }

    # Create trial item
    trial_sk = f"SET#{set_id}#TRIAL#{trial_id}"
    table.put_item(
        Item={
            "pk": pk,
            "sk": trial_sk,
            "setId": set_id,
            "trialId": trial_id,
            "trialNumber": trial_number,
            "status": "in_progress",
            "startedAt": now,
            "completedAt": None,
            "updatedAt": now,
            "stateJson": json.dumps(initial_state, ensure_ascii=False),
            "summary": None,
            "totalQuestions": total_questions,
        }
    )

    # Update active reference
    table.put_item(
        Item={
            "pk": pk,
            "sk": active_sk,
            "setId": set_id,
            "activeTrialId": trial_id,
            "trialCount": trial_count,
            "updatedAt": now,
        }
    )

    return response(200, {
        "trialId": trial_id,
        "trialNumber": trial_number,
        "status": "in_progress",
        "startedAt": now,
        "state": initial_state,
    })


def handle_get_trial(table, pk: str, trial_id: str, event: dict):
    """GET /progress/trials/{trialId}?setId=X - Get a specific trial."""
    qs = event.get("queryStringParameters") or {}
    set_id = (qs.get("setId") or "").strip()
    if not set_id:
        return response(400, {"message": "missing setId"})

    trial_sk = f"SET#{set_id}#TRIAL#{trial_id}"
    res = table.get_item(Key={"pk": pk, "sk": trial_sk}, ConsistentRead=True)
    item = res.get("Item")

    if not item:
        return response(404, {"message": "trial not found"})

    state_json = item.get("stateJson")
    try:
        state = json.loads(state_json) if isinstance(state_json, str) else None
    except Exception:
        state = None

    summary = item.get("summary")
    if summary:
        summary = decimal_to_native(summary)

    return response(200, {
        "trialId": trial_id,
        "trialNumber": decimal_to_native(item.get("trialNumber", 1)),
        "status": item.get("status", "in_progress"),
        "startedAt": item.get("startedAt"),
        "completedAt": item.get("completedAt"),
        "updatedAt": item.get("updatedAt"),
        "state": state,
        "summary": summary,
        "setId": set_id,
    })


def handle_update_trial(table, pk: str, trial_id: str, event: dict):
    """PUT /progress/trials/{trialId} - Update a trial (in_progress only)."""
    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return response(400, {"message": "invalid json body"})

    set_id = (body.get("setId") or "").strip()
    if not set_id:
        return response(400, {"message": "missing setId"})

    trial_sk = f"SET#{set_id}#TRIAL#{trial_id}"
    res = table.get_item(Key={"pk": pk, "sk": trial_sk}, ConsistentRead=True)
    item = res.get("Item")

    if not item:
        return response(404, {"message": "trial not found"})

    if item.get("status") == "completed":
        return response(400, {"message": "cannot update completed trial"})

    state = body.get("state")
    updated_at = None
    if isinstance(state, dict):
        updated_at = state.get("updatedAt")
    if not isinstance(updated_at, str) or not updated_at:
        updated_at = body.get("updatedAt")
    if not isinstance(updated_at, str) or not updated_at:
        updated_at = datetime.now(timezone.utc).isoformat()

    table.put_item(
        Item={
            "pk": pk,
            "sk": trial_sk,
            "setId": set_id,
            "trialId": trial_id,
            "trialNumber": item.get("trialNumber", 1),
            "status": "in_progress",
            "startedAt": item.get("startedAt"),
            "completedAt": None,
            "updatedAt": updated_at,
            "stateJson": json.dumps(state, ensure_ascii=False),
            "summary": None,
            "totalQuestions": item.get("totalQuestions"),
        }
    )

    return response(200, {"ok": True, "trialId": trial_id, "updatedAt": updated_at})


def handle_complete_trial(table, pk: str, trial_id: str, event: dict):
    """POST /progress/trials/{trialId}/complete - Mark trial as completed."""
    try:
        body = json.loads(event.get("body") or "{}")
    except Exception:
        return response(400, {"message": "invalid json body"})

    set_id = (body.get("setId") or "").strip()
    if not set_id:
        return response(400, {"message": "missing setId"})

    total_questions = body.get("totalQuestions")

    trial_sk = f"SET#{set_id}#TRIAL#{trial_id}"
    res = table.get_item(Key={"pk": pk, "sk": trial_sk}, ConsistentRead=True)
    item = res.get("Item")

    if not item:
        return response(404, {"message": "trial not found"})

    if item.get("status") == "completed":
        return response(400, {"message": "trial already completed"})

    now = datetime.now(timezone.utc).isoformat()

    state_json = item.get("stateJson")
    try:
        state = json.loads(state_json) if isinstance(state_json, str) else {}
    except Exception:
        state = {}

    # Use totalQuestions from request, item, or computed
    tq = total_questions or item.get("totalQuestions")
    summary = compute_summary(state, tq)

    # Calculate duration if possible
    started_at = item.get("startedAt")
    if started_at:
        try:
            start_dt = datetime.fromisoformat(started_at.replace("Z", "+00:00"))
            end_dt = datetime.fromisoformat(now.replace("Z", "+00:00"))
            duration = int((end_dt - start_dt).total_seconds())
            summary["durationSeconds"] = duration
        except Exception:
            pass

    table.put_item(
        Item={
            "pk": pk,
            "sk": trial_sk,
            "setId": set_id,
            "trialId": trial_id,
            "trialNumber": item.get("trialNumber", 1),
            "status": "completed",
            "startedAt": item.get("startedAt"),
            "completedAt": now,
            "updatedAt": now,
            "stateJson": item.get("stateJson"),
            "summary": summary,
            "totalQuestions": tq,
        }
    )

    # Clear active trial reference
    active_sk = f"SET#{set_id}#ACTIVE"
    active_res = table.get_item(Key={"pk": pk, "sk": active_sk}, ConsistentRead=True)
    active_item = active_res.get("Item")

    if active_item and active_item.get("activeTrialId") == trial_id:
        table.put_item(
            Item={
                "pk": pk,
                "sk": active_sk,
                "setId": set_id,
                "activeTrialId": None,
                "trialCount": active_item.get("trialCount", 1),
                "updatedAt": now,
            }
        )

    return response(200, {
        "trialId": trial_id,
        "status": "completed",
        "completedAt": now,
        "summary": summary,
    })


def handle_delete_trial(table, pk: str, trial_id: str, event: dict):
    """DELETE /progress/trials/{trialId}?setId=X - Delete a trial."""
    qs = event.get("queryStringParameters") or {}
    set_id = (qs.get("setId") or "").strip()
    if not set_id:
        return response(400, {"message": "missing setId"})

    trial_sk = f"SET#{set_id}#TRIAL#{trial_id}"

    # Check if this is the active trial
    active_sk = f"SET#{set_id}#ACTIVE"
    active_res = table.get_item(Key={"pk": pk, "sk": active_sk}, ConsistentRead=True)
    active_item = active_res.get("Item")

    if active_item and active_item.get("activeTrialId") == trial_id:
        now = datetime.now(timezone.utc).isoformat()
        table.put_item(
            Item={
                "pk": pk,
                "sk": active_sk,
                "setId": set_id,
                "activeTrialId": None,
                "trialCount": active_item.get("trialCount", 1),
                "updatedAt": now,
            }
        )

    table.delete_item(Key={"pk": pk, "sk": trial_sk})

    return response(200, {"ok": True, "trialId": trial_id})
