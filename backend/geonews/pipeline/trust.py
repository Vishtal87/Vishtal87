"""Verification labels. We describe WHO reports something; we never declare it true.

official             — at least one official source (authority, municipality, emergency service)
multiple_sources     — 2+ independent origins (forwards/copies of one text count once)
single_source        — one origin
unverified           — only anonymous/UGC-type origins (tier 4)
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Report:
    source_id: int
    source_type: str
    trust_tier: int
    origin_group_id: int | None
    is_copy: bool = False       # forward/repost of another article (duplicate_of set)
    publisher: str | None = None  # one outlet's channels (site RSS + its Telegram) are one voice, not two


def trust_label(reports: list[Report]) -> dict:
    sources = {r.source_id for r in reports}
    # independent = sources that published at least one ORIGINAL text (a channel that only forwarded
    # someone else's post adds reach, not confirmation)
    independent = len({r.publisher or r.source_id for r in reports if not r.is_copy})
    has_official = any((r.source_type == "official" or r.trust_tier == 1) and not r.is_copy for r in reports)
    if has_official:
        label = "official"
    elif independent >= 2:
        label = "multiple_sources"
    elif all(r.trust_tier >= 4 or r.source_type == "ugc" for r in reports):
        label = "unverified"
    else:
        label = "single_source"
    return {
        "label": label,
        "has_official": has_official,
        "independent_count": independent,
        "source_count": len(sources),
        "source_types": sorted({r.source_type for r in reports}),
    }
