// 원드라이브 '26년 검토의견서 폴더 클라우드 확인 (PC의 review_watch.py·onedrive_sync.py 대신).
//   GET  /onedrive-sync/login?key=…   Microsoft 로그인(폴더를 볼 수 있는 계정으로 한 번) — key = hr_onedrive.setup_key
//   GET  /onedrive-sync/callback      로그인 결과 받기 → refresh token 저장, 공유 링크 → 폴더 확인, 첫 확인 실행
//   POST /onedrive-sync/sync          pg_cron이 5분마다 호출(x-cron-key = hr_onedrive.cron_key)
// 하는 일: 폴더 전체 목록 → ① 새 파일 담당자 Slack DM ② 협의번호별 단계 첫 업로드일 → 협의검토(hr_onedrive_dates)
//         ③ 복무 엑셀(hr_onedrive.leave_url, leave_enabled) 새 행 → 복무관리 근태(hr_leave), 공휴일 → 스냅샷
//   GET  /onedrive-sync/leave-peek    복무 엑셀 미리보기·할 일(x-cron-key), ?run=1이면 지금 반영
// 비밀값(Edge Function Secrets): MS_CLIENT_ID, MS_CLIENT_SECRET, SLACK_BOT_TOKEN
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const BASE = "https://shlaohieozqanatatlzf.supabase.co/functions/v1/onedrive-sync";
const REDIRECT = BASE + "/callback";
const MS = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPE = "offline_access User.Read Files.Read Files.Read.All";
const GRAPH = "https://graph.microsoft.com/v1.0";

// ---------------------------------------------------------------- 알림 규칙 (tools/review_notify.py와 같음)
const FIELDS = ["소상공인", "창업", "내수", "수출", "경영", "금융", "기술", "인력"];
const STAGES: [string, string][] = [["최종", "최종(팀장)"], ["수정", "수정본"], ["검토", "검토본"], ["초안", "초안"]];
const STAGE_KEY: Record<string, string> = { "초안": "draft", "검토본": "draft_review", "수정본": "revised", "최종(팀장)": "final" };
type Rule = { stages: string[]; fields: string[] | "*"; to: string };
const RULES: Rule[] = [
  { stages: ["검토본", "최종(팀장)"], fields: ["창업", "내수"], to: "장채윤" },
  { stages: ["검토본", "최종(팀장)"], fields: ["수출"], to: "신경희" },
  { stages: ["검토본", "최종(팀장)"], fields: ["경영", "소상공인"], to: "윤의열" },
  { stages: ["검토본", "최종(팀장)"], fields: ["금융", "기술", "인력"], to: "이은실" },
  { stages: ["초안"], fields: ["경영", "창업", "내수", "인력", "수출"], to: "김미정" },
  { stages: ["초안"], fields: ["소상공인", "금융"], to: "박해연" },
  { stages: ["수정본"], fields: "*", to: "김미정" },
];
// 알림을 보내지 않는 폴더(단계 날짜 계산에는 그대로 쓴다): ⑤ 시스템 업로드_최종본
const NO_NOTIFY = (path: string) => /시스템\s*업로드/.test(path.split("/")[0]);
const IGNORE = (n: string) => /^(~\$|\.~|~)/.test(n) || /\.(tmp|partial|crdownload|lock)$/i.test(n) || n === "desktop.ini" || n.startsWith(".");

