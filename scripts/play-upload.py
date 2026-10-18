#!/usr/bin/env python3
"""Upload an AAB to a Google Play track through the Android Publisher API.

    scripts/play-upload.py [AAB] [--track internal|alpha|beta|production] [--status draft|completed]
                           [--notes TEXT] [--notes-lang en-US] [--name RELEASE_NAME] [--dry-run]

AAB defaults to the newest apps/native/dist/atur-play-*.aab. --track defaults to
internal, --status to draft (a draft release is committed but not rolled out:
finish it in the Play Console). Use --status completed to roll out right away;
for an app that has never been published Play only accepts draft.

Auth: a service-account JSON key, ~/.config/joyorogo/play-billing-sa.json
unless PLAY_SERVICE_ACCOUNT_JSON points elsewhere. The account needs the
"Release to testing tracks" permission on com.diatur.app in Play Console ->
Users and permissions (and the app must exist: create it in the Console first).

Standard library plus `cryptography` (the venv in ~/.local/share/joyorogo-ios/venv
has it; ASC_PYTHON in the iOS script is the same interpreter).
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

PACKAGE = "com.diatur.app"
API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications"
ROOT = Path(__file__).resolve().parent.parent


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def access_token(sa_path: Path) -> str:
    sa = json.loads(sa_path.read_text())
    now = int(time.time())
    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claims = b64url(json.dumps({
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/androidpublisher",
        "aud": sa.get("token_uri", "https://oauth2.googleapis.com/token"),
        "iat": now,
        "exp": now + 3000,
    }).encode())
    key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
    signature = key.sign(f"{header}.{claims}".encode(), padding.PKCS1v15(), hashes.SHA256())
    body = urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": f"{header}.{claims}.{b64url(signature)}",
    }).encode()
    with urllib.request.urlopen(urllib.request.Request(
        sa.get("token_uri", "https://oauth2.googleapis.com/token"), data=body)) as resp:
        return json.load(resp)["access_token"]


def call(token: str, method: str, url: str, body=None, data: bytes | None = None, content_type="application/json"):
    payload = data if data is not None else (None if body is None else json.dumps(body).encode())
    req = urllib.request.Request(url, method=method, data=payload, headers={
        "Authorization": f"Bearer {token}", "Content-Type": content_type})
    try:
        with urllib.request.urlopen(req, timeout=600) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {url}: HTTP {e.code}\n{e.read().decode(errors='replace')}")
    return json.loads(raw) if raw else {}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("aab", nargs="?", type=Path)
    ap.add_argument("--track", default="internal", choices=["internal", "alpha", "beta", "production"])
    ap.add_argument("--status", default="draft", choices=["draft", "completed"])
    ap.add_argument("--notes", help="release notes text (needs a rollout-capable track; optional)")
    ap.add_argument("--notes-lang", default="en-US")
    ap.add_argument("--name", help="release name (default: Play fills in versionName)")
    ap.add_argument("--dry-run", action="store_true", help="validate the edit, do not commit")
    args = ap.parse_args()

    aab = args.aab
    if aab is None:
        found = sorted((ROOT / "apps/native/dist").glob("atur-play-*.aab"), key=lambda p: p.stat().st_mtime)
        if not found:
            sys.exit("no apps/native/dist/atur-play-*.aab; build one with scripts/build-native-aab.sh")
        aab = found[-1]
    if not zipfile.is_zipfile(aab):
        sys.exit(f"{aab} is not an AAB")

    sa_path = Path(os.environ.get("PLAY_SERVICE_ACCOUNT_JSON", Path.home() / ".config/joyorogo/play-billing-sa.json"))
    if not sa_path.is_file():
        sys.exit(f"service account key not found: {sa_path} (set PLAY_SERVICE_ACCOUNT_JSON)")

    token = access_token(sa_path)
    edit = call(token, "POST", f"{API}/{PACKAGE}/edits", {})["id"]
    print(f"edit {edit} for {PACKAGE}", file=sys.stderr)

    print(f"uploading {aab.name} ({aab.stat().st_size / 1e6:.1f} MB)...", file=sys.stderr)
    bundle = call(token, "POST", f"{UPLOAD}/{PACKAGE}/edits/{edit}/bundles?uploadType=media",
                  data=aab.read_bytes(), content_type="application/octet-stream")
    version_code = bundle["versionCode"]
    print(f"uploaded versionCode {version_code}", file=sys.stderr)

    release = {"versionCodes": [str(version_code)], "status": args.status}
    if args.name:
        release["name"] = args.name
    if args.notes:
        release["releaseNotes"] = [{"language": args.notes_lang, "text": args.notes}]
    call(token, "PUT", f"{API}/{PACKAGE}/edits/{edit}/tracks/{args.track}",
         {"track": args.track, "releases": [release]})

    if args.dry_run:
        call(token, "POST", f"{API}/{PACKAGE}/edits/{edit}:validate")
        call(token, "DELETE", f"{API}/{PACKAGE}/edits/{edit}")
        print(f"dry run ok: versionCode {version_code} would go to {args.track} as {args.status}")
        return
    call(token, "POST", f"{API}/{PACKAGE}/edits/{edit}:commit")
    print(f"committed: versionCode {version_code} on {args.track} ({args.status})")


main()
