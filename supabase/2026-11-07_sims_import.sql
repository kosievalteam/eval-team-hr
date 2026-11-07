-- SIMS 사전협의 목록 엑셀을 웹에서 올려 협의검토 현황(hr_snapshot.main.reviews)에 반영 (2026-11-07).
-- PC 자동 수집(sims_sync.py)을 대신한다. 화면(협의검토 › ⬆ SIMS 엑셀 반영)이 엑셀을 읽어 p_items로 넘긴다.
--   p_items: [{no:"2026-0302", state, who, acc:"2026-11-05", rev, memo, kind, agency, type, field, name}]  (날짜는 YYYY-MM-DD, 없으면 "")
--   p_apply = false → 바뀔 내용만 돌려줌(미리보기), true → 반영(직전 상태는 hr_snapshot id 'backup-sims-latest'에 백업)
-- 반영 규칙(tools/sims_excel_import.py와 같음):
--   진행상태·검토담당자(엑셀이 비었고 접수반려면 유지) 덮어쓰기, 접수완료일·검토완료일은 비어 있을 때만 채움(접수반려 제외),
--   새로 접수반려가 된 건은 접수완료일을 비움, 메모는 공백을 뺀 내용이 다를 때만 바꾸고 메모확인일 = 엑셀 날짜,
--   엑셀에만 있는 협의건은 추가. 엑셀에 없는 기존 건은 그대로 둔다.
create or replace function public.hr_sims_import(p_items jsonb, p_file text, p_stamp text, p_apply boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  cur jsonb;
  n_cur int;
  n_x int;
  rows_new jsonb;
  changes jsonb;
  added int;
  d text := left(p_stamp, 10);
begin
  if not public.hr_is_member() then
    raise exception '팀원만 반영할 수 있습니다';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception '엑셀에서 협의건을 읽지 못했습니다';
  end if;
  if d !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception '엑셀 기준일 형식이 잘못되었습니다: %', p_stamp;
  end if;
  select data -> 'reviews' -> 'rows' into cur from public.hr_snapshot where id = 'main' for update;
  cur := coalesce(cur, '[]'::jsonb);
  n_cur := jsonb_array_length(cur);
  n_x := jsonb_array_length(p_items);
  if n_x < n_cur / 2 then  -- 다른 엑셀(필터한 목록 등)을 잘못 올린 경우 막는다
    raise exception '엑셀 협의건(%건)이 현재 목록(%건)의 절반보다 적습니다. SIMS에서 전체 목록을 내려받았는지 확인하세요.', n_x, n_cur;
  end if;

  with x as (
    select * from jsonb_to_recordset(p_items) as x(no text, state text, who text, acc text, rev text, memo text,
                                                    kind text, agency text, type text, field text, name text)),
  c as (select e.r from jsonb_array_elements(cur) e(r)),
  upd as (
    select c.r as old, case when x.no is null then c.r else c.r || jsonb_build_object(
      'state', case when coalesce(x.state, '') <> '' then x.state else c.r ->> 'state' end,
      'assignee', case when coalesce(x.who, '') <> coalesce(c.r ->> 'assignee', '') and (coalesce(x.who, '') <> '' or x.state <> '접수반려')
                       then coalesce(x.who, '') else c.r ->> 'assignee' end,
      'accepted', case when x.state = '접수반려' and coalesce(c.r ->> 'state', '') <> '접수반려' then ''
                       when coalesce(x.acc, '') <> '' and coalesce(c.r ->> 'accepted', '') = '' and x.state <> '접수반려' then x.acc
                       else c.r ->> 'accepted' end,
      'reviewed', case when coalesce(x.rev, '') <> '' and coalesce(c.r ->> 'reviewed', '') = '' and x.state <> '접수반려' then x.rev
                       else c.r ->> 'reviewed' end,
      'memo', case when regexp_replace(coalesce(x.memo, ''), '\s', '', 'g') <> regexp_replace(coalesce(c.r ->> 'memo', ''), '\s', '', 'g')
                   then coalesce(x.memo, '') else c.r ->> 'memo' end,
      'memo_date', case when regexp_replace(coalesce(x.memo, ''), '\s', '', 'g') <> regexp_replace(coalesce(c.r ->> 'memo', ''), '\s', '', 'g')
                        then case when coalesce(x.memo, '') <> '' then d else '' end else c.r ->> 'memo_date' end) end as new
    from c left join x on x.no = c.r ->> 'no'),
  ins as (
    select jsonb_build_object('no', x.no, 'kind', coalesce(x.kind, ''), 'agency', coalesce(x.agency, ''), 'name', coalesce(x.name, ''),
      'type', coalesce(x.type, ''), 'field', coalesce(x.field, ''), 'assignee', coalesce(x.who, ''), 'state', coalesce(x.state, ''),
      'received', '', 'accepted', case when x.state = '접수반려' then '' else coalesce(x.acc, '') end, 'wait_days', '',
      'draft', '', 'draft_review', '', 'reviewer', '', 'revised', '', 'final', '',
      'reviewed', case when x.state = '접수반려' then '' else coalesce(x.rev, '') end, 'result', '',
      'memo', coalesce(x.memo, ''), 'memo_date', case when coalesce(x.memo, '') <> '' then d else '' end,
      'collected', p_stamp || ' (SIMS 목록 엑셀)') as new
    from x where x.no is not null and not exists (select 1 from c where c.r ->> 'no' = x.no))
  select
    (select jsonb_agg(r order by r ->> 'no' desc) from (select new as r from upd union all select new from ins) t),
    coalesce((select jsonb_agg(jsonb_build_object('no', u.old ->> 'no', 'name', u.old ->> 'name', 'field', k,
                                                  'before', coalesce(u.old ->> k, ''), 'after', coalesce(u.new ->> k, ''))
                               order by u.old ->> 'no' desc, k)
              from upd u, unnest(array['state', 'assignee', 'accepted', 'reviewed', 'memo']) k
              where coalesce(u.old ->> k, '') is distinct from coalesce(u.new ->> k, '')), '[]'::jsonb)
      || coalesce((select jsonb_agg(jsonb_build_object('no', new ->> 'no', 'name', new ->> 'name', 'field', 'new',
                                                       'before', '', 'after', new ->> 'state') order by new ->> 'no' desc) from ins), '[]'::jsonb),
    (select count(*) from ins)
  into rows_new, changes, added;

  if p_apply then
    insert into public.hr_snapshot (id, data, updated_at)
      select 'backup-sims-latest', data, updated_at from public.hr_snapshot where id = 'main'
      on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
    update public.hr_snapshot
      set data = jsonb_set(jsonb_set(jsonb_set(data, '{reviews,rows}', rows_new),
                   '{reviews,collected}', to_jsonb(p_stamp || ' (SIMS 목록 엑셀)')),
                   '{reviews,file}', to_jsonb(coalesce(p_file, ''))),
          updated_at = now()
      where id = 'main';
  end if;
  return jsonb_build_object('applied', p_apply, 'excel', n_x, 'before', n_cur, 'after', jsonb_array_length(rows_new),
                            'added', added, 'changes', changes);
end $$;

revoke execute on function public.hr_sims_import(jsonb, text, text, boolean) from public, anon;
grant execute on function public.hr_sims_import(jsonb, text, text, boolean) to authenticated;