function classify(dirs: string[]): { stage: string | null; field: string | null } {
  let i = -1, stage: string | null = null;
  outer: for (let k = 0; k < dirs.length; k++) for (const [key, label] of STAGES) if (dirs[k].includes(key)) { i = k; stage = label; break outer; }
  if (!stage) return { stage: null, field: null };
  // 분야는 단계 폴더 바로 아래부터(사업명 하위 폴더에 '기술' 같은 낱말이 있어도 분야 폴더가 우선), 없으면 위쪽
  for (const d of [...dirs.slice(i + 1), ...dirs.slice(0, i).reverse()]) for (const f of FIELDS) if (d.includes(f)) return { stage, field: f };
  return { stage, field: null };
}
function recipients(stage: string | null, field: string | null): string[] {
  if (!stage) return [];
  const out: string[] = [];
  for (const r of RULES) if (r.stages.includes(stage) && (r.fields === "*" || (field && r.fields.includes(field))) && !out.includes(r.to)) out.push(r.to);
  return out;
}
// 협의번호: 파일 이름 → 폴더 이름(안쪽부터)에서 '2026-0302'·'2026_0302'·'2026 302'. 없으면 사업명으로(한 건만 맞을 때)
const norm = (s: string) => s.replace(/[\s·.,()\[\]_\-~'"“”‘’]/g, "");
function caseNo(parts: string[], cases: { no: string; name: string }[]): string | null {
  for (const p of [...parts].reverse()) {
    const m = p.match(/(20\d{2})\s*[-_ ]\s*(\d{3,4})(?!\d)/);
    if (m) return `${m[1]}-${m[2].padStart(4, "0")}`;
  }
  const hay = norm(parts.join("/"));
  const hit = cases.filter(c => norm(c.name).length >= 6 && hay.includes(norm(c.name)));
  return hit.length === 1 ? hit[0].no : null;
}
const kstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);

// ---------------------------------------------------------------- Microsoft
async function token(form: Record<string, string>) {
  const res = await fetch(MS + "/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("MS_CLIENT_ID")!, client_secret: Deno.env.get("MS_CLIENT_SECRET")!, scope: SCOPE, ...form }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Microsoft 토큰 실패: ${j.error_description || j.error || res.status}`);
  return j as { access_token: string; refresh_token?: string };
}
async function graph(at: string, url: string) {
  for (let t = 0; t < 4; t++) {
    const res = await fetch(url.startsWith("http") ? url : GRAPH + url, { headers: { Authorization: "Bearer " + at } });
    if (res.status === 429 || res.status >= 500) { await new Promise(r => setTimeout(r, (+(res.headers.get("Retry-After") || 2)) * 1000)); continue; }
    const j = await res.json();
    if (!res.ok) throw new Error(`Graph ${res.status}: ${j.error?.message || ""} (${url.slice(0, 80)})`);
    return j;
  }
  throw new Error("Graph 요청이 계속 거절됩니다(429/5xx)");
}
const shareId = (url: string) => "u!" + btoa(url).replace(/=+$/, "").replace(/\//g, "_").replace(/\+/g, "-");

type Item = { id: string; path: string; parts: string[]; created: string };
async function listAll(at: string, drive: string, root: string): Promise<Item[]> {
  const out: Item[] = [];
  const queue: { id: string; parts: string[] }[] = [{ id: root, parts: [] }];
  while (queue.length) {
    const { id, parts } = queue.shift()!;
    let url = `/drives/${drive}/items/${id}/children?$top=200&$select=id,name,folder,file,createdDateTime`;
    while (url) {
      const j = await graph(at, url);
      for (const it of j.value) {
        if (IGNORE(it.name)) continue;
        if (it.folder) queue.push({ id: it.id, parts: [...parts, it.name] });
        else if (it.file) out.push({ id: it.id, parts: [...parts, it.name], path: [...parts, it.name].join("/"), created: it.createdDateTime });
      }
      url = j["@odata.nextLink"] || "";
    }
  }
  return out;
}

// ---------------------------------------------------------------- Slack
async function slack(method: string, body: Record<string, unknown> | null, query = "") {
  const tok = Deno.env.get("SLACK_BOT_TOKEN");
  if (!tok) throw new Error("SLACK_BOT_TOKEN이 없습니다");
  const res = await fetch(`https://slack.com/api/${method}${query}`, body
    ? { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body) }
    : { headers: { Authorization: "Bearer " + tok } });
  const j = await res.json();
  if (!j.ok) throw new Error(`Slack ${method}: ${j.error}`);
  return j;
}
// 받는 사람 Slack ID: hr_onedrive.slack_users {"이름":"U…"}에 모두 있으면 그것만 쓴다(users:read 권한 불필요).
// 없는 이름이 있을 때만 users.list로 찾는다.
async function slackIds(fixed: Record<string, string>, names: string[]) {
  const ids: Record<string, string> = {};
  if (names.some(n => !fixed[n])) {
    let cursor = "";
    do {
      const j = await slack("users.list", null, `?limit=200${cursor ? "&cursor=" + cursor : ""}`);
      for (const u of j.members) {
        if (u.deleted || u.is_bot) continue;
        for (const n of [u.profile?.display_name, u.profile?.real_name, u.real_name, u.name]) if (n) ids[n.replace(/\s+/g, "")] ??= u.id;
      }
      cursor = j.response_metadata?.next_cursor || "";
    } while (cursor);
  }
  return (name: string) => fixed[name] || ids[name.replace(/\s+/g, "")];
}

// ---------------------------------------------------------------- 복무(연차입력) 엑셀 읽기
// 원드라이브 공유 링크(hr_onedrive.leave_url)의 엑셀 → [{row, name, start, end, kind, note}]
// 열: A 이름 · B 시작일 · C 종료일 · D 구분 · E 비고 (구분이 빈 행은 공휴일). 시트 '연차입력'(없으면 첫 시트)
const isoOf = (v: unknown): string | null => {
  if (v instanceof Date && !isNaN(+v)) return new Date(+v + 9 * 3600e3).toISOString().slice(0, 10);
  if (typeof v === "number" && v > 30000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5).toISOString().slice(0, 10);
  const m = typeof v === "string" && v.trim().match(/^(\d{4})[-./]\s*(\d{1,2})[-./]\s*(\d{1,2})\.?$/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
};
async function readLeaveExcel(at: string, url: string) {
  const it = await graph(at, `/shares/${shareId(url)}/driveItem`);  // 파일이면 내려받기 주소(@microsoft.graph.downloadUrl)가 같이 온다
  const dl = it["@microsoft.graph.downloadUrl"];
  const res = dl ? await fetch(dl) : await fetch(`${GRAPH}/shares/${shareId(url)}/driveItem/content`, { headers: { Authorization: "Bearer " + at } });
  if (!res.ok) throw new Error(`복무 엑셀 내려받기 실패(${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.SheetNames.includes("연차입력") ? "연차입력" : wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null }) as unknown[][];
  const rows = aoa.slice(1).map((r, i) => {
    const s = isoOf(r[1]), e = isoOf(r[2]) || s;
    return { row: i + 2, name: String(r[0] ?? "").trim(), start: s, end: e, kind: String(r[3] ?? "").trim(), note: String(r[4] ?? "").trim() };
  }).filter(r => r.name && r.start);
  return { file: it.name, etag: it.eTag, modified: it.lastModifiedDateTime, sheet, sheets: wb.SheetNames, head: aoa[0], rows };
}

// 근태 구분 → 범주(server.py classify와 같은 규칙)
function leaveCat(kind: string) {
  const order = ["연차", "오전반차", "오후반차", "공가", "시간단위", "출장", "외부활동", "기타"];
  const cats = kind.split(",").map(x => x.trim()).filter(Boolean).map(p =>
    p.startsWith("연차") ? "연차" : p.includes("오전반차") ? "오전반차" : p.includes("오후반차") ? "오후반차"
    : /^시간/.test(p) ? "시간단위" : /^(공가|병가|경조)/.test(p) ? "공가" : p.includes("출장") ? "출장"
    : /대외활동|외근|교육/.test(p) ? "외부활동" : "기타");
  return order.find(c => cats.includes(c)) || "기타";
}
const kindKey = (k: string) => k.replace(/\s+/g, "");
// 하루·반나절 단위는 범주만 같아도 같은 근태로 본다(예: '연차'와 '연차(9:00~17:00)'). 시간단위·출장·외부활동은 시간까지 같아야 같다.
const DAY_CATS = ["연차", "오전반차", "오후반차", "공가"];
// 복무 엑셀 → hr_leave: 새 행은 근태로 넣고, 엑셀에서 새로 넣었던 행이 엑셀에서 바뀌거나 지워지면 정리한다.
// dry = true면 바꾸지 않고 할 일만 돌려준다.
async function syncLeave(at: string, st: Record<string, any>, dry = false, force = false) {
  const x = await readLeaveExcel(at, st.leave_url);
  if (!dry && !force && x.etag && x.etag === st.leave_etag) return { unchanged: true };
  const { data: members } = await db.from("hr_members").select("name, email").eq("active", true);
  const emailOf = new Map((members || []).map((m: { name: string; email: string }) => [m.name, m.email]));
  const { data: leave } = await db.from("hr_leave").select("id, name, start_date, end_date, kind, updated_at");
  const { data: done } = await db.from("hr_leave_excel").select("key, leave_id, inserted, created_at");
  const doneMap = new Map((done || []).map((d: any) => [d.key, d]));
  const holidays: Record<string, string> = {};
  const add: any[] = [], link: any[] = [], skipped: string[] = [], keys = new Set<string>();
  for (const r of x.rows) {
    if (!r.kind) {  // 공휴일
      for (let d = r.start!; d <= r.end!; d = new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10)) holidays[d] = r.name;
      continue;
    }
    const key = `${r.name}|${r.start}|${r.end}|${kindKey(r.kind)}`;
    keys.add(key);
    if (doneMap.has(key)) continue;
    if (!emailOf.has(r.name)) { skipped.push(`${r.row}행 ${r.name}(팀원 아님)`); continue; }
    const same = (leave || []).find((l: any) => l.name === r.name && l.start_date === r.start && l.end_date === r.end
      && (kindKey(l.kind) === kindKey(r.kind) || (DAY_CATS.includes(leaveCat(r.kind)) && leaveCat(l.kind) === leaveCat(r.kind))));
    if (same) link.push({ key, leave_id: same.id, inserted: false, row_no: r.row });
    else add.push({ key, row: r });
  }
  // 엑셀에서 새로 넣었던 근태 중 엑셀에서 사라진 행(구분·날짜를 고친 경우 포함): 웹에서 고치지 않았으면 지운다
  const goneRows = (done || []).filter((d: any) => d.inserted && !keys.has(d.key));
  const tooFew = x.rows.length < (st.leave_result?.rows || 0) * 0.7;  // 엑셀을 반쯤 읽은 것 같으면 지우지 않음
  const remove = tooFew ? [] : goneRows.filter((d: any) => {
    const l = (leave || []).find((v: any) => v.id === d.leave_id);
    return !l || Date.parse(l.updated_at) <= Date.parse(d.created_at) + 60e3;
  });
  const plan = { file: x.file, rows: x.rows.length, holidays: Object.keys(holidays).length,
    add: add.map(a => `${a.row.row}행 ${a.row.name} ${a.row.start}~${a.row.end} ${a.row.kind}`),
    link: link.length, remove: remove.map((d: any) => d.key), skipped };
  if (dry) return { dry: true, ...plan };

  for (const a of add) {
    const r = a.row;
    const { data: ins, error } = await db.from("hr_leave").insert({ name: r.name, start_date: r.start, end_date: r.end, kind: r.kind,
      note: r.note, created_by: emailOf.get(r.name) }).select("id").single();
    if (error) throw new Error("근태 추가 실패: " + error.message);
    link.push({ key: a.key, leave_id: ins.id, inserted: true, row_no: r.row });
  }
  if (link.length) {
    const { error } = await db.from("hr_leave_excel").upsert(link, { onConflict: "key" });
    if (error) throw new Error("엑셀 반영 기록 실패: " + error.message);
  }
  for (const d of remove) {
    if (d.leave_id) await db.from("hr_leave").delete().eq("id", d.leave_id);
    await db.from("hr_leave_excel").delete().eq("key", d.key);
  }
  if (Object.keys(holidays).length) await db.rpc("hr_set_holidays", { p_holidays: holidays });
  const res = { ...plan, at: new Date().toISOString() };
  await db.from("hr_onedrive").update({ leave_etag: x.etag, leave_result: res }).eq("id", 1);
  return res;
}

// ---------------------------------------------------------------- 확인 1회
async function sync() {
  const { data: st } = await db.from("hr_onedrive").select("*").eq("id", 1).single();
  if (!st?.refresh_token || !st.drive_id) return { skipped: "아직 Microsoft 계정이 연결되지 않았습니다" };
  const tk = await token({ grant_type: "refresh_token", refresh_token: st.refresh_token });
  if (tk.refresh_token && tk.refresh_token !== st.refresh_token) await db.from("hr_onedrive").update({ refresh_token: tk.refresh_token }).eq("id", 1);

  const files = await listAll(tk.access_token, st.drive_id, st.root_id);
  const { data: snap } = await db.from("hr_snapshot").select("data").eq("id", "main").single();
  const cases = ((snap?.data?.reviews?.rows || []) as { no: string; name: string }[]).map(r => ({ no: r.no, name: r.name || "" }));
  const { data: known } = await db.from("hr_onedrive_files").select("id, first_seen, notified");
  const prev = new Map((known || []).map((r: { id: string; first_seen: string; notified: string | null }) => [r.id, r]));
  const seen = new Set(prev.keys());

  const rows = files.map(f => {
    const c = classify(f.parts.slice(0, -1));
    return { id: f.id, path: f.path, stage: c.stage, field: c.field, case_no: caseNo(f.parts, cases), created: f.created };
  });
  const fresh = rows.filter(r => !seen.has(r.id));

  // ① 새 파일 알림(첫 확인 때 이미 있던 파일은 알리지 않음)
  const notified: Record<string, string[]> = {};
  const errors: string[] = [];
  if (st.baseline_done && fresh.length) {
    const plan: Record<string, typeof fresh> = {};
    for (const r of fresh) if (!NO_NOTIFY(r.path)) for (const who of recipients(r.stage, r.field)) (plan[who] ||= []).push(r);
    if (Object.keys(plan).length) {
      try {
        const idOf = await slackIds(st.slack_users || {}, Object.keys(plan));
        for (const [who, items] of Object.entries(plan)) {
          const uid = idOf(who);
          if (!uid) { errors.push(`Slack에서 '${who}'을(를) 찾지 못함`); continue; }
          const lines = [`📄 *검토의견서 새 파일 ${items.length}건*`,
            ...items.map(r => `• [${r.stage}${r.field ? " · " + r.field : ""}] ${r.path.split("/").pop()}`)];
          if (st.share_url) lines.push(`<${st.share_url}|'26년 검토의견서 폴더 열기>`);
          try {
            await slack("chat.postMessage", { channel: uid, text: lines.join("\n") });
            for (const r of items) (notified[r.id] ||= []).push(who);
          } catch (e) { errors.push(`${who}: ${(e as Error).message}`); }
        }
      } catch (e) { errors.push((e as Error).message); }
    }
  }

  // 파일 목록 저장(새 파일·이동·이름 변경 반영, 사라진 파일 삭제)
  const now = new Date().toISOString();
  const save = rows.map(r => ({ ...r, first_seen: prev.get(r.id)?.first_seen || now,
    notified: notified[r.id]?.join(", ") || prev.get(r.id)?.notified || null }));
  for (let i = 0; i < save.length; i += 500) {
    const { error } = await db.from("hr_onedrive_files").upsert(save.slice(i, i + 500), { onConflict: "id" });
    if (error) throw new Error("파일 목록 저장 실패: " + error.message);
  }
  const live = new Set(rows.map(r => r.id));
  const gone = [...seen].filter(id => !live.has(id));
  for (let i = 0; i < gone.length; i += 200) await db.from("hr_onedrive_files").delete().in("id", gone.slice(i, i + 200));

  // ② 협의번호별 단계 첫 업로드일
  const dates: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    const k = r.stage && STAGE_KEY[r.stage];
    if (!k || !r.case_no || !r.created) continue;
    const d = kstDate(r.created);
    const cur = (dates[r.case_no] ||= {});
    if (!cur[k] || d < cur[k]) cur[k] = d;
  }
  const { data: changed, error: de } = await db.rpc("hr_onedrive_dates", { p_dates: dates });
  if (de) errors.push("날짜 반영 실패: " + de.message);

  // ③ 복무 엑셀 → 복무관리(근태)
  let leaveRes: unknown = null;
  if (st.leave_enabled && st.leave_url) {
    try { leaveRes = await syncLeave(tk.access_token, st); } catch (e) { errors.push("복무 엑셀: " + (e as Error).message); }
  }

  const result = {
    files: rows.length, new: fresh.length, notified: Object.values(notified).length,
    matched: rows.filter(r => r.case_no).length, unmatched_stage_files: rows.filter(r => r.stage && !r.case_no).length,
    cases_dated: changed ?? 0, baseline: !st.baseline_done, leave: leaveRes, errors,
  };
  await db.from("hr_onedrive").update({ baseline_done: true, last_run: new Date().toISOString(), last_error: errors.join(" / ") || null, last_result: result }).eq("id", 1);
  return result;
}

