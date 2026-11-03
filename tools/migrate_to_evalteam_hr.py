"""HR 데이터 이전: kosievalteam's Project → evalteam_HR (1회).

순서: (1) 새 프로젝트에 배포 토큰 등록 (2) 기존 프로젝트에서 hr_ 표 전체를 내보냄 (3) 새 프로젝트로 넣음
(4) 표마다 건수를 비교해 같으면 config.json의 supabase_url·supabase_key를 새 프로젝트로 바꾼다.
로그인 계정은 옮기지 않는다(팀원이 새로 가입). 사용: python tools/migrate_to_evalteam_hr.py
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402
from publish import BASE, rpc  # noqa: E402

NEW = {"supabase_url": "https://shlaohieozqanatatlzf.supabase.co",
       "supabase_key": "sb_publishable_4ewcesIWvPxP1JL2ck7jvw_hcbWcS68"}


def main():
    cfg = server.load_config()
    if cfg["supabase_url"] == NEW["supabase_url"]:
        raise SystemExit("config.json이 이미 evalteam_HR을 가리킵니다. 이전이 끝난 상태입니다.")
    old = {"supabase_url": cfg["supabase_url"], "supabase_key": cfg["supabase_key"]}

    try:
        rpc(NEW, "hr_set_token_once", {})
        print("1/4 새 프로젝트에 배포 토큰 등록")
    except SystemExit as e:
        if "already set" not in str(e):
            raise
        print("1/4 배포 토큰은 이미 등록돼 있음")

    data = rpc(old, "hr_export_all", {})
    want = {k: len(v) for k, v in data.items()}
    print("2/4 기존 프로젝트에서 내보냄:", want)

    got = rpc(NEW, "hr_import_all", {"p_data": data})
    print("3/4 새 프로젝트에 넣음:", got)
    if got != want:
        raise SystemExit("[오류] 건수가 다릅니다. config.json은 바꾸지 않았습니다.")

    text = (BASE / "config.json").read_text(encoding="utf-8")
    text = text.replace(old["supabase_url"], NEW["supabase_url"]).replace(old["supabase_key"], NEW["supabase_key"])
    json.loads(text)
    (BASE / "config.json").write_text(text, encoding="utf-8")
    print("4/4 config.json을 evalteam_HR로 변경. 이제 배포.bat을 실행하세요.")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
