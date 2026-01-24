import json
import os
import re
from datetime import datetime, timedelta, timezone

import boto3
from botocore.config import Config


def _make_s3_client():
    # Important: force regional endpoint + SigV4.
    # If we accidentally return a global endpoint (bucket.s3.amazonaws.com),
    # browsers may hit a redirect on CORS preflight (OPTIONS), which is blocked.
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    cfg = Config(signature_version="s3v4", s3={"addressing_style": "virtual"})
    return boto3.client("s3", region_name=region, config=cfg)


s3 = _make_s3_client()


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


_SAFE_SET_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")


def validate_set_id(set_id: str) -> str | None:
    s = (set_id or "").strip()
    if not s:
        return None
    if not _SAFE_SET_ID.match(s):
        return None
    return s


def handler(event, context):
    sub = get_sub(event)
    if not sub:
        return response(401, {"message": "unauthorized"})

    bucket = os.environ.get("QUESTION_SETS_BUCKET")
    if not bucket:
        return response(500, {"message": "missing QUESTION_SETS_BUCKET env"})

    method = (
        event.get("requestContext", {})
        .get("http", {})
        .get("method", "GET")
        .upper()
    )
    path = (event.get("rawPath") or "").rstrip("/")

    # GET /question-sets (list)
    if method == "GET" and path.endswith("/question-sets"):
        prefix = f"question-sets/{sub}/"
        out = []
        token = None
        while True:
            kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
            if token:
                kwargs["ContinuationToken"] = token
            res = s3.list_objects_v2(**kwargs)
            for obj in res.get("Contents", []):
                key = obj.get("Key") or ""
                if not key.endswith(".json"):
                    continue
                name = key[len(prefix) :]
                if not name.endswith(".json"):
                    continue
                set_id = name[: -len(".json")]
                if not validate_set_id(set_id):
                    continue
                out.append(
                    {
                        "setId": set_id,
                        "key": key,
                        "size": obj.get("Size"),
                        "lastModified": obj.get("LastModified").isoformat()
                        if obj.get("LastModified")
                        else None,
                    }
                )
            if res.get("IsTruncated"):
                token = res.get("NextContinuationToken")
                continue
            break
        out.sort(key=lambda x: (x.get("lastModified") or "", x.get("setId") or ""), reverse=True)
        return response(200, {"items": out})

    # POST /question-sets/upload-url
    if method == "POST" and path.endswith("/question-sets/upload-url"):
        try:
            body = json.loads(event.get("body") or "{}")
        except Exception:
            return response(400, {"message": "invalid json body"})

        set_id = validate_set_id(body.get("setId") if isinstance(body, dict) else "")
        if not set_id:
            return response(400, {"message": "invalid setId"})

        key = f"question-sets/{sub}/{set_id}.json"

        # short-lived presigned PUT
        expires_in = 300
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": bucket,
                "Key": key,
                "ContentType": "application/json",
            },
            ExpiresIn=expires_in,
        )

        return response(
            200,
            {
                "bucket": bucket,
                "key": key,
                "setId": set_id,
                "expiresIn": expires_in,
                "uploadUrl": upload_url,
            },
        )

    # GET /question-sets/download-url?setId=...
    if method == "GET" and path.endswith("/question-sets/download-url"):
        qs = event.get("queryStringParameters") or {}
        set_id = validate_set_id(qs.get("setId") if isinstance(qs, dict) else "")
        if not set_id:
            return response(400, {"message": "invalid setId"})

        key = f"question-sets/{sub}/{set_id}.json"

        expires_in = 300
        download_url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_in,
        )

        return response(
            200,
            {
                "bucket": bucket,
                "key": key,
                "setId": set_id,
                "expiresIn": expires_in,
                "downloadUrl": download_url,
            },
        )

    return response(404, {"message": "not found"})

