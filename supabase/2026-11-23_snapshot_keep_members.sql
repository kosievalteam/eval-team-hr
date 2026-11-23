-- PC 배포(hr_put_snapshot)가 팀원 명단·순서(snapshot members, hr_members)도 바꾸지 않게 한다 (2026-11-23).
--   PC config.json에 없는 새 팀원(이혜선)이 배포 때 비활성화되거나 순서가 옛것으로 돌아가는 일을 막는다.
--   팀원 추가·순서는 DB에서 직접: hr_members(로그인), hr_snapshot.data.members(화면 순서·직위).
create or replace function public.hr_put_snapshot(p_token text, p_data jsonb, p_members jsonb) returns integer
language plpgsql security definer set search_path to '' as $$
declare n int; keep jsonb;
begin
  perform public.hr_check_token(p_token);
  select jsonb_strip_nulls(jsonb_build_object('reviews', data -> 'reviews', 'members', data -> 'members')) into keep
    from public.hr_snapshot where id = 'main';
  insert into public.hr_snapshot (id, data, updated_at) values ('main', p_data, now())
    on conflict (id) do update set data = excluded.data || coalesce(keep, '{}'::jsonb), updated_at = now();
  select count(*) into n from public.hr_members where active;
  return n;
end $$;
