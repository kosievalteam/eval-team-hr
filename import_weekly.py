"""주간업무 엑셀 → 웹(Supabase) 1회 가져오기.

- [평가팀] 2026년 주간업무계획.xlsx (주차별 시트) → hr_weeks(kind=plan) + hr_weekly
- [내부용]정책평가팀 주간업무보고.xlsx (주차별 시트) → hr_weeks(kind=report) + hr_tasks
- 엑셀 시트명이 주차 id가 되므로, 이미 웹에서 추가한 항목도 같은 주차에 그대로 남는다.
- 한 번 가져온 뒤에는 거부한다. 다시 가져오면(--force) 엑셀에서 온 항목을 웹에서 고친 내용이 사라진다.
- 사용: python import_weekly.py [--force]
"""
import re
import sys

import server
from publish import TOKEN, rpc

STATUS_SUFFIX = re.compile(r"_?(초안|최종)\s*$")


def main():
    if not TOKEN.exists():
        raise SystemExit(f"업로드 토큰 파일이 없습니다: {TOKEN}")
    cfg = server.load_config()
    print("주간업무 엑셀 2개를 HR앱(웹)으로 한 번 옮깁니다. 엑셀을 저장하고 닫은 뒤 진행하세요.")
    if input("진행할까요? (y/n) ").strip().lower() not in ("y", "yes", "ㅛ"):
        raise SystemExit("취소했습니다.")
    try:
        plan = server.parse_weekly(cfg["weekly_file"])
        report = server.parse_personal(cfg["personal_file"])
    except Exception as e:
        raise SystemExit(f"[오류] 엑셀을 읽지 못했습니다(열려 있으면 닫고 다시 실행): {e}")
    for w in plan:
        w["title"] = STATUS_SUFFIX.sub("", w["title"]).strip() or w["title"]

    print(f"엑셀 읽음 · 주간업무계획 {len(plan)}주 {sum(len(w['items']) for w in plan)}건 · "
          f"개인별 업무 {len(report)}주 {sum(len(w['tasks']) for w in report)}건")
    res = rpc(cfg, "hr_import_weekly", {"p_plan": plan, "p_report": report, "p_force": "--force" in sys.argv})
    print(f"웹으로 옮김 · 주간업무계획 {res['plan_weeks']}주 {res['items']}건 · "
          f"개인별 업무 {res['report_weeks']}주 {res['tasks']}건")
    print("이제부터 주간업무는 HR앱 화면에서 작성·수정하세요. 엑셀은 더 이상 읽지 않습니다.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
