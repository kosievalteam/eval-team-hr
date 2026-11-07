"""웹 배포: 엑셀 → Supabase(hr_snapshot) 업로드 + 화면 파일 → docs/ → git push.

- 엑셀 데이터는 저장소에 올리지 않고 Supabase에 올린다. 웹에서는 팀원 계정으로 로그인해야 읽을 수 있다(RLS).
- 업로드는 hr_put_snapshot RPC가 .secret/hr_upload_token.txt 토큰을 확인한 뒤에만 받아 준다.
- config.json 팀원 명단(이름·이메일·admin)도 같은 호출로 hr_members에 반영한다.
- 주간업무관리는 웹에서 직접 작성한다(hr_weeks·hr_weekly·hr_tasks). 엑셀은 import_weekly.py로 한 번만 옮긴다.
- 사용: python publish.py           (업로드 + docs 생성 + 커밋 + 푸시)
        python publish.py --no-push (업로드 + docs 생성만)
"""
import hashlib
import json
import shutil
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

import server

BASE = Path(__file__).resolve().parent
DOCS = BASE / "docs"
TOKEN = BASE / ".secret" / "hr_upload_token.txt"

# Python 3.13+는 VERIFY_X509_STRICT가 기본이라, 보안 프로그램이 끼워 넣는 루트 인증서(AKI 없음)를 거부한다.
# 인증서 검증은 유지하고 엄격 모드만 끈다.
SSL_CTX = ssl.create_default_context()
SSL_CTX.verify_flags &= ~ssl.VERIFY_X509_STRICT
RETRIES = 4


def rpc(cfg, name, params):
    """업로드 토큰을 붙여 Supabase RPC를 호출한다."""
    body = json.dumps({"p_token": TOKEN.read_text(encoding="utf-8").strip(), **params},
                      ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        cfg["supabase_url"].rstrip("/") + "/rest/v1/rpc/" + name, data=body, method="POST",
        headers={"apikey": cfg["supabase_key"], "Content-Type": "application/json"})
    # 이 PC에서는 보내는 도중 연결이 가끔 끊긴다(OSError Errno 0). 잠시 뒤 다시 보내면 대개 된다.
    for attempt in range(1, RETRIES + 1):
        try:
            with urllib.request.urlopen(req, timeout=60, context=SSL_CTX) as res:
                return json.loads(res.read() or b"0")
        except urllib.error.HTTPError as e:
            raise SystemExit(f"Supabase 업로드 실패 ({e.code}): {e.read().decode('utf-8', 'replace')}")
        except (urllib.error.URLError, OSError) as e:
            if attempt == RETRIES:
                raise SystemExit(f"Supabase에 연결할 수 없습니다({RETRIES}번 시도): {getattr(e, 'reason', e)}")
            print(f"연결이 끊겨 {attempt * 5}초 뒤 다시 보냅니다… ({attempt}/{RETRIES - 1})")
            time.sleep(attempt * 5)


def upload(cfg, payload):
    members = [{"email": m["email"], "name": m["name"], "is_admin": bool(m.get("admin"))}
               for m in cfg.get("members", []) if m.get("email")]
    return rpc(cfg, "hr_put_snapshot", {"p_data": payload, "p_members": members})


def build_docs():
    DOCS.mkdir(exist_ok=True)
    version = {}
    for name in ("app.js", "app.css"):
        shutil.copy2(server.STATIC / name, DOCS / name)
        version[name] = hashlib.sha256((DOCS / name).read_bytes()).hexdigest()[:10]
    for img in server.STATIC.glob("*.png"):  # 로고 등 이미지
        shutil.copy2(img, DOCS / img.name)
    if (server.STATIC / "templates").is_dir():  # 주간업무 한글(HWPX) 견본
        shutil.copytree(server.STATIC / "templates", DOCS / "templates", dirs_exist_ok=True)
    html = (server.STATIC / "index.html").read_text(encoding="utf-8")
    html = html.replace("<head>", '<head>\n<meta name="robots" content="noindex, nofollow">', 1)
    # 파일 내용이 바뀌면 주소도 바뀌게 해 GitHub Pages 캐시(10분)에 옛 화면이 남지 않도록 한다
    html = html.replace('href="app.css"', f'href="app.css?v={version["app.css"]}"', 1)
    html = html.replace('<script src="app.js"></script>',
                        f'<script>window.HR_STATIC = true;</script>\n<script src="app.js?v={version["app.js"]}"></script>', 1)
    (DOCS / "index.html").write_text(html, encoding="utf-8")
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")
    (DOCS / "data.enc").unlink(missing_ok=True)  # 예전 암호화 데이터 방식의 잔재


def git(*args, check=True):
    return subprocess.run(["git", *args], cwd=BASE, check=check, capture_output=True, text=True, encoding="utf-8")


def main():
    if not TOKEN.exists():
        raise SystemExit(f"업로드 토큰 파일이 없습니다: {TOKEN}")
    cfg = server.load_config()
    if not cfg.get("supabase_url") or not cfg.get("supabase_key"):
        raise SystemExit("config.json에 supabase_url, supabase_key를 입력하세요.")

    payload = server.build_payload()
    if payload["errors"]:
        raise SystemExit("엑셀을 읽지 못해 배포를 중단합니다:\n" + "\n".join(payload["errors"]))
    payload.pop("sources", None)  # 로컬 경로는 웹에 필요 없음

    n = upload(cfg, payload)
    build_docs()
    print(f"Supabase 업로드 완료 · 로그인 가능 팀원 {n}명 · 휴가 {len(payload['entries'])}건 · "
          f"사전협의 {len(payload['reviews']['rows'])}건")

    if "--no-push" in sys.argv:
        return
    if not shutil.which("git"):
        print("[안내] 이 PC에 Git이 없어 화면 파일은 올리지 않았습니다(데이터는 반영됨). "
              "화면을 바꿨다면 Git 설치 후 다시 배포하세요: winget install --id Git.Git -e")
        return
    git("add", "-A")
    if not git("status", "--porcelain").stdout.strip():
        print("화면 변경 사항 없음 — 데이터만 갱신했습니다.")
        return
    git("commit", "-m", f"화면 갱신 {datetime.now():%Y-%m-%d %H:%M}")
    res = git("push", check=False)
    if res.returncode:
        raise SystemExit("푸시 실패:\n" + res.stderr)
    print("GitHub 푸시 완료 — 1~2분 뒤 웹에 반영됩니다.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
