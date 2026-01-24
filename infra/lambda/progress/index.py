import json
import os

import boto3


ddb = boto3.resource("dynamodb")


def response(status_code: int, body: dict):
    return {
        "statusCode": status_code,
        "headers": {"content-type": "application/json; charset=utf-8"},
        "body": json.dumps(body, ensure_ascii=False),
    }


def get_sub(event) -> str | None:
    try:
        claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
        return claims.get("sub")
    except Exception:
        return None


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

    if method == "GET":
        qs = event.get("queryStringParameters") or {}
        set_id = (qs.get("setId") or "").strip()
        if not set_id:
            return response(400, {"message": "missing setId"})

        pk = f"USER#{sub}"
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
            # ISOっぽい形式で十分（厳密パースはMVPでは不要）
            from datetime import datetime, timezone

            updated_at = datetime.now(timezone.utc).isoformat()

        pk = f"USER#{sub}"
        sk = f"SET#{set_id}"

        table.put_item(
            Item={
                "pk": pk,
                "sk": sk,
                "setId": set_id,
                "updatedAt": updated_at,
                # Decimal問題を避けるためJSON文字列として保存
                "stateJson": json.dumps(state, ensure_ascii=False),
            }
        )

        return response(200, {"ok": True, "setId": set_id, "updatedAt": updated_at})

    return response(405, {"message": "method not allowed"})

