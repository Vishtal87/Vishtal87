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


def trust_label(reports: list[Report]) -> dict:
    sources = {r.source_id for r in reports}
    # independence = distinct text origins published by distinct sources
    origins = {(r.origin_group_id or -r.source_id) for r in reports}
    independent = min(len(origins), len(sources))
    has_official = any(r.source_type == "official" or r.trust_tier == 1 for r in reports)
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
