-- 회의록 후속 조치를 표로 (2026-11-20). [{who, task, due, status}] — 담당·할 일·기한·상태(진행/완료).
-- 예전 글자 칸(actions)은 그대로 두고, 값이 있으면 표 아래에 함께 보여 준다.
alter table public.hr_minutes add column if not exists action_items jsonb not null default '[]'::jsonb;
