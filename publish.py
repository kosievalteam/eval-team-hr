"""GitHub Pages 배포: 엑셀 → 암호화된 data.enc → docs/ → git push.

- 데이터는 팀 비밀번호(.secret/password.txt)로 AES-256-GCM 암호화한다. 키는 PBKDF2-SHA256으로 유도.
- 저장소에는 암호문(docs/data.enc)과 화면 파일만 올라간다.
- 사용: python publish.py           (생성 + 커밋 + 푸시)
        python publish.py --no-push (docs/ 생성만)
"""
import base64
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

import server

BASE = Path(__file__).resolve().parent
DOCS = BASE / "docs"
SECRET = BASE / ".secret" / "password.txt"
ITERATIONS = 310_000


def b64(b):
    return base64.b64encode(b).decode("ascii")


def encrypt(obj, password):
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(password.encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode("utf-8"), None)
    return {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}


def build_docs(password):
    payload = server.build_payload()
    if payload["errors"]:
        raise SystemExit("엑셀을 읽지 못해 배포를 중단합니다:\n" + "\n".join(payload["errors"]))
    payload.pop("sources", None)  # 로컬 경로는 웹에 필요 없음

    DOCS.mkdir(exist_ok=True)
    for name in ("app.js", "app.css"):
        shutil.copy2(server.STATIC / name, DOCS / name)
    html = (server.STATIC / "index.html").read_text(encoding="utf-8")
    html = html.replace("<head>", '<head>\n<meta name="robots" content="noindex, nofollow">', 1)
    html = html.replace('<script src="app.js"></script>', '<script>window.HR_STATIC = true;</script>\n<script src="app.js"></script>', 1)
    (DOCS / "index.html").write_text(html, encoding="utf-8")
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")
    (DOCS / "data.enc").write_text(json.dumps(encrypt(payload, password)), encoding="utf-8")
    return payload


def git(*args, check=True):
    return subprocess.run(["git", *args], cwd=BASE, check=check, capture_output=True, text=True, encoding="utf-8")


def main():
    if not SECRET.exists():
        raise SystemExit(f"비밀번호 파일이 없습니다: {SECRET}\n한 줄짜리 팀 비밀번호를 저장한 뒤 다시 실행하세요.")
    password = SECRET.read_text(encoding="utf-8").strip()
    if len(password) < 8:
        raise SystemExit("비밀번호는 8자 이상이어야 합니다.")

    payload = build_docs(password)
    print(f"docs/ 생성 완료 · 팀원 {len(payload['members'])}명 · 휴가 {len(payload['entries'])}건 · "
          f"주간계획 {len(payload['weeks'])}주 · 개인업무 {sum(len(w['tasks']) for w in payload['personal'])}건")

    if "--no-push" in sys.argv:
        return
    git("add", "-A")
    if not git("status", "--porcelain").stdout.strip():
        print("변경 사항 없음 — 푸시하지 않습니다.")
        return
    git("commit", "-m", f"데이터 갱신 {datetime.now():%Y-%m-%d %H:%M}")
    res = git("push", check=False)
    if res.returncode:
        raise SystemExit("푸시 실패:\n" + res.stderr)
    print("GitHub 푸시 완료 — 1~2분 뒤 웹에 반영됩니다.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
