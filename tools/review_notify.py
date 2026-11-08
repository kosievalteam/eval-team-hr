"""검토의견서 폴더에 새 파일이 올라오면 분야 담당자에게 Slack 개인 메시지(DM)를 보낸다. review_watch.py가 호출한다.

- 경로 예: '26년 검토의견서\\①초안\\창업\\(2026-0302) ○○사업_초안.hwpx
  경로의 폴더 이름에서 단계(초안·검토·수정·최종)와 분야(창업·내수·수출·경영·소상공인·금융·기술·인력)를 찾아
  NOTIFY_RULES(또는 config.json의 review_notify)에 맞는 사람에게 보낸다. 한 사람에게 여러 파일이면 한 메시지로 묶는다.
- Slack: .secret/slack_token.txt (Bot token xoxb-…, 권한 chat:write·users:read, slack_app_manifest.json으로 생성).
  받는 사람 Slack ID는 config.json의 slack_users {"이름": "U…"}가 있으면 그것을, 없으면 Slack 이름(표시 이름·실명)으로 찾는다.
- 시험: python tools/review_notify.py "①초안\\창업\\시험.hwpx"   (실제로 보내지 않고 누구에게 갈지만 표시)
        python tools/review_notify.py "①초안\\창업\\시험.hwpx" --send
"""
import json
import re
import ssl
import sys
import urllib.parse
import urllib.request
from pathlib import Path, PureWindowsPath

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import server  # noqa: E402

SLACK_TOKEN = BASE / ".secret" / "slack_token.txt"
SSL_CTX = ssl.create_default_context()
SSL_CTX.verify_flags &= ~ssl.VERIFY_X509_STRICT  # 보안 프로그램이 끼워 넣는 루트 인증서 허용(publish.py와 같음)

FIELDS = ["소상공인", "창업", "내수", "수출", "경영", "금융", "기술", "인력"]
# 단계: 폴더 이름에 이 낱말이 있으면 그 단계(앞에서부터 확인 — '최종(팀장)'·'수정본'을 '검토'보다 먼저)
STAGES = [("최종", "최종(팀장)"), ("수정", "수정본"), ("검토", "검토본"), ("초안", "초안")]
NOTIFY_RULES = [  # config.json의 review_notify가 있으면 그것을 쓴다(같은 모양)
    {"stages": ["초안", "검토본", "최종(팀장)"], "fields": ["창업", "내수"], "to": "장채윤"},
    {"stages": ["초안", "검토본", "최종(팀장)"], "fields": ["수출"], "to": "신경희"},
    {"stages": ["초안", "검토본", "최종(팀장)"], "fields": ["경영", "소상공인"], "to": "윤의열"},
    {"stages": ["초안", "검토본", "최종(팀장)"], "fields": ["금융", "기술", "인력"], "to": "이은실"},
    {"stages": ["초안"], "fields": ["경영", "창업", "내수", "인력", "수출"], "to": "김미정"},
    {"stages": ["수정본"], "fields": "*", "to": "김미정"},  # "*" = 분야 상관없음(분야 폴더 없이 올려도)
]


def classify(relpath):
    """상대 경로 → (단계, 분야). 못 찾으면 None. 단계·분야는 파일이 든 폴더들의 이름에서 찾는다."""
    dirs = PureWindowsPath(relpath).parts[:-1]
    found = next(((i, label) for i, d in enumerate(dirs) for key, label in STAGES if key in d), None)
    if not found:
        return None, None
    i, stage = found
    # 분야는 단계 폴더 바로 아래부터 찾는다(사업명 하위 폴더에 '기술' 같은 낱말이 있어도 분야 폴더가 우선). 없으면 단계 폴더 위쪽.
    field = next((f for d in (*dirs[i + 1:], *reversed(dirs[:i])) for f in FIELDS if f in d), None)
    return stage, field


