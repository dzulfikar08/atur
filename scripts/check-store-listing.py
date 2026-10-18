#!/usr/bin/env python3
"""Check docs/store-listing.json against the Play and App Store limits, and that
every string in it appears verbatim in docs/play-store.md or docs/app-store.md.

    scripts/check-store-listing.py            prints one line per field, exits 1 on a violation
"""

import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
data = json.loads((root / "docs/store-listing.json").read_text())
docs = {"play": (root / "docs/play-store.md").read_text(), "appStore": (root / "docs/app-store.md").read_text()}
bad = 0
for store, locales in (("play", data["play"]), ("appStore", data["appStore"])):
    for locale, fields in locales.items():
        for field, text in fields.items():
            limit = data["limits"][store][field]
            n = len(text)
            in_doc = text in docs[store]
            ok = n <= limit and in_doc
            bad += not ok
            note = "" if ok else ("  OVER LIMIT" if n > limit else "") + ("" if in_doc else "  NOT IN DOC")
            print(f"{'ok ' if ok else 'BAD'} {store:8} {locale:5} {field:11} {n:4}/{limit}{note}")
sys.exit(1 if bad else 0)
