"""원드라이브 '26년 검토의견서 폴더 실시간 감시 → 협의검토 바로 갱신.

  python tools/review_watch.py          # 계속 실행(로그온 때 자동 시작하도록 작업 스케줄러에 등록)
  python tools/review_watch.py --once   # 한 번만 갱신하고 끝(시험용)

- config.json의 review_watch_dir(원드라이브 동기화 폴더)을 review_watch_interval초(기본 30초)마다 살펴본다.
- 파일이 새로 생기거나 바뀌거나 지워지면, 올리기가 끝나도록 review_watch_settle초(기본 60초) 동안
  더 바뀌지 않는 것을 확인한 뒤 review_update.py onedrive(원드라이브 수집 → 가공 → HR앱 업로드)를 실행한다.
- 시작할 때 한 번 갱신한다(꺼져 있던 동안 올라온 파일 반영). 웹 화면은 5분마다·탭을 다시 열 때 새 데이터를 읽는다.
- 기록: logs/review_YYYYMMDD.log
"""
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import server  # noqa: E402

LOGS = BASE / "logs"
# 한글·엑셀이 편집 중에 만드는 임시 파일, 원드라이브 동기화 중 파일은 변화로 보지 않는다
IGNORE_PREFIX = ("~$", ".~", "~")
IGNORE_SUFFIX = (".tmp", ".partial", ".crdownload", ".lock")


def log(msg):
    LOGS.mkdir(exist_ok=True)
    line = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] [감시] {msg}"
    print(line, flush=True)
    with (LOGS / f"review_{datetime.now():%Y%m%d}.log").open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def snapshot(root):
    """폴더 아래 모든 파일의 (크기, 수정시각). 읽지 못한 파일은 건너뛴다."""
    snap = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in filenames:
            if name.startswith(IGNORE_PREFIX) or name.lower().endswith(IGNORE_SUFFIX):
                continue
            p = os.path.join(dirpath, name)
            try:
                st = os.stat(p)
            except OSError:
                continue
            snap[os.path.relpath(p, root)] = (st.st_size, int(st.st_mtime))
    return snap


def describe(old, new):
    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    changed = sorted(k for k in set(old) & set(new) if old[k] != new[k])
    parts = [f"{label} {len(xs)}건({', '.join(xs[:3])}{' 외' if len(xs) > 3 else ''})"
             for label, xs in (("추가", added), ("변경", changed), ("삭제", removed)) if xs]
    return " · ".join(parts)


def update():
    """review_update.py onedrive 실행. 실패해도 감시는 계속한다."""
    res = subprocess.run([sys.executable, str(BASE / "tools" / "review_update.py"), "onedrive"], cwd=BASE,
                         env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    log("HR앱 반영 완료" if res.returncode == 0 else f"갱신 실패(종료코드 {res.returncode}) — 다음 변화 때 다시 시도")
    return res.returncode == 0


def main():
    cfg = server.load_config()
    root = cfg.get("review_watch_dir")
    if not root:
        raise SystemExit("config.json에 review_watch_dir(원드라이브 '26년 검토의견서 폴더 경로)를 입력하세요.")
    if not os.path.isdir(root):
        raise SystemExit(f"감시할 폴더가 없습니다: {root}\n원드라이브 동기화(이 PC에 항상 유지) 여부와 경로를 확인하세요.")
    interval = max(int(cfg.get("review_watch_interval", 30)), 5)
    settle = max(int(cfg.get("review_watch_settle", 60)), 0)

    log(f"시작 — {root} (확인 {interval}초 간격, 올리기 끝 대기 {settle}초)")
    last = snapshot(root)
    update()
    if "--once" in sys.argv:
        return

    pending_since = None  # 마지막 변화를 본 시각
    while True:
        time.sleep(interval)
        try:
            now = snapshot(root)
        except OSError as e:
            log(f"폴더를 읽지 못함: {e}")
            continue
        if now != last:
            log("변화 감지 — " + describe(last, now))
            last = now
            pending_since = time.monotonic()
            continue
        if pending_since is not None and time.monotonic() - pending_since >= settle:
            pending_since = None
            update()
            last = snapshot(root)  # 갱신하는 동안 생긴 변화는 다음 확인에서 잡는다


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except KeyboardInterrupt:
        log("종료")
