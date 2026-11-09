"""Deploys dist/ to Firebase Hosting through the Hosting REST API (no Firebase CLI login needed).

    npm run build
    python3 scripts/deploy.py <site-id> [--account you@example.com]

Authenticates with `gcloud auth print-access-token`, so the gcloud account must own the project.
Steps: create a version with headers, populate files (sha256 of gzipped content), upload what
Hosting does not have yet, finalize, release.
"""
import argparse
import gzip
import hashlib
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

API = "https://firebasehosting.googleapis.com/v1beta1"

CSP = "; ".join([
    "default-src 'self'",
    # reCAPTCHA Enterprise (App Check) loads only after the person agrees to use the cloud.
    "script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self' https://*.googleapis.com https://www.google.com",
    "frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
])

CONFIG = {
    "headers": [
        {"glob": "**", "headers": {
            "Content-Security-Policy": CSP,
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
            "Cross-Origin-Opener-Policy": "same-origin",
        }},
        # Pages are revalidated on every visit ("/" is not matched by "/index.html"); hashed assets are immutable.
        {"glob": "**", "headers": {"Cache-Control": "no-cache"}},
        {"glob": "/assets/**", "headers": {"Cache-Control": "public, max-age=31536000, immutable"}},
    ],
}


def call(method, url, token, project, body=None, raw=None, content_type="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": f"Bearer {token}", "x-goog-user-project": project, "Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=120) as r:
        text = r.read().decode()
        return json.loads(text) if text else {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("site")
    ap.add_argument("--account", help="gcloud account to use (default: the active one)")
    ap.add_argument("--project", help="project for quota (default: the site id)")
    ap.add_argument("--dist", default="dist")
    a = ap.parse_args()
    project = a.project or a.site
    cmd = ["gcloud", "auth", "print-access-token"] + ([f"--account={a.account}"] if a.account else [])
    token = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout.strip()

    files, blobs = {}, {}
    for path in sorted(Path(a.dist).rglob("*")):
        if path.is_file():
            gz = gzip.compress(path.read_bytes(), mtime=0)
            digest = hashlib.sha256(gz).hexdigest()
            files["/" + path.relative_to(a.dist).as_posix()] = digest
            blobs[digest] = gz
    print(f"{len(files)} files")

    version = call("POST", f"{API}/sites/{a.site}/versions", token, project, {"config": CONFIG})["name"]
    pop = call("POST", f"{API}/{version}:populateFiles", token, project, {"files": files})
    needed = pop.get("uploadRequiredHashes", [])
    for digest in needed:
        call("POST", f"{pop['uploadUrl']}/{digest}", token, project, raw=blobs[digest], content_type="application/octet-stream")
    print(f"uploaded {len(needed)} new files")
    call("PATCH", f"{API}/{version}?update_mask=status", token, project, {"status": "FINALIZED"})
    release = call("POST", f"{API}/sites/{a.site}/releases?versionName={version}", token, project, {})
    print("released", release.get("name", "?").split("/")[-1], f"-> https://{a.site}.web.app")


if __name__ == "__main__":
    sys.exit(main())
