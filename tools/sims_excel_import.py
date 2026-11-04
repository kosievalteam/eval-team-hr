"""SIMS 사전협의 목록 엑셀(직접 내려받은 파일)로 협의검토 수집본을 갱신한다.

SIMS 자동 수집(sims_sync.py)이 로그인 문제 등으로 안 될 때 쓴다.
  python tools/sims_excel_import.py 사전협의_20261104.xlsx         # 반영 + 가공 + HR앱 업로드
  python tools/sims_excel_import.py 사전협의_20261104.xlsx --dry   # 바뀔 내용만 보기

목록 엑셀에는 상세 화면의 일부 값만 있으므로, 기존 수집본(cases_2026.csv)에 아래 값만 덮어쓴다.
  진행상태 → 진행단계(협의완료·재협의완료면 최종결과도), 검토담당자,
  접수완료·검토완료(월-일) → 비어 있던 접수완료일시·검토의견등록일시(엑셀 '검토완료' = 검토의견등록일, 192건 대조 일치;
    접수반려 건은 채우지 않음 — 엑셀 날짜가 반려일과 다르고, 상세 수집본도 비워 둠),
  메모 → 공백을 뺀 내용이 달라졌을 때만(엑셀은 줄바꿈이 빠짐), 메모확인일시 = 엑셀 날짜
신청일시·회신·재검토 같은 상세 값은 엑셀에 없어 기존 값을 유지한다. 엑셀에만 있는 새 협의건은 엑셀 값으로 추가.
반영 전 cases_2026.csv를 cases_2026.backup_YYYYMMDD_HHMMSS.csv로 남긴다.
"""
import csv
import json
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import openpyxl

BASE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE))
import server  # noqa: E402

DONE = ("협의완료", "재협의완료")


def md(s, year):
    """'10-30' → '2026-10-30', '-'·빈칸 → ''"""
    s = str(s or "").strip()
    return f"{year}-{s}" if re.fullmatch(r"\d{2}-\d{2}", s) else ""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry" in sys.argv
    if not args:
        raise SystemExit(__doc__)
    xlsx = Path(args[0]).resolve()
    collector = Path(server.load_config()["review_file"]).resolve().parent.parent
    data = collector / "dashboard_data"
    cases_f, status_f = data / "cases_2026.csv", data / "sync_status.json"

    ws = openpyxl.load_workbook(xlsx, data_only=True).worksheets[0]
    title = str(ws.cell(1, 1).value or "")
    head_row = next(i for i, r in enumerate(ws.iter_rows(min_row=1, max_row=5, values_only=True), 1) if "협의번호" in r)
    head = [str(c or "").strip() for c in next(ws.iter_rows(min_row=head_row, max_row=head_row, values_only=True))]
    xl = {}
    for r in ws.iter_rows(min_row=head_row + 1, values_only=True):
        x = dict(zip(head, ["" if v is None else str(v).strip() for v in r]))
        if x.get("협의번호"):
            xl[x["협의번호"].replace("_", "-")] = x
    # 엑셀 날짜: 제목(사전협의_20261104) → 없으면 파일 수정일. 시각은 파일 수정 시각
    mt = datetime.fromtimestamp(xlsx.stat().st_mtime)
    m = re.search(r"(20\d{6})", title or xlsx.name)
    stamp = datetime.strptime(m.group(1), "%Y%m%d").replace(hour=mt.hour, minute=mt.minute) if m else mt
    year = stamp.year

    with cases_f.open(encoding="utf-8") as f:
        rd = csv.DictReader(f)
        fields, rows = rd.fieldnames, list(rd)
    by_no = {r["협의번호"]: r for r in rows}
    squash = lambda s: re.sub(r"\s+", "", s or "")
    log = []
    for no, x in xl.items():
        r = by_no.get(no)
        if r is None:  # 새 협의건: 엑셀 값으로 추가
            r = {k: "" for k in fields}
            name = " · ".join(v for v in (x.get("세부사업명"), x.get("내역사업명"), x.get("내내역사업명")) if v)
            r.update({"협의번호": no, "구분": x.get("구분", ""), "부처": x.get("신청기관명", ""), "신청유형": x.get("신청유형", ""),
                      "신청분야": x.get("신청분야", ""), "세부사업명": x.get("세부사업명", ""),
                      "사업명": x.get("내내역사업명") or x.get("내역사업명") or x.get("세부사업명", ""), "신청년도": str(year)})
            rows.append(r)
            by_no[no] = r
            log.append(f"{no} 새 협의건 추가: {name}")
        st = x.get("진행상태", "")
        if st and r["진행단계"] != st:
            log.append(f"{no} 진행상태 {r['진행단계'] or '-'} → {st}")
            r["진행단계"] = st
            r["최종결과"] = st if st.startswith(DONE) else ""
        who = x.get("검토담당자", "")
        if who != r["검토담당자"] and (who or st != "접수반려"):
            log.append(f"{no} 검토담당자 {r['검토담당자'] or '-'} → {who or '-'}")
            r["검토담당자"] = who
        # 접수반려 건은 상세 수집본에서도 접수완료일시를 비워 두고(반려일은 접수반려일시), 엑셀 날짜도 반려일과 달라 채우지 않는다
        for col, key in (("접수완료일시", "접수완료"), ("검토의견등록일시", "검토완료")):
            d = md(x.get(key), year)
            if d and not r[col] and st != "접수반려":
                log.append(f"{no} {key} {d}")
                r[col] = d
        memo = x.get("메모", "")
        if squash(memo) != squash(r["메모"]):
            log.append(f"{no} 메모 변경")
            r["메모"] = memo
            r["메모확인일시"] = stamp.strftime("%Y-%m-%d %H:%M:%S") if memo else ""

    print(f"엑셀 {len(xl)}건 ({title or xlsx.name}, 기준 {stamp:%Y-%m-%d %H:%M}) · 수집본 {len(rows)}건 · 바뀐 곳 {len(log)}개")
    for line in log:
        print("  " + line)
    if dry:
        print("(--dry: 저장하지 않음)")
        return

    backup = data / f"cases_2026.backup_{datetime.now():%Y%m%d_%H%M%S}.csv"
    shutil.copy2(cases_f, backup)
    with cases_f.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    status = json.loads(status_f.read_text(encoding="utf-8"))
    status.update({"collected_at": stamp.strftime("%Y-%m-%d %H:%M"), "count": len(rows), "source": f"엑셀 {xlsx.name}"})
    status_f.write_text(json.dumps(status, ensure_ascii=False), encoding="utf-8")
    print(f"저장: {cases_f.name} (이전 본 {backup.name})")

    env = {**__import__("os").environ, "PYTHONIOENCODING": "utf-8"}
    for script, cwd in (("build_dashboard_data.py", collector), ("publish.py", BASE)):
        res = subprocess.run([sys.executable, script, *(["--no-push"] if script == "publish.py" else [])], cwd=cwd, env=env,
                             capture_output=True, text=True, encoding="utf-8", errors="replace")
        print((res.stdout + res.stderr).strip())
        if res.returncode:
            raise SystemExit(f"{script} 실패 (종료코드 {res.returncode})")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
