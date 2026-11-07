"""SIMS 로그인 상태를 크롬(전용 프로필)에 보관하고 자동 수집에 넘겨준다.

  python tools/sims_browser.py login   # 크롬 창이 열리면 평소처럼 SIMS에 로그인 → 콘솔에서 Enter (sims_login.bat)
  python tools/sims_browser.py check   # 화면 없이 로그인 유지 확인·쿠키 갱신. 끊겼으면 종료코드 2
  python tools/sims_browser.py show    # 저장된 쿠키 이름·만료 확인(값은 표시하지 않음)

- 크롬: PC에 설치된 Google Chrome을 그대로 쓴다(Playwright channel="chrome", 브라우저 추가 설치 없음).
  평소 쓰는 크롬 프로필과 분리된 전용 프로필(.secret/sims_chrome)을 쓴다 — 평소 크롬이 켜져 있어도 충돌하지 않는다.
- 로그인 상태: .secret/sims_state.json(Playwright storage_state, 세션 쿠키 포함), .secret/sims_cookies.json(이름→값).
  .secret/은 git에 올라가지 않는다. 비밀번호는 저장하지 않는다.
- 수집 스크립트에서 쓰기:  from sims_browser import cookie_header, requests_session
    requests_session().get(url)  또는  urllib 요청에 {"Cookie": cookie_header()} 헤더
- 로그인 유지: review_watch.py가 config.json의 sims_keepalive_min분(기본 20분, 0이면 끔)마다 check를 실행한다.
- 필요: pip install playwright   (playwright install은 하지 않아도 됨 — 설치된 크롬 사용)
"""
import json
import sys
import time
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import server  # noqa: E402

SECRET = BASE / ".secret"
PROFILE = SECRET / "sims_chrome"
STATE = SECRET / "sims_state.json"
COOKIES = SECRET / "sims_cookies.json"
DEFAULT_URL = "https://www.sims.or.kr/"
NOT_LOGGED_IN = 2  # check 종료코드: 로그인 필요


def sims_url():
    return server.load_config().get("sims_url") or DEFAULT_URL


def open_context(pw, headless):
    PROFILE.mkdir(parents=True, exist_ok=True)
    ctx = pw.chromium.launch_persistent_context(
        str(PROFILE), channel="chrome", headless=headless, locale="ko-KR",
        args=["--disable-blink-features=AutomationControlled"], viewport=None if not headless else {"width": 1400, "height": 900})
    if STATE.exists():  # 세션 쿠키는 크롬을 닫으면 프로필에서 사라지므로 저장본으로 되살린다
        try:
            ctx.add_cookies(json.loads(STATE.read_text(encoding="utf-8")).get("cookies", []))
        except Exception:
            pass
    return ctx


def logged_in(page):
    """로그인 화면이면 False. 비밀번호 입력칸이 보이거나 주소에 login이 있으면 로그인 화면으로 본다."""
    page.wait_for_load_state("domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass
    if "login" in page.url.lower():
        return False
    return page.locator("input[type=password]:visible").count() == 0


def save(ctx):
    SECRET.mkdir(exist_ok=True)
    ctx.storage_state(path=str(STATE))
    host = sims_url().split("//", 1)[-1].split("/", 1)[0].split(":")[0]
    root = ".".join(host.split(".")[-3:])  # www.sims.or.kr → sims.or.kr
    cookies = [c for c in ctx.cookies() if root in c["domain"]]
    COOKIES.write_text(json.dumps({"saved": datetime.now().isoformat(timespec="seconds"), "url": sims_url(),
                                   "cookies": {c["name"]: c["value"] for c in cookies}}, ensure_ascii=False, indent=1),
                       encoding="utf-8")
    return len(cookies)


def cmd_login():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        ctx = open_context(pw, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(sims_url())
        print("크롬 창에서 SIMS에 평소처럼 로그인하세요(인증서·문자 인증 포함).")
        print("협의현황 목록이 보이면 이 창으로 돌아와 Enter를 누르세요.")
        input()
        page = ctx.pages[-1] if ctx.pages else ctx.new_page()
        n = save(ctx)
        ok = logged_in(page)
        ctx.close()
    print(f"로그인 상태 저장 완료 (쿠키 {n}개)" if ok else
          f"[주의] 아직 로그인 화면으로 보입니다(쿠키 {n}개 저장). 로그인 후 다시 실행하세요.")
    return 0 if ok else NOT_LOGGED_IN


def cmd_check(quiet=False):
    if not STATE.exists():
        print("SIMS 로그인 기록이 없습니다. tools\\sims_login.bat을 실행해 한 번 로그인하세요.")
        return NOT_LOGGED_IN
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        ctx = open_context(pw, headless=True)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(sims_url())
        ok = logged_in(page)
        if ok:
            n = save(ctx)  # 서버가 새로 준 쿠키까지 저장
        ctx.close()
    if ok:
        if not quiet:
            print(f"SIMS 로그인 유지 중 (쿠키 {n}개 갱신)")
        return 0
    print("SIMS 로그인이 끊겼습니다. tools\\sims_login.bat을 실행해 다시 로그인하세요.")
    return NOT_LOGGED_IN


def cmd_show():
    if not STATE.exists():
        print("저장된 로그인 상태가 없습니다.")
        return NOT_LOGGED_IN
    state = json.loads(STATE.read_text(encoding="utf-8"))
    print(f"저장: {datetime.fromtimestamp(STATE.stat().st_mtime):%Y-%m-%d %H:%M}")
    for c in state.get("cookies", []):
        exp = c.get("expires", -1)
        print(f"  {c['domain']:<24} {c['name']:<28} "
              + ("세션 쿠키" if exp in (-1, None) else f"만료 {datetime.fromtimestamp(exp):%Y-%m-%d %H:%M}"))
    return 0


# ---------------------------------------------------------------- 수집 스크립트용

def cookies():
    """저장된 SIMS 쿠키 {이름: 값}. 없으면 빈 dict."""
    try:
        return json.loads(COOKIES.read_text(encoding="utf-8"))["cookies"]
    except (OSError, ValueError, KeyError):
        return {}


def cookie_header():
    return "; ".join(f"{k}={v}" for k, v in cookies().items())


def requests_session():
    import requests
    s = requests.Session()
    s.headers["User-Agent"] = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                               "(KHTML, like Gecko) Chrome/130.0 Safari/537.36")
    s.cookies.update(cookies())
    return s


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "login":
        sys.exit(cmd_login())
    if cmd == "check":
        sys.exit(cmd_check(quiet="--quiet" in sys.argv))
    if cmd == "show":
        sys.exit(cmd_show())
    raise SystemExit(__doc__)
