# 정책평가팀 HR관리앱

OneDrive 팀서무 폴더의 엑셀(기본 데이터)과 웹 입력(Supabase)을 합쳐 보여주는 웹앱입니다.

## 실행
- 웹: https://evalteamhr.vercel.app/ (또는 https://kosievalteam.github.io/eval-team-hr/) → `@kosi.re.kr` 계정으로 로그인 (HR앱 전용 계정)
- 로컬: `HR앱 실행.bat` 더블클릭 → http://127.0.0.1:8765 (엑셀을 바로 읽음, 로그인은 동일)
- 필요: Python 3, `pip install openpyxl`

## 데이터 연결
| 메뉴 | 엑셀 원본 | 웹에서 할 수 있는 일 |
|---|---|---|
| 대시보드 · 복무관리 | `[평가팀] 2026년 연차 일정.xlsx` › `연차입력` 시트 | 근태 등록·수정·삭제 (본인 것) |
| 주간업무관리 › 주차별 보기 | - (Supabase에만 저장, 2026-11-03 엑셀에서 1회 이전) | 새 주차 만들기(지난주 계획→이번 주 진행), 업무영역 추가·수정(팀원 누구나), ‘최종’ 주차에서 업무영역별 팀장 검토 체크·전체 검토 완료(관리자) |
| 주간업무관리 › 개인별 업무 | - (Supabase에만 저장, 2026-11-03 엑셀에서 1회 이전) | 새 주차 만들기(진행 중 업무 이어받기), 본인 업무 추가·수정 |
| 협의검토관리 › 진행현황 | `'26년 검토의견서\사전협의 접수 및 검토 현황_*.xlsx` (파일명 날짜가 가장 최근인 파일) | 담당자·초안작성·초안검토·중기청송부·메모 입력 |
| 협의검토관리 › 대시보드 | https://kosievalteam.github.io/newbiz_dashboard/ 를 화면 안에 표시 | - |
| 공지사항 | Slack 전체공지 채널 (배포 때 동기화) | 작성·수정·삭제 (본인 것). 새 공지는 다음 배포 때 Slack에도 게시 |
| 공용 PC 사용대장 | - (Supabase에만 저장) | 사용시작·사용종료 일시, 사용자, 용도 기록(‘사용 종료’ 버튼), 수정·삭제 (본인 것) |

- 웹에서 입력한 항목에는 **웹** 표시가 붙고, 협의검토 진행현황의 웹 입력값은 **파란 글씨**로 엑셀 값보다 우선합니다.
- 웹 입력은 엑셀 원본에 자동으로 쓰이지 않습니다. 엑셀에 옮겨 적었다면 웹 항목은 삭제(협의검토는 ‘엑셀 값으로 되돌리기’)해야 중복되지 않습니다.
- 엑셀에서 온 항목은 웹에서 수정할 수 없습니다(엑셀에서 고친 뒤 배포).
- 관리자(`config.json`의 `admin: true`)는 모든 웹 입력을 수정·삭제하고 다른 팀원 이름으로 입력할 수 있습니다.

## 주간업무 엑셀 → 웹 이전 (1회)
1. `supabase/2026-11-03_weekly_web.sql`을 Supabase SQL Editor에서 실행 (주차 테이블·가져오기 함수 추가)
2. 두 엑셀을 저장하고 닫은 뒤 `주간업무_가져오기.bat` 실행 → 모든 주차·업무가 웹으로 옮겨짐
3. 이후로는 웹에서만 작성합니다. 엑셀(`weekly_file`, `personal_file`)은 더 이상 읽지 않습니다.
- 다시 가져오기는 막혀 있습니다(`python import_weekly.py --force`로 강제 가능하지만, 엑셀에서 온 항목의 웹 수정 내용이 사라집니다).

## 주간업무 한글(HWPX) 내려받기
- ‘최종’ 주차에서 팀장 검토가 모두 끝나면 주차별 보기에 **⬇ 주간업무계획**·**⬇ 핵심업무계획** 버튼이 나타납니다.
- 양식: `static/templates/weekly_plan.hwpx`, `weekly_key.hwpx` — 실제 주간 문서(HWPX)에서 내용만 비운 견본(저장소 공개라 실제 내용은 넣지 않음)
  - 양식이 바뀌면 한글에서 새 문서를 HWPX로 저장한 뒤: `python tools/make_hwpx_templates.py <주간업무계획.hwpx> <주간핵심업무계획.hwpx>`
- 업무영역 표기: 만족도조사 → 정책만족도, 현황조사 → 현황조사 및 현행화 (`static/app.js`의 `AREA_HWP`)
- 계획 칸에서 진행 칸과 달라진 낱말은 양식처럼 파란 글자로 표시합니다. 핵심업무계획에는 각 업무영역의 ‘핵심 업무 계획’ 줄이 들어갑니다.

