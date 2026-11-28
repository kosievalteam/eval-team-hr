-- 원드라이브 복무 엑셀([평가팀] 2026년 연차 일정.xlsx, 시트 '연차입력') → 복무관리(hr_leave) 자동 반영 (2026-11-28).
--   onedrive-sync 함수가 5분마다 엑셀을 읽어(파일이 바뀐 경우만) 새 행을 근태로 넣는다. 공휴일(구분 빈 행)은 스냅샷 holidays로.
--   같은 사람·같은 기간에 구분이 같으면(공백 무시) 이미 있는 근태로 본다. 연차·반차·공가는 종류만 같아도 같다고 본다.
--   시간단위·출장·외부활동은 시간이 다르면 따로 남긴다(2026-11-28 김미정 결정: 둘 다 남기기).
--   엑셀에서 넣은 근태(inserted)는 엑셀에서 그 행이 바뀌거나 지워지면, 웹에서 고치지 않은 경우에 한해 같이 지운다.
alter table public.hr_onedrive add column if not exists leave_url text;
alter table public.hr_onedrive add column if not exists leave_etag text;
alter table public.hr_onedrive add column if not exists leave_result jsonb;
alter table public.hr_onedrive add column if not exists leave_enabled boolean not null default false;
-- leave_url은 공개 저장소에 적지 않는다: update public.hr_onedrive set leave_url = '<원드라이브 공유 링크>', leave_enabled = true where id = 1;

create table if not exists public.hr_leave_excel (
  key text primary key,                       -- 이름|시작|종료|구분(공백 제거)
  leave_id bigint,
  inserted boolean not null default false,
  row_no int,
  created_at timestamptz not null default now()
);
alter table public.hr_leave_excel enable row level security;

create or replace function public.hr_set_holidays(p_holidays jsonb) returns void
language sql security definer set search_path to '' as $$
  update public.hr_snapshot set data = jsonb_set(data, '{holidays}', p_holidays), updated_at = now()
   where id = 'main' and (data -> 'holidays') is distinct from p_holidays;
$$;
revoke execute on function public.hr_set_holidays(jsonb) from public, anon, authenticated;