// ---------------------------------------------------------------- 진입
// Supabase 함수는 HTML 화면을 보낼 수 없다(일반 글자로 바뀌어 한글이 깨짐). 결과는 HR앱의 안내 페이지로 넘겨 보여 준다.
const PAGE = "https://kosievalteam.github.io/eval-team-hr/onedrive.html";  // evalteamhr.vercel.app은 2026-11-07 기준 연결 끊김
const page = (ok: boolean, title: string, msg: string) =>
  Response.redirect(`${PAGE}?${new URLSearchParams({ ok: ok ? "1" : "0", t: title, m: msg })}`, 302);

Deno.serve(async req => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  try {
    if (path.endsWith("/sync")) {
      const { data: st } = await db.from("hr_onedrive").select("cron_key").eq("id", 1).single();
      if (!st || req.headers.get("x-cron-key") !== st.cron_key) return new Response("forbidden", { status: 403 });
      try {
        return Response.json(await sync());
      } catch (e) {
        const msg = (e as Error).message;
        await db.from("hr_onedrive").update({ last_run: new Date().toISOString(), last_error: msg }).eq("id", 1);
        return Response.json({ error: msg }, { status: 500 });
      }
    }
    if (path.endsWith("/leave-peek")) {  // 복무 엑셀 읽기만(관리용): x-cron-key 필요
      const { data: st } = await db.from("hr_onedrive").select("*").eq("id", 1).single();
      if (!st || req.headers.get("x-cron-key") !== st.cron_key) return new Response("forbidden", { status: 403 });
      const tk = await token({ grant_type: "refresh_token", refresh_token: st.refresh_token });
      if (tk.refresh_token && tk.refresh_token !== st.refresh_token) await db.from("hr_onedrive").update({ refresh_token: tk.refresh_token }).eq("id", 1);
      if (url.searchParams.get("run")) return Response.json(await syncLeave(tk.access_token, st, false, true));  // 지금 반영
      const x = await readLeaveExcel(tk.access_token, st.leave_url);
      return Response.json({ head: x.head, sheet: x.sheet, sheets: x.sheets, file: x.file, total: x.rows.length,
        last: x.rows.slice(-25), plan: await syncLeave(tk.access_token, st, true) });
    }
    if (path.endsWith("/login")) {
      const { data: st } = await db.from("hr_onedrive").select("setup_key").eq("id", 1).single();
      if (!st || url.searchParams.get("key") !== st.setup_key) return page(false, "링크가 올바르지 않습니다", "관리자에게 받은 연결 링크를 그대로 여세요.");
      if (!Deno.env.get("MS_CLIENT_ID") || !Deno.env.get("MS_CLIENT_SECRET"))
        return page(false, "준비가 덜 되었습니다", "Supabase 대시보드 › Edge Functions › Secrets에 MS_CLIENT_ID와 MS_CLIENT_SECRET을 먼저 넣은 뒤 연결 링크를 다시 여세요.");
      const state = crypto.randomUUID();
      await db.from("hr_onedrive").update({ login_state: state }).eq("id", 1);
      const q = new URLSearchParams({ client_id: Deno.env.get("MS_CLIENT_ID")!, response_type: "code", redirect_uri: REDIRECT,
        response_mode: "query", scope: SCOPE, state, prompt: "select_account" });
      return Response.redirect(`${MS}/authorize?${q}`, 302);
    }
    if (path.endsWith("/callback")) {
      const { data: st } = await db.from("hr_onedrive").select("login_state, share_url").eq("id", 1).single();
      if (url.searchParams.get("error")) return page(false, "로그인하지 못했습니다", url.searchParams.get("error_description") || url.searchParams.get("error") || "");
      if (!st?.login_state || url.searchParams.get("state") !== st.login_state) return page(false, "다시 시도하세요", "로그인 요청이 만료되었습니다. 연결 링크를 처음부터 다시 여세요.");
      const tk = await token({ grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: REDIRECT });
      const me = await graph(tk.access_token, "/me?$select=userPrincipalName,displayName");
      const root = await graph(tk.access_token, `/shares/${shareId(st.share_url)}/driveItem?$select=id,name,parentReference`);
      await db.from("hr_onedrive").update({
        login_state: null, refresh_token: tk.refresh_token, account: me.userPrincipalName || me.displayName,
        drive_id: root.parentReference.driveId, root_id: root.id, root_name: root.name, baseline_done: false, last_error: null,
      }).eq("id", 1);
      await db.from("hr_onedrive_files").delete().neq("id", "");
      const r = await sync();  // 첫 확인: 지금 있는 파일은 알리지 않고 날짜만 채운다
      return page(true, "원드라이브 연결 완료", `'${root.name}' 폴더를 ${me.userPrincipalName || me.displayName || ""} 계정으로 연결했습니다.
파일 ${r.files ?? 0}개 확인 · 협의번호를 찾은 파일 ${r.matched ?? 0}개 · 날짜를 채운 협의건 ${r.cases_dated ?? 0}건
이제 5분마다 폴더를 확인해 새 파일을 담당자에게 Slack으로 알립니다. 이 창은 닫아도 됩니다.`);
    }
    return new Response("not found", { status: 404 });
  } catch (e) {
    if (path.endsWith("/leave-peek")) return Response.json({ error: (e as Error).message, stack: (e as Error).stack?.slice(0, 600) }, { status: 500 });
    return page(false, "오류가 났습니다", (e as Error).message);
  }
});
