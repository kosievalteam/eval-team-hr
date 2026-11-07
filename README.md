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
| 업무분장표 | - (Supabase `hr_duty`에만 저장) | 시트처럼 직접 입력·엑셀 범위 붙여넣기, 행·열 추가·삭제 (**관리자만**) |
| 팀주간업무 › 주차별 보기 | - (Supabase에만 저장, 2026-11-03 엑셀에서 1회 이전) | 새 주차 만들기(지난주 계획→이번 주 진행), 업무영역 추가·수정(팀원 누구나), ‘최종’ 주차에서 업무영역별 팀장 검토 체크·전체 검토 완료(관리자) |
| 개인별업무 | - (Supabase에만 저장, 2026-11-03 엑셀에서 1회 이전) | 새 주차 만들기(진행 중 업무 이어받기), 본인 업무 추가·수정 |
| 협의검토 | `사전협의\다운로드\dashboard_data\dash_cases_2026.csv` — 협의번호~접수완료는 SIMS(매일 09:30), 초안·검토본·수정본·최종(팀장)은 원드라이브 ①~④ 폴더 첫 업로드일(폴더에 올라오면 바로 반영) | 검토자·초안·검토본·메모 입력 |
| 공지사항 | - (Supabase에만 저장, Slack과 연동하지 않음) | 작성·수정·삭제 (본인 것) |
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

## 연차 입력 규칙 (구분 열)
- `연차` 1일 / `오전반차`·`오후반차` 0.5일 / `시간단위휴가(10:00~14:00)` 시간÷8
- `공가(…)` 차감 없음, `대외활동(…)`·`출장` → 근무현황에서 ‘출장·외부활동’
- 여러 항목은 쉼표로 구분: `시간단위휴가(10:00~13:00), 대외활동(13:00~15:00)`
- **구분이 비어 있는 행은 공휴일**로 처리 (예: 제헌절, 대체휴일)
- 주말·공휴일은 기간 계산에서 제외