## Slack 공지 연동
- `배포.bat`이 실행될 때 `slack_sync.py`가 양방향으로 동기화합니다(실패해도 배포는 계속).
  - Slack → HR앱: `config.json`의 `slack_channel` 최근 200개 메시지를 공지사항에 **Slack** 표시로 보여줌(읽기 전용)
  - HR앱 → Slack: 아직 게시하지 않은 웹 공지를 채널에 게시. 게시 후 수정·삭제는 Slack에 반영되지 않음
- 필요: Slack 앱 Bot token(`xoxb-…`, 권한 `channels:history`·`groups:history`·`chat:write`·`users:read`, `slack_app_manifest.json`으로 생성)을 `.secret/slack_token.txt`에 저장하고, 채널에서 `/invite @앱이름`

## 연차 입력 규칙 (구분 열)
- `연차` 1일 / `오전반차`·`오후반차` 0.5일 / `시간단위휴가(10:00~14:00)` 시간÷8
- `공가(…)` 차감 없음, `대외활동(…)`·`출장` → 근무현황에서 ‘출장·외부활동’
- 여러 항목은 쉼표로 구분: `시간단위휴가(10:00~13:00), 대외활동(13:00~15:00)`
- **구분이 비어 있는 행은 공휴일**로 처리 (예: 제헌절, 대체휴일)
- 주말·공휴일은 기간 계산에서 제외

## 웹 배포
- 주소: GitHub Pages(https://kosievalteam.github.io/eval-team-hr/)와 Vercel(프로덕션) 두 곳. 둘 다 `docs/`를 그대로 서비스합니다.
  - Vercel은 GitHub 저장소 연결 방식: main에 푸시되면 자동으로 프로덕션 배포(`vercel.json`: 빌드 없음, 출력 폴더 `docs`).
  - Vercel(Hobby)은 프로젝트 소유 계정이 작성한 커밋만 자동 배포합니다. 그래서 이 저장소의 커밋 작성자는 `kosievalteam <kosi.evalteam@gmail.com>`으로 둡니다(`git config --local`).
- `배포.bat` 실행 → 엑셀을 읽어 Supabase(`hr_snapshot`)에 올리고, 화면 파일이 바뀌었으면 `docs/`를 GitHub에 푸시합니다.
  - 데이터만 바뀐 경우 푸시 없이 바로 웹에 반영됩니다.
  - 업로드는 `.secret/hr_upload_token.txt` 토큰이 있어야 됩니다(`.gitignore`로 제외, 이 PC에만 보관).
- 자동 갱신: Windows 작업 스케줄러 `정책평가팀 HR 웹배포`가 평일 09:00·13:00·18:00에 `배포.bat /auto`를 실행합니다(PC가 켜져 있어야 함).
- 저장소(공개)에는 화면 파일만 올라갑니다. 데이터는 Supabase에서 팀원 로그인 후에만 읽을 수 있습니다(RLS).

## 계정·팀원 명단
- 로그인 계정은 HR앱 전용 Supabase 프로젝트 `evalteam_HR`의 Auth 계정입니다(`@kosi.re.kr`만 가입 가능). 2026-11-04에 `kosievalteam's Project`에서 데이터를 옮겼고(tools/migrate_to_evalteam_hr.py), 계정은 팀원이 새로 가입했습니다.
- `config.json`의 `members[].email`에 있는 계정만 HR앱에 들어올 수 있습니다. 명단을 바꾸면 `배포.bat`을 실행해야 반영됩니다.
- 계정이 없는 팀원은 로그인 화면의 ‘가입하기’로 만듭니다. 비밀번호를 잊으면 ‘비밀번호를 잊었나요?’로 재설정 메일을 받습니다.
- `evalteam_HR`은 HR앱 전용이라 Authentication › URL Configuration의 **Site URL**을 `https://evalteamhr.vercel.app`으로 둡니다.
  **Redirect URLs**: `https://evalteamhr.vercel.app/**`, `https://kosievalteam.github.io/eval-team-hr/**` (HR앱은 메일 링크를 지금 주소로 돌아오게 지정)

## 설정 (`config.json`)
- `members[]`: `name`, `email`(로그인 계정), `admin`, `total`(2026년 부여 연차일수), `prior_used`(엑셀 기록 전 사용 일수)
- `review_file`: 사전협의 접수·검토 현황 엑셀 경로 (`*` 사용 시 파일명이 가장 뒤인 파일)
- `supabase_url`, `supabase_key`: Supabase 주소와 공개(publishable) 키
- 엑셀 경로·포트 변경도 여기서
