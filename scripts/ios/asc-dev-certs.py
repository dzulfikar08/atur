#!/usr/bin/env python3
"""Keep CI from exhausting the team's Apple Development certificate slots. Standard library and openssl only.

    asc-dev-certs.py snapshot <file>     write the ids of the current DEVELOPMENT certificates to <file>
    asc-dev-certs.py revoke-new <file>   revoke DEVELOPMENT certificates named "Created via API" that are not in <file>

`xcodebuild archive -allowProvisioningUpdates` on a fresh runner has no development private key, so it asks the API
for a new Apple Development certificate on every run. The private key dies with the runner, and the team hits
Apple's certificate limit after a few runs ("Your account has reached the maximum number of certificates").
The workflow snapshots before the build and revokes only what this run created. Needs ASC_KEY_ID, ASC_ISSUER_ID,
ASC_KEY_PATH.
"""

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.appstoreconnect.apple.com"


def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def der_to_raw(der):
    pos = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)
    parts = []
    for _ in range(2):
        length = der[pos + 1]
        parts.append(int.from_bytes(der[pos + 2 : pos + 2 + length], "big"))
        pos += 2 + length
    return b"".join(p.to_bytes(32, "big") for p in parts)


def token():
    now = int(time.time())
    header = b64url(json.dumps({"alg": "ES256", "kid": os.environ["ASC_KEY_ID"], "typ": "JWT"}).encode())
    claims = b64url(json.dumps({"iss": os.environ["ASC_ISSUER_ID"], "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"}).encode())
    signing_input = f"{header}.{claims}".encode()
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", os.environ["ASC_KEY_PATH"]], input=signing_input, capture_output=True, check=True).stdout
    return f"{header}.{claims}.{b64url(der_to_raw(der))}"


def call(method, path):
    req = urllib.request.Request(API + path, method=method, headers={"Authorization": f"Bearer {token()}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {path}: HTTP {e.code}\n{e.read().decode(errors='replace')}")
    return json.loads(raw) if raw else {}


def development_certs():
    return call("GET", "/v1/certificates?filter[certificateType]=DEVELOPMENT&limit=200")["data"]


if len(sys.argv) != 3 or sys.argv[1] not in ("snapshot", "revoke-new"):
    sys.exit(__doc__)
mode, path = sys.argv[1], Path(sys.argv[2])
if mode == "snapshot":
    path.write_text("\n".join(c["id"] for c in development_certs()))
else:
    before = set(path.read_text().split()) if path.exists() else None
    if before is None:
        sys.exit(f"no snapshot at {path}; refusing to revoke anything")
    for c in development_certs():
        if c["id"] not in before and c["attributes"]["name"] == "Created via API":
            call("DELETE", f"/v1/certificates/{c['id']}")
            print(f"revoked CI development certificate {c['id']}")