## 협의검토 자동 갱신 (작업 스케줄러, 이 PC가 켜져 있어야 함)
- **실시간 감시** `정책평가팀 HR 검토의견서 감시` 로그온 시 시작 → `tools\review_watch.bat`
  - `config.json`의 `review_watch_dir`(원드라이브 '26년 검토의견서 폴더, ①~④ 폴더의 상위)를 30초마다 살펴봅니다.
  - 파일이 추가·변경·삭제되면 60초 동안 더 바뀌지 않는지(올리기 완료) 확인한 뒤 `review_update.bat onedrive`를 실행합니다 → 1~2분 안에 HR앱 반영.
  - 한글·엑셀 임시 파일(`~$…`, `.tmp`)은 무시합니다. 간격은 `review_watch_interval`·`review_watch_settle`(초)로 조정합니다.
  - 원드라이브에서 그 폴더를 **‘이 디바이스에 항상 유지’**로 두어야 다른 팀원이 올린 파일도 이 PC에 바로 내려옵니다.
  - 등록(한 번, 명령 프롬프트): `schtasks /create /tn "정책평가팀 HR 검토의견서 감시" /tr "\"<HR앱 폴더>\tools\review_watch.bat\"" /sc onlogon /rl limited`
  - 시험: `python tools\review_watch.py --once` (한 번 갱신하고 종료)
- `정책평가팀 HR 협의검토 SIMS` 매일 09:30 → `tools\review_update.bat sims` (SIMS + 원드라이브 수집 → HR앱 업로드)
- `정책평가팀 HR 협의검토 원드라이브` 2시간마다 → `tools\review_update.bat onedrive` (감시가 꺼져 있었을 때를 위한 보완, 휴가 엑셀도 함께 갱신)
- 갱신이 겹치지 않도록 `logs\review_update.lock`으로 한 번에 하나만 실행합니다(앞 실행을 최대 10분 기다림).
- 두 작업 모두 '절전 해제(WakeToRun)'와 '놓친 일정 바로 실행(StartWhenAvailable)'이 켜져 있어, PC가 절전 중이어도 깨워서 돌립니다(종료·최대 절전·로그아웃 상태는 불가).
- 기록: `logs\review_YYYYMMDD.log`. SIMS 수집에는 `사전협의\다운로드\sims_register.py`로 등록한 로그인 정보가 필요합니다.

## 검토의견서 새 파일 Slack 알림
- 실시간 감시(`review_watch.bat`)가 '26년 검토의견서 폴더에 **새 파일**이 올라온 것(올리기 완료 후)을 보면 분야 담당자에게 Slack 개인 메시지를 보냅니다. 파일 수정·삭제는 알리지 않습니다.

| 단계 폴더 | 분야 폴더 | 받는 사람 |
|---|---|---|
| 초안 · 검토본 · 최종(팀장) | 창업, 내수 | 장채윤 |
| 〃 | 수출 | 신경희 |
| 〃 | 경영, 소상공인 | 윤의열 |
| 〃 | 금융, 기술, 인력 | 이은실 |
| 초안만 | 경영, 창업, 내수, 인력, 수출 | 김미정 (위 담당자와 함께) |
| 수정본 | 모든 분야 | 김미정 |

- 폴더 이름에 ‘초안’·‘검토’·‘수정’·‘최종’과 분야 낱말이 들어 있으면 됩니다(예: `①초안\창업\…`). 수정본 폴더는 분야와 관계없이 김미정에게만 알립니다.
- 규칙 변경: `tools/review_notify.py`의 `NOTIFY_RULES`, 또는 `config.json`에 같은 모양의 `review_notify` 목록을 넣으면 그것을 씁니다.
- 한 사람에게 같은 때 올라온 여러 파일은 한 메시지로 묶습니다. 감시가 꺼져 있던 동안 올라온 파일은 다시 켤 때 알립니다(`logs\review_watch_seen.json`).
- 준비(한 번):
  1. https://api.slack.com/apps → Create New App → From a manifest → `slack_app_manifest.json` 붙여넣기 → Install to Workspace
  2. Bot User OAuth Token(`xoxb-…`)을 `.secret\slack_token.txt`에 저장
  3. Slack에서 이름으로 찾지 못하는 사람은 `config.json`의 `slack_users`에 `"이름": "U…"`(멤버 ID)를 적음
  4. 시험: `python tools\review_notify.py "①초안\창업\시험.hwpx"` (누구에게 갈지만 표시) → `--send`를 붙이면 실제 발송

## SIMS 로그인 (크롬 로그인 상태 재사용)
- 비밀번호 대신, 자동 수집 전용 크롬 창에서 사람이 한 번 로그인한 상태(쿠키)를 저장해 씁니다. 인증서·문자 인증이 있어도 됩니다.
- 준비(한 번): `pip install playwright` — PC에 설치된 Google Chrome을 쓰므로 `playwright install`은 필요 없습니다.
- 로그인: `tools\sims_login.bat` → 열린 크롬 창에서 SIMS 로그인 → 협의현황이 보이면 콘솔에서 Enter
  - 평소 쓰는 크롬과 분리된 전용 프로필(`.secret\sims_chrome`)이라 평소 크롬이 켜져 있어도 됩니다.
  - 저장 위치: `.secret\sims_state.json`, `.secret\sims_cookies.json` (git 제외, 비밀번호는 저장하지 않음)
- 로그인 유지: 실시간 감시(`review_watch.bat`)가 `sims_keepalive_min`분(기본 20분)마다 SIMS에 접속해 시간 초과로 끊기지 않게 합니다.
  끊기면 `logs\review_YYYYMMDD.log`에 "SIMS 로그인 유지 실패"가 남습니다 → `sims_login.bat`을 다시 실행하세요.
- 매일 09:30 수집(`review_update.bat sims`)은 먼저 로그인 상태를 확인·갱신한 뒤 `sims_sync.py`를 실행합니다.
- 확인: `python tools\sims_browser.py check` (유지 중이면 종료코드 0, 끊겼으면 2) · `python tools\sims_browser.py show` (쿠키 이름·만료)
- `sims_sync.py`에서 쓰는 법: `sys.path.insert(0, r"<HR앱 폴더>\tools")` 후 `from sims_browser import requests_session` →
  `requests_session().get(url)` (또는 urllib 요청에 `{"Cookie": cookie_header()}`). 기존 아이디·비밀번호 로그인 부분은 빼면 됩니다.

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
- `sims_url`: SIMS 첫 화면 주소 / `sims_keepalive_min`: 로그인 유지 간격(분, 0이면 끔)
- `review_watch_dir`: 실시간 감시할 원드라이브 '26년 검토의견서 폴더 / `review_watch_interval`(기본 30초)·`review_watch_settle`(기본 60초)
- `supabase_url`, `supabase_key`: Supabase 주소와 공개(publishable) 키
- 엑셀 경로·포트 변경도 여기서
