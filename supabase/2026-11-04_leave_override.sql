-- 근태 등록: 엑셀에서 온 근태도 웹에서 수정·삭제 (2026-11-04)
-- 엑셀 파일은 웹에서 고칠 수 없으므로, 웹 기록(hr_leave)이 엑셀 줄을 '대신'한다.
--   replaces = 대신하는 엑셀 줄의 열쇠 "이름|시작일|종료일|구분(원문)"
--   hidden   = true면 화면에서 숨김(엑셀 근태 삭제, 또는 엑셀 근태를 대신하던 웹 기록 삭제)
-- 권한은 기존 hr_leave 규칙 그대로(본인 이름·관리자만 입력, 작성자·관리자만 수정).
alter table public.hr_leave add column if not exists replaces text;
alter table public.hr_leave add column if not exists hidden boolean not null default false;
