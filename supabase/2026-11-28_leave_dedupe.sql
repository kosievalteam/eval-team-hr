-- 복무관리 근태 자동 정리 (2026-11-28). pg_cron 'hr-leave-dedupe'가 5분마다 hr_leave_dedupe()를 실행한다.
--  ① 완전 중복: 같은 사람·시작/종료일·구분(공백 무시)이면 가장 먼저 넣은 1건만 남긴다(비고·엑셀 반영 기록은 남는 건으로 옮김).
--  ② 엑셀↔웹 시간 충돌: 같은 사람·기간·같은 범주(시간단위·출장·외부활동)인데 시간이 겹치면
--     나중에 넣거나 고친 쪽만 남긴다(김미정 결정). 웹끼리·엑셀끼리, 시간이 겹치지 않는 근태는 그대로 둔다.
--     엑셀 쪽이 지워져도 반영 기록(hr_leave_excel)은 남겨 같은 엑셀 행이 다시 들어오지 않게 한다.

create or replace function public.hr_leave_cat(p_kind text) returns text
language sql immutable set search_path to '' as $$
  with parts as (select trim(x) p from unnest(string_to_array(coalesce(p_kind, ''), ',')) x where trim(x) <> ''),
  c as (select case when p like '연차%' then 1 when p like '%오전반차%' then 2 when p like '%오후반차%' then 3
                    when p ~ '^(공가|병가|경조)' then 4 when p ~ '^시간' then 5 when p like '%출장%' then 6
                    when p ~ '대외활동|외근|교육' then 7 else 8 end o from parts)
  select (array['연차','오전반차','오후반차','공가','시간단위','출장','외부활동','기타'])[coalesce(min(o), 8)] from c
$$;

create or replace function public.hr_leave_span(p_kind text) returns int4range
language sql immutable set search_path to '' as $$
  select coalesce((select int4range(m[1]::int * 60 + m[2]::int, m[3]::int * 60 + m[4]::int)
                     from regexp_match(coalesce(p_kind, ''), '(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})') m
                    where m[1]::int * 60 + m[2]::int < m[3]::int * 60 + m[4]::int), int4range(0, 1440))
$$;

create or replace function public.hr_leave_dedupe() returns int
language plpgsql security definer set search_path to '' as $$
declare n int := 0; r record; del_id bigint;
begin
  for r in
    select keep_id, dup_id from (
      select id as dup_id,
             first_value(id) over (partition by name, start_date, end_date, regexp_replace(kind, '\s', '', 'g') order by id) as keep_id
        from public.hr_leave) t
     where dup_id <> keep_id
  loop
    update public.hr_leave k set note = d.note
      from public.hr_leave d where k.id = r.keep_id and d.id = r.dup_id and coalesce(k.note, '') = '' and coalesce(d.note, '') <> '';
    update public.hr_leave_excel set leave_id = r.keep_id, inserted = false where leave_id = r.dup_id;
    delete from public.hr_leave where id = r.dup_id;
    n := n + 1;
  end loop;

  loop
    select case when greatest(a.created_at, a.updated_at) >= greatest(b.created_at, b.updated_at) then b.id else a.id end
      into del_id
      from public.hr_leave a
      join public.hr_leave b on b.name = a.name and b.start_date = a.start_date and b.end_date = a.end_date and b.id <> a.id
      join public.hr_leave_excel ea on ea.leave_id = a.id and ea.inserted
     where not exists (select 1 from public.hr_leave_excel eb where eb.leave_id = b.id and eb.inserted)
       and public.hr_leave_cat(a.kind) in ('시간단위', '출장', '외부활동')
       and public.hr_leave_cat(a.kind) = public.hr_leave_cat(b.kind)
       and public.hr_leave_span(a.kind) && public.hr_leave_span(b.kind)
     limit 1;
    exit when del_id is null;
    delete from public.hr_leave where id = del_id;
    n := n + 1;
    del_id := null;
  end loop;
  return n;
end $$;
revoke execute on function public.hr_leave_dedupe() from public, anon, authenticated;

select cron.unschedule('hr-leave-dedupe') where exists (select 1 from cron.job where jobname = 'hr-leave-dedupe');
select cron.schedule('hr-leave-dedupe', '2-59/5 * * * *', $c$ select public.hr_leave_dedupe() $c$);
