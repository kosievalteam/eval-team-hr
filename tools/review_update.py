"""협의검토 자동 갱신 (작업 스케줄러가 실행).

  python tools/review_update.py sims      # 매일 09:30 — SIMS(협의번호~접수완료) + 원드라이브 → HR앱 업로드
  python tools/review_update.py onedrive  # 원드라이브 ①~④ 폴더(초안·검토본·수정본·최종) → HR앱 업로드
                                          # (review_watch.py가 폴더 변화 때 바로 실행, 작업 스케줄러가 2시간마다 보완 실행)

수집은 사전협의 다운로드 폴더(config.json review_file의 상위 폴더)의 스크립트를 그대로 쓰고,
결과(dash_cases_2026.csv)를 publish.py가 읽어 Supabase에 올린다(화면 푸시 없음).
기록: logs/review_YYYYMMDD.log
동시에 두 번 돌지 않도록 logs/review_update.lock으로 막는다(앞 실행이 끝날 때까지 최대 10분 기다림).
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
LOCK = LOGS / "review_update.lock"
LOCK_WAIT = 10 * 60   # 앞 실행을 기다리는 최대 시간(초)
LOCK_STALE = 60 * 60  # 이보다 오래된 잠금은 비정상 종료의 흔적으로 보고 지운다
STEPS = {
    "sims": [("SIMS 수집", "sims_sync.py", True), ("원드라이브 수집", "onedrive_sync.py", False), ("가공", "build_dashboard_data.py", True)],
    "onedrive": [("원드라이브 수집", "onedrive_sync.py", True), ("가공", "build_dashboard_data.py", True)],
}


def acquire_lock():
    LOGS.mkdir(exist_ok=True)
    start = time.time()
    while True:
        try:
            os.close(os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
            return True
        except FileExistsError:
            try:
                if time.time() - LOCK.stat().st_mtime > LOCK_STALE:
                    LOCK.unlink(missing_ok=True)
                    continue
            except FileNotFoundError:
                continue
            if time.time() - start > LOCK_WAIT:
                return False
            time.sleep(5)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode not in STEPS:
        raise SystemExit("사용: python tools/review_update.py sims|onedrive")
    if not acquire_lock():
        raise SystemExit(f"다른 협의검토 갱신이 {LOCK_WAIT // 60}분 넘게 끝나지 않아 이번 실행을 건너뜁니다: {LOCK}")
    try:
        run_mode(mode)
    finally:
        LOCK.unlink(missing_ok=True)


def run_mode(mode):
    collector = Path(server.load_config()["review_file"]).resolve().parent.parent
    LOGS.mkdir(exist_ok=True)
    log = (LOGS / f"review_{datetime.now():%Y%m%d}.log").open("a", encoding="utf-8")

    def write(msg):
        line = f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}"
        print(line)
        log.write(line + "\n")
        log.flush()

    def run(name, args, cwd, required):
        write(f"{name} 시작")
        res = subprocess.run([sys.executable, *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                             errors="replace", env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
        out = (res.stdout + res.stderr).strip()
        if out:
            log.write(out[-4000:] + "\n")
        if res.returncode:
            write(f"{name} 실패 (종료코드 {res.returncode})" + ("" if required else " — 이전 결과로 계속"))
            if required:
                raise SystemExit(1)
        return res.returncode == 0

    # 작업 스케줄러가 절전에서 깨워 실행하므로, 끝날 때까지 다시 절전에 들지 않게 한다(끝나면 자동 해제)
    if sys.platform == "win32":
        import ctypes
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001)  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    write(f"== 협의검토 갱신({mode}) ==")
    for name, script, required in STEPS[mode]:
        run(name, [script], collector, required)
    run("HR앱 업로드", ["publish.py", "--no-push"], BASE, True)
    write("완료")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
