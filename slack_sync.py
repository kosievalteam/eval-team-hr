"""공지사항 ↔ Slack 전체공지 채널 동기화 (publish.py가 배포 때 호출).

- HR앱 → Slack: 아직 올리지 않은 웹 공지(hr_notices.slack_ts 없음)를 채널에 게시하고 ts를 기록한다.
- Slack → HR앱: 채널 최근 메시지를 hr_slack_notices에 통째로 올린다(봇이 올린 HR앱 공지는 제외).
- 필요: .secret/slack_token.txt (Bot token xoxb-…, 권한 channels:history·chat:write·users:read),
        config.json의 slack_channel, 봇을 채널에 초대(/invite).
"""
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime

from publish import BASE, SSL_CTX, rpc

SLACK_TOKEN = BASE / ".secret" / "slack_token.txt"
HISTORY_LIMIT = 200


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


def plain(text, names):
    """Slack 표기(<@U…>, <url|글자>, &amp;)를 화면용 글자로 바꾼다."""
    text = re.sub(r"<@(\w+)>", lambda m: "@" + names(m.group(1)), text)
    text = re.sub(r"<!(here|channel|everyone)[^>]*>", r"@\1", text)
    text = re.sub(r"<#\w+\|([^>]+)>", r"#\1", text)
    text = re.sub(r"<(https?://[^|>]+)\|([^>]+)>", r"\2 (\1)", text)
    text = re.sub(r"<(https?://[^>]+)>", r"\1", text)
    return text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def post_web_notices(cfg, channel):
    n = 0
    for x in rpc(cfg, "hr_notices_unposted", {}):
        head = ("📌 " if x["important"] else "") + f"*[공지] {x['title']}*"
        body = "\n".join(s for s in (head, x["body"], f"— {x['author']} (HR앱)" if x["author"] else "") if s)
        res = slack("chat.postMessage", {"channel": channel, "text": body}, post=True)
        rpc(cfg, "hr_notice_posted", {"p_id": x["id"], "p_ts": res["ts"]})
        n += 1
    return n


def pull_channel(cfg, channel):
    bot = slack("auth.test", {})
    cache = {}

    def names(uid):
        if uid not in cache:
            try:
                p = slack("users.info", {"user": uid})["user"]
                cache[uid] = p.get("profile", {}).get("display_name") or p.get("real_name") or p.get("name") or uid
            except RuntimeError:
                cache[uid] = uid
        return cache[uid]

    items = []
    for m in slack("conversations.history", {"channel": channel, "limit": HISTORY_LIMIT})["messages"]:
        if m.get("subtype") not in (None, "file_share", "thread_broadcast"):
            continue  # 입장·퇴장 등 시스템 메시지
        if m.get("user") == bot["user_id"] or m.get("bot_id") == bot.get("bot_id"):
            continue  # HR앱에서 올린 공지는 hr_notices에 이미 있다
        text = plain(m.get("text", ""), names)
        files = [f.get("name") or f.get("title") or "" for f in m.get("files", [])]
        if files:
            text += "\n" + "\n".join(f"📎 {f}" for f in files if f)
        if not text.strip():
            continue
        base = cfg.get("slack_url", "").rstrip("/")
        link = f"{base}/archives/{channel}/p{m['ts'].replace('.', '')}" if base else ""
        items.append({
            "ts": m["ts"],
            "author": names(m["user"]) if m.get("user") else (m.get("username") or ""),
            "text": text.strip(),
            "date": datetime.fromtimestamp(float(m["ts"])).date().isoformat(),
            "edited": "edited" in m,
            "reply_count": m.get("reply_count", 0),
            "permalink": link,
        })
    return rpc(cfg, "hr_put_slack", {"p_items": items})


def sync(cfg):
    """동기화 결과 문구. 설정이 없으면 None. 실패해도 배포는 계속한다."""
    channel = cfg.get("slack_channel")
    if not channel or not SLACK_TOKEN.exists():
        return None
    try:
        posted = post_web_notices(cfg, channel)
        pulled = pull_channel(cfg, channel)
        return f"Slack 공지 동기화 · 가져옴 {pulled}건 · 게시 {posted}건"
    except Exception as e:  # Slack 장애·권한 문제로 데이터 배포까지 막지 않는다
        return f"[경고] Slack 공지 동기화 실패: {e}"
