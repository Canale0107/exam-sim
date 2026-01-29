from __future__ import annotations

import random
import threading
import time
from dataclasses import dataclass

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/121.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class FetchConfig:
    user_agent: str = DEFAULT_UA
    # Use separate connect/read timeouts to avoid hanging on TLS handshakes.
    connect_timeout_s: float = 10.0
    timeout_s: float = 25.0
    min_delay_s: float = 0.6
    max_delay_s: float = 1.6
    retries: int = 4
    backoff_factor: float = 0.6


_thread_local = threading.local()


def _build_session(cfg: FetchConfig) -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=cfg.retries,
        connect=cfg.retries,
        read=cfg.retries,
        status=cfg.retries,
        backoff_factor=cfg.backoff_factor,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    return s


def _get_thread_session(cfg: FetchConfig) -> requests.Session:
    sess = getattr(_thread_local, "session", None)
    sess_cfg = getattr(_thread_local, "cfg", None)
    if sess is None or sess_cfg != cfg:
        sess = _build_session(cfg)
        _thread_local.session = sess
        _thread_local.cfg = cfg
    return sess


def polite_get(url: str, cfg: FetchConfig) -> requests.Response:
    # simple jittered delay to avoid hammering
    time.sleep(random.uniform(cfg.min_delay_s, cfg.max_delay_s))
    headers = {"User-Agent": cfg.user_agent}
    sess = _get_thread_session(cfg)
    resp = sess.get(
        url,
        headers=headers,
        timeout=(cfg.connect_timeout_s, cfg.timeout_s),
    )
    resp.raise_for_status()
    return resp

