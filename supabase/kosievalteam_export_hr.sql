-- [kosievalteam's Project] HR 데이터 내보내기 함수 (HR앱 → evalteam_HR 이전용, 2026-11-04)
-- 기존 프로젝트의 SQL Editor에서 Run. 배포 토큰이 있어야만 호출된다. 이전이 끝나면 kosievalteam_drop_hr.sql로 함께 지운다.
create or replace function public.hr_export_all(p_token text) returns jsonb
language plpgsql security definer set search_path to '' as $$
begin
  perform public.hr_check_token(p_token);
  return jsonb_build_object(
    'hr_members',       (select coalesce(jsonb_agg(t), '[]') from public.hr_members t),
    'hr_weeks',         (select coalesce(jsonb_agg(t), '[]') from public.hr_weeks t),
    'hr_weekly',        (select coalesce(jsonb_agg(t order by t.id), '[]') from public.hr_weekly t),
    'hr_tasks',         (select coalesce(jsonb_agg(t order by t.id), '[]') from public.hr_tasks t),
    'hr_leave',         (select coalesce(jsonb_agg(t order by t.id), '[]') from public.hr_leave t),
    'hr_pc_log',        (select coalesce(jsonb_agg(t order by t.id), '[]') from public.hr_pc_log t),
    'hr_notices',       (select coalesce(jsonb_agg(t), '[]') from public.hr_notices t),
    'hr_review',        (select coalesce(jsonb_agg(t), '[]') from public.hr_review t),
    'hr_slack_notices', (select coalesce(jsonb_agg(t), '[]') from public.hr_slack_notices t));
end $$;
revoke execute on function public.hr_export_all(text) from public, authenticated;
grant execute on function public.hr_export_all(text) to anon;
