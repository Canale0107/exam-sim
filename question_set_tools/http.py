from __future__ import annotations

import random
import time
from dataclasses import dataclass

import requests


DEFAULT_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/121.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class FetchConfig:
    user_agent: str = DEFAULT_UA
    timeout_s: int = 25
    min_delay_s: float = 0.6
    max_delay_s: float = 1.6


def polite_get(url: str, cfg: FetchConfig) -> requests.Response:
    # simple jittered delay to avoid hammering
    time.sleep(random.uniform(cfg.min_delay_s, cfg.max_delay_s))
    headers = {"User-Agent": cfg.user_agent}
    resp = requests.get(url, headers=headers, timeout=cfg.timeout_s)
    resp.raise_for_status()
    return resp

