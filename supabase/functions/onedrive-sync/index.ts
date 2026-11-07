// 원드라이브 '26년 검토의견서 폴더 클라우드 확인 (PC의 review_watch.py·onedrive_sync.py 대신).
//   GET  /onedrive-sync/login?key=…   Microsoft 로그인(폴더를 볼 수 있는 계정으로 한 번) — key = hr_onedrive.setup_key
//   GET  /onedrive-sync/callback      로그인 결과 받기 → refresh token 저장, 공유 링크 → 폴더 확인, 첫 확인 실행
//   POST /onedrive-sync/sync          pg_cron이 5분마다 호출(x-cron-key = hr_onedrive.cron_key)
// 하는 일: 폴더 전체 목록 → ① 새 파일 담당자 Slack DM ② 협의번호별 단계 첫 업로드일 → 협의검토(hr_onedrive_dates)
// 비밀값(Edge Function Secrets): MS_CLIENT_ID, MS_CLIENT_SECRET, SLACK_BOT_TOKEN
import { createClient } from "jsr:@supabase/supabase-js@2";

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
  { stages: ["초안", "검토본", "최종(팀장)"], fields: ["창업", "내수"], to: "장채윤" },
  { stages: ["초안", "검토본", "최종(팀장)"], fields: ["수출"], to: "신경희" },
  { stages: ["초안", "검토본", "최종(팀장)"], fields: ["경영", "소상공인"], to: "윤의열" },
  { stages: ["초안", "검토본", "최종(팀장)"], fields: ["금융", "기술", "인력"], to: "이은실" },
  { stages: ["초안"], fields: ["경영", "창업", "내수", "인력", "수출"], to: "김미정" },
  { stages: ["수정본"], fields: "*", to: "김미정" },
];
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
async function slackIds(fixed: Record<string, string>) {
  const ids: Record<string, string> = {};
  let cursor = "";
  do {
    const j = await slack("users.list", null, `?limit=200${cursor ? "&cursor=" + cursor : ""}`);
    for (const u of j.members) {
      if (u.deleted || u.is_bot) continue;
      for (const n of [u.profile?.display_name, u.profile?.real_name, u.real_name, u.name]) if (n) ids[n.replace(/\s+/g, "")] ??= u.id;
    }
    cursor = j.response_metadata?.next_cursor || "";
  } while (cursor);
  return (name: string) => fixed[name] || ids[name.replace(/\s+/g, "")];
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
    for (const r of fresh) for (const who of recipients(r.stage, r.field)) (plan[who] ||= []).push(r);
    if (Object.keys(plan).length) {
      try {
        const idOf = await slackIds(st.slack_users || {});
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

  const result = {
    files: rows.length, new: fresh.length, notified: Object.values(notified).length,
    matched: rows.filter(r => r.case_no).length, unmatched_stage_files: rows.filter(r => r.stage && !r.case_no).length,
    cases_dated: changed ?? 0, baseline: !st.baseline_done, errors,
  };
  await db.from("hr_onedrive").update({ baseline_done: true, last_run: new Date().toISOString(), last_error: errors.join(" / ") || null, last_result: result }).eq("id", 1);
  return result;
}

// ---------------------------------------------------------------- 진입
const html = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
   <body style="font-family:system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 16px;line-height:1.6"><h2>${title}</h2>${body}</body>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

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
    if (path.endsWith("/login")) {
      const { data: st } = await db.from("hr_onedrive").select("setup_key").eq("id", 1).single();
      if (!st || url.searchParams.get("key") !== st.setup_key) return html("링크가 올바르지 않습니다", "<p>관리자에게 받은 연결 링크를 그대로 여세요.</p>", 403);
      if (!Deno.env.get("MS_CLIENT_ID") || !Deno.env.get("MS_CLIENT_SECRET"))
        return html("준비가 덜 되었습니다", "<p>Supabase Edge Function 비밀값 MS_CLIENT_ID·MS_CLIENT_SECRET을 먼저 넣으세요.</p>", 500);
      const state = crypto.randomUUID();
      await db.from("hr_onedrive").update({ login_state: state }).eq("id", 1);
      const q = new URLSearchParams({ client_id: Deno.env.get("MS_CLIENT_ID")!, response_type: "code", redirect_uri: REDIRECT,
        response_mode: "query", scope: SCOPE, state, prompt: "select_account" });
      return Response.redirect(`${MS}/authorize?${q}`, 302);
    }
    if (path.endsWith("/callback")) {
      const { data: st } = await db.from("hr_onedrive").select("login_state, share_url").eq("id", 1).single();
      if (url.searchParams.get("error")) return html("로그인이 취소되었습니다", `<p>${esc(url.searchParams.get("error_description") || "")}</p>`, 400);
      if (!st?.login_state || url.searchParams.get("state") !== st.login_state) return html("다시 시도하세요", "<p>로그인 요청이 만료되었습니다. 연결 링크를 처음부터 다시 여세요.</p>", 400);
      const tk = await token({ grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: REDIRECT });
      const me = await graph(tk.access_token, "/me?$select=userPrincipalName,displayName");
      const root = await graph(tk.access_token, `/shares/${shareId(st.share_url)}/driveItem?$select=id,name,parentReference`);
      await db.from("hr_onedrive").update({
        login_state: null, refresh_token: tk.refresh_token, account: me.userPrincipalName || me.displayName,
        drive_id: root.parentReference.driveId, root_id: root.id, root_name: root.name, baseline_done: false, last_error: null,
      }).eq("id", 1);
      await db.from("hr_onedrive_files").delete().neq("id", "");
      const r = await sync();  // 첫 확인: 지금 있는 파일은 알리지 않고 날짜만 채운다
      return html("원드라이브 연결 완료", `<p><b>${esc(root.name)}</b> 폴더를 ${esc(me.userPrincipalName || me.displayName || "")} 계정으로 연결했습니다.</p>
        <p>파일 ${r.files ?? 0}개 확인 · 협의번호를 찾은 파일 ${r.matched ?? 0}개 · 날짜를 채운 협의건 ${r.cases_dated ?? 0}건</p>
        <p>이제 5분마다 폴더를 확인해 새 파일을 담당자에게 Slack으로 알립니다. 이 창은 닫아도 됩니다.</p>`);
    }
    return new Response("not found", { status: 404 });
  } catch (e) {
    return html("오류", `<p>${esc((e as Error).message)}</p>`, 500);
  }
});
