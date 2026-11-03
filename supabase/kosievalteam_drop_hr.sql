-- [kosievalteam's Project] HR앱 이전 완료 후 기존 HR 표·함수 삭제 (2026-11-04)
-- evalteam_HR로 옮겨진 것을 확인한 뒤에만 기존 프로젝트의 SQL Editor에서 Run. 되돌릴 수 없다.
-- 다른 앱과 함께 쓰는 가입 제한(restrict_signup_domain)과 로그인 계정은 건드리지 않는다.
drop table if exists public.hr_weekly, public.hr_tasks, public.hr_weeks, public.hr_leave, public.hr_notices,
  public.hr_slack_notices, public.hr_review, public.hr_pc_log, public.hr_snapshot, public.hr_upload_token,
  public.hr_members cascade;
drop function if exists public.hr_export_all(text), public.hr_import_weekly(text, jsonb, jsonb, boolean),
  public.hr_new_week(text, text, text, text, text, date, date, text), public.hr_put_snapshot(text, jsonb, jsonb),
  public.hr_put_slack(text, jsonb), public.hr_notices_unposted(text), public.hr_notice_posted(text, uuid, text),
  public.hr_check_token(text), public.hr_weekly_guard(), public.hr_touch(), public.hr_member_email(text),
  public.hr_my_name(), public.hr_my_email(), public.hr_is_admin(), public.hr_is_member() cascade;
