-- PC 배포(publish.py → hr_put_snapshot)가 협의검토를 옛 엑셀(2026-11-04 dash_cases_2026.csv)로 덮어쓰지 않게 한다 (2026-11-20).
--   협의검토(reviews)는 이제 웹의 SIMS 엑셀 반영(hr_sims_import)·원드라이브 날짜(hr_onedrive_dates)만 바꾼다.
--   PC 작업 스케줄러 '정책평가팀 HR 웹배포'가 아직 돌고 있어도, DB에 있는 reviews를 그대로 둔다.
create or replace function public.hr_put_snapshot(p_token text, p_data jsonb, p_members jsonb) returns integer
language plpgsql security definer set search_path to '' as $$
declare n int;
begin
  perform public.hr_check_token(p_token);
  insert into public.hr_snapshot (id, data, updated_at) values ('main', p_data, now())
    on conflict (id) do update
      set data = case when public.hr_snapshot.data ? 'reviews'
                      then excluded.data || jsonb_build_object('reviews', public.hr_snapshot.data -> 'reviews')
                      else excluded.data end,
          updated_at = now();
  update public.hr_members m set active = false
    where lower(m.email) not in (select lower(x ->> 'email') from jsonb_array_elements(p_members) x);
  insert into public.hr_members (email, name, is_admin, active)
    select lower(x ->> 'email'), x ->> 'name', coalesce((x ->> 'is_admin')::boolean, false), true
    from jsonb_array_elements(p_members) x
    on conflict (email) do update set name = excluded.name, is_admin = excluded.is_admin, active = true;
  select count(*) into n from public.hr_members where active;
  return n;
end $$;
