-- 회의록 첨부 파일 (2026-11-16). Supabase Storage 비공개 버킷 hr-minutes(파일당 20MB).
-- 파일은 '<회의록 id>/<무작위 id>.<확장자>'로 저장하고, 원래 이름·크기는 hr_minutes.files에 둔다(한글 이름도 그대로 내려받기).
-- 읽기·올리기는 팀원, 지우기는 올린 사람·관리자. 내려받기는 1분짜리 서명 링크로만.

alter table public.hr_minutes add column if not exists files jsonb not null default '[]'::jsonb;  -- [{key, path, name, size, by, at}]

insert into storage.buckets (id, name, public, file_size_limit)
values ('hr-minutes', 'hr-minutes', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

create policy hr_minutes_files_read on storage.objects for select to authenticated
  using (bucket_id = 'hr-minutes' and (select public.hr_is_member()));
create policy hr_minutes_files_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-minutes' and (select public.hr_is_member()));
create policy hr_minutes_files_del on storage.objects for delete to authenticated
  using (bucket_id = 'hr-minutes' and ((select public.hr_is_admin()) or owner = (select auth.uid())));
