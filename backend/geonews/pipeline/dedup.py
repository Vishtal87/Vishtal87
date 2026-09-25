"""Near-duplicate detection primitives: SimHash-64 with 4x16-bit bands + shingle Jaccard.

Bands are stored in indexed columns, so candidate lookup is a DB query shared by all workers
(Hamming distance <= 3 guarantees that at least one of the 4 bands is identical).
"""
from __future__ import annotations

import hashlib

from geonews.domain.text_norm import tokenize

HAMMING_MAX = 6          # candidates are verified with Jaccard afterwards
JACCARD_DUP = 0.72       # >= : same text (forward, repost, lightly edited copy)


def _h64(s: str) -> int:
    return int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8).digest(), "big")


def shingles(text: str, k: int = 3) -> set[str]:
    toks = [t.norm for t in tokenize(text)]
    if len(toks) < k:
        return {" ".join(toks)} if toks else set()
    return {" ".join(toks[i:i + k]) for i in range(len(toks) - k + 1)}


def simhash(text: str) -> int:
    """Signed 64-bit SimHash (fits PostgreSQL bigint)."""
    feats = shingles(text, 2)
    if not feats:
        return 0
    v = [0] * 64
    for f in feats:
        h = _h64(f)
        for i in range(64):
            v[i] += 1 if (h >> i) & 1 else -1
    x = sum(1 << i for i in range(64) if v[i] > 0)
    return x - (1 << 64) if x >= (1 << 63) else x


def bands(sh: int) -> tuple[int, int, int, int]:
    """Four 16-bit bands as signed smallints."""
    u = sh & ((1 << 64) - 1)
    return tuple(((u >> (16 * i)) & 0xFFFF) - 32768 for i in range(4))  # type: ignore[return-value]


def hamming(a: int, b: int) -> int:
    return bin((a ^ b) & ((1 << 64) - 1)).count("1")


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)