def recipients(relpath, rules=None):
    stage, field = classify(relpath)
    if not stage:
        return []
    rules = rules or server.load_config().get("review_notify") or NOTIFY_RULES
    out = []
    for r in rules:
        if stage in r["stages"] and (r["fields"] == "*" or field in r["fields"]) and r["to"] not in out:
            out.append(r["to"])
    return out


def slack(method, params, post=False):
    token = SLACK_TOKEN.read_text(encoding="utf-8").strip()
    url = "https://slack.com/api/" + method
    if post:
        req = urllib.request.Request(url, data=json.dumps(params, ensure_ascii=False).encode("utf-8"), method="POST",
                                     headers={"Authorization": "Bearer " + token, "Content-Type": "application/json; charset=utf-8"})
    else:
        req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as res:
        data = json.loads(res.read())
    if not data.get("ok"):
        raise RuntimeError(f"Slack {method} 실패: {data.get('error')}")
    return data


_ids = {}


def slack_id(name):
    """이름 → Slack 사용자 ID. config.json slack_users 우선, 없으면 워크스페이스 사용자 이름에서 찾는다."""
    fixed = server.load_config().get("slack_users", {})
    if name in fixed:
        return fixed[name]
    if not _ids:
        cursor = ""
        while True:
            data = slack("users.list", {"limit": 200, **({"cursor": cursor} if cursor else {})})
            for u in data["members"]:
                if u.get("deleted") or u.get("is_bot"):
                    continue
                p = u.get("profile", {})
                for n in (p.get("display_name"), p.get("real_name"), u.get("real_name"), u.get("name")):
                    if n:
                        _ids.setdefault(re.sub(r"\s+", "", n), u["id"])
            cursor = data.get("response_metadata", {}).get("next_cursor", "")
            if not cursor:
                break
    uid = _ids.get(re.sub(r"\s+", "", name))
    if not uid:
        raise RuntimeError(f"Slack에서 '{name}'을(를) 찾지 못했습니다. config.json slack_users에 Slack ID를 적어 주세요.")
    return uid


def plan(files):
    """{받는 사람: [(단계, 분야, 상대 경로), …]}"""
    rules = server.load_config().get("review_notify") or NOTIFY_RULES
    out = {}
    for f in files:
        stage, field = classify(f)
        for who in recipients(f, rules):
            out.setdefault(who, []).append((stage, field, f))
    return out


def message(items):
    link = server.load_config().get("review_watch_link", "")
    lines = [f"📄 *검토의견서 새 파일 {len(items)}건*"]
    for stage, field, f in items:
        lines.append(f"• [{stage}{' · ' + field if field else ''}] {PureWindowsPath(f).name}")
    if link:
        lines.append(f"<{link}|'26년 검토의견서 폴더 열기>")
    return "\n".join(lines)


def notify(files, log=print):
    """새 파일 목록을 담당자별로 묶어 DM. 실패해도 예외를 밖으로 내지 않는다. 보낸 사람 수를 돌려준다."""
    todo = plan(files)
    if not todo:
        return 0
    if not SLACK_TOKEN.exists():
        log(f"Slack 알림 건너뜀 — 토큰 파일이 없습니다: {SLACK_TOKEN}")
        return 0
    sent = 0
    for who, items in todo.items():
        try:
            slack("chat.postMessage", {"channel": slack_id(who), "text": message(items)}, post=True)
            sent += 1
            log(f"Slack 알림 → {who} ({len(items)}건)")
        except Exception as e:  # 한 사람 실패가 다른 사람 알림·협의검토 갱신을 막지 않게 한다
            log(f"Slack 알림 실패 → {who}: {e}")
    return sent


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        raise SystemExit(__doc__)
    if "--send" in sys.argv:
        notify(args)
    else:
        for who, items in plan(args).items():
            print(f"→ {who}\n{message(items)}\n")
        if not plan(args):
            print("알림 대상이 아닙니다(단계·분야 폴더를 찾지 못했거나 규칙에 없음):", [classify(a) for a in args])
