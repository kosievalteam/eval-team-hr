-- 사무용품 신청대장 (2026-11-08). 공용 › 사무용품 신청대장.
-- 팀원 누구나 신청, 수정·삭제는 작성자·관리자(공용 PC 사용대장과 같은 규칙).
create table if not exists public.hr_supply (
  id bigint generated always as identity primary key,
  req_date date not null default current_date,   -- 신청일
  requester text not null,                       -- 요청자
  code text not null default '',                 -- 상품코드
  name text not null,                            -- 상품명
  price integer not null default 0 check (price >= 0),   -- 회원가(원)
  qty integer not null default 1 check (qty > 0),        -- 수량
  url text not null default '' check (url = '' or url ~* '^https?://'),  -- 상품 URL
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger hr_supply_touch before update on public.hr_supply for each row execute function public.hr_touch();
alter table public.hr_supply enable row level security;
create policy hr_supply_read on public.hr_supply for select to authenticated using ((select public.hr_is_member()));
create policy hr_supply_ins on public.hr_supply for insert to authenticated
  with check ((select public.hr_is_member()) and lower(created_by) = (select public.hr_my_email()));
create policy hr_supply_upd on public.hr_supply for update to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()))
  with check ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
create policy hr_supply_del on public.hr_supply for delete to authenticated
  using ((select public.hr_is_admin()) or lower(created_by) = (select public.hr_my_email()));
