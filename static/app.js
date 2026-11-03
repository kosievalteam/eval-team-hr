"use strict";

const state = {
  data: null,
  page: "dashboard",
  dashDate: null,
  leaveTab: "list",
  leaveFilter: { name: "", category: "", month: "", period: "all" },
  calMonth: null,
  taskTab: "week",
  weekIdx: 0,
  taskArea: "",
  taskQuery: "",
  pWeek: 0,
  pOwner: "",
  pStatus: "",
  user: null,
  rvTab: "list",
  rvFilter: { kind: "", field: "", who: "", stage: "_open", q: "", sort: ["age", -1] },
};

const PAGES = { dashboard: "대시보드", notices: "공지사항", tasks: "주간업무관리", reviews: "협의검토관리", pclog: "공용 PC 사용대장", leave: "복무관리" };
const REVIEW_DASHBOARD = "https://kosievalteam.github.io/newbiz_dashboard/";
const LEAVE_CATS = ["연차", "오전반차", "오후반차", "공가"];
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const $ = (s, el = document) => el.querySelector(s);

/* ------------------------------------------------------------ utils */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function iso(d) {
  const z = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function parseIso(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseIso(s); d.setDate(d.getDate() + n); return iso(d); }
function fmtDate(s, withDow = true) {
  const d = parseIso(s);
  return `${d.getMonth() + 1}/${d.getDate()}` + (withDow ? `(${DOW[d.getDay()]})` : "");
}
function fmtLong(s) {
  const d = parseIso(s);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${DOW[d.getDay()]}요일`;
}
function fmtPeriod(e) { return e.start === e.end ? fmtDate(e.start) : `${fmtDate(e.start)} ~ ${fmtDate(e.end)}`; }
function fmtDays(n) {
  if (!n) return "0일";
  const hpd = state.data.hours_per_day || 8;
  const whole = Math.floor(n + 1e-9);
  const hours = Math.round((n - whole) * hpd * 10) / 10;
  if (!hours) return `${whole}일`;
  return whole ? `${whole}일 ${hours}시간` : `${hours}시간`;
}
function isOffDay(s) {
  const d = parseIso(s).getDay();
  return d === 0 || d === 6 || !!state.data.holidays[s];
}
function entryStatus(e) {
  const t = state.data.today;
  if (e.start > t) return "예정";
  if (e.end < t) return "완료";
  return "진행중";
}
function shortLabel(e) {
  if (e.category === "시간단위" || e.category === "기타") {
    return e.label.replace(/시간단위휴가/g, "시간").replace(/대외활동/g, "외부");
  }
  return e.category;
}
function pill(cls, text) { return `<span class="pill ${cls}">${esc(text)}</span>`; }

/* ------------------------------------------------------------ data */
// 엑셀 데이터: 로컬은 /api/data(엑셀 직접), 웹(GitHub Pages)은 배포 때 올린 Supabase 스냅샷.
// 공지·웹 입력(휴가·주간업무·개인업무·협의검토)은 두 경우 모두 Supabase에서 읽고 쓴다.
const STATIC = !!window.HR_STATIC;
const SUPABASE_URL = "https://ryrhtvaeutqejdekpari.supabase.co";
const SUPABASE_KEY = "sb_publishable_DBRKg4svB4CBjiMptQTD2Q_ywYTTYIL";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function must(q) {
  const { data, error } = await q;
  if (error) throw new Error(error.code === "42501" ? "권한이 없습니다. 본인이 작성한 항목만 수정할 수 있습니다." : error.message);
  return data;
}
function canEdit(row) { return !!state.user && (state.user.admin || (row.created_by || "").toLowerCase() === state.user.email); }

/* 로그인 */
function loginGate(message) {
  return new Promise(resolve => {
    let gate = $("#pwGate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "pwGate";
      document.body.appendChild(gate);
    }
    let mode = "login";
    const draw = msg => {
      gate.innerHTML = `<form class="gate-box">
        <div class="brand-logo"><img src="kosi_logo.png" alt="KOSI" onerror="this.replaceWith('KOSI')"></div>
        <h2>정책평가팀 HR 관리</h2>
        ${mode === "signup" ? `<p class="muted small">처음 쓰는 경우 @kosi.re.kr 이메일로 가입하세요.</p>` : ""}
        <input type="email" name="email" placeholder="이메일 (@kosi.re.kr)" autocomplete="username" required>
        <input type="password" name="pw" placeholder="비밀번호${mode === "signup" ? " (6자 이상)" : ""}" autocomplete="${mode === "login" ? "current-password" : "new-password"}" minlength="6" required>
        <div class="gate-msg">${esc(msg || "")}</div>
        <button class="btn-pri">${mode === "login" ? "로그인" : "가입하기"}</button>
        <button type="button" class="link-btn" data-mode>${mode === "login" ? "계정이 없나요? 가입하기" : "로그인으로 돌아가기"}</button></form>`;
      gate.hidden = false;
      const f = $("form", gate);
      f.email.focus();
      $("[data-mode]", gate).onclick = () => { mode = mode === "login" ? "signup" : "login"; draw(""); };
      f.onsubmit = async ev => {
        ev.preventDefault();
        const btn = $(".btn-pri", f);
        btn.disabled = true;
        const email = f.email.value.trim().toLowerCase(), password = f.pw.value;
        try {
          if (mode === "signup") {
            const { data, error } = await sb.auth.signUp({ email, password });
            if (error) throw error;
            if (!data.session) { mode = "login"; draw("가입 확인 메일을 보냈습니다. 메일의 링크를 누른 뒤 로그인하세요."); return; }
          } else {
            const { error } = await sb.auth.signInWithPassword({ email, password });
            if (error) throw error;
          }
          gate.hidden = true;
          resolve();
        } catch (err) {
          const m = String(err.message || err);
          $(".gate-msg", gate).textContent =
            /invalid login/i.test(m) ? "이메일 또는 비밀번호가 올바르지 않습니다." :
            /kosi\.re\.kr/.test(m) || /database error/i.test(m) ? "@kosi.re.kr 이메일만 가입할 수 있습니다." :
            /already registered/i.test(m) ? "이미 가입된 이메일입니다. 로그인하세요." :
            /email not confirmed/i.test(m) ? "가입 확인 메일의 링크를 먼저 눌러 주세요." : m;
          btn.disabled = false;
        }
      };
    };
    draw(message);
  });
}

async function ensureUser() {
  for (let msg = ""; ;) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { await loginGate(msg); continue; }
    const email = session.user.email.toLowerCase();
    const rows = await must(sb.from("hr_members").select("name,is_admin").eq("email", email).eq("active", true));
    if (rows.length) return { email, name: rows[0].name, admin: rows[0].is_admin };
    await sb.auth.signOut();
    msg = `${email} 계정은 팀원 명단에 없습니다. 관리자에게 등록을 요청하세요.`;
  }
}

/* 휴가 구분 해석 (server.py classify와 같은 규칙) */
const TIME_RE = /(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/;
function classify(raw, hpd) {
  let deduct = 0, trip = false;
  const cats = [];
  String(raw).split(",").map(s => s.trim()).filter(Boolean).forEach(part => {
    const tm = part.match(TIME_RE);
    if (part.startsWith("연차")) { cats.push("연차"); deduct += 1; }
    else if (part.includes("오전반차")) { cats.push("오전반차"); deduct += 0.5; }
    else if (part.includes("오후반차")) { cats.push("오후반차"); deduct += 0.5; }
    else if (part.startsWith("시간")) {
      cats.push("시간단위");
      if (tm) deduct += Math.max(0, (+tm[3] * 60 + +tm[4] - +tm[1] * 60 - +tm[2]) / 60) / hpd;
    }
    else if (/^(공가|병가|경조)/.test(part)) cats.push("공가");
    else if (/출장|대외활동|외근|교육/.test(part)) { cats.push("출장"); trip = true; }
    else cats.push("기타");
  });
  const category = ["연차", "오전반차", "오후반차", "공가", "시간단위", "출장", "기타"].find(c => cats.includes(c)) || "기타";
  return { category, perDay: Math.round(deduct * 10000) / 10000, trip, label: String(raw).trim() };
}
function businessDays(start, end, holidays) {
  const out = [];
  for (let x = start; x <= end; x = addDays(x, 1)) {
    const dow = parseIso(x).getDay();
    if (dow !== 0 && dow !== 6 && !holidays[x]) out.push(x);
  }
  return out;
}

// 웹 입력 항목의 id는 엑셀 행번호와 겹치지 않게 1,000,000을 더한다(정렬용).
const WEB_ID = 1e6;

async function fetchBase() {
  if (!STATIC) return await (await fetch("/api/data", { cache: "no-store" })).json();
  const rows = await must(sb.from("hr_snapshot").select("data,updated_at").eq("id", "main"));
  if (!rows.length) throw new Error("아직 배포된 엑셀 데이터가 없습니다. 관리자 PC에서 '배포.bat'을 실행하세요.");
  return Object.assign(rows[0].data, { errors: [] });
}

async function fetchWeb() {
  const [notices, slack, pclog, leave, weeks, weekly, tasks, review] = await Promise.all([
    must(sb.from("hr_notices").select("*")),
    must(sb.from("hr_slack_notices").select("*")),
    must(sb.from("hr_pc_log").select("*")),
    must(sb.from("hr_leave").select("*")),
    must(sb.from("hr_weeks").select("*").order("sort", { ascending: false })),
    must(sb.from("hr_weekly").select("*").order("id")),
    must(sb.from("hr_tasks").select("*").order("id")),
    must(sb.from("hr_review").select("*")),
  ]);
  return { notices, slack, pclog, leave, weeks, weekly, tasks, review };
}

function merge(d, web) {
  const hpd = d.hours_per_day || 8;
  const names = new Set(d.members.map(m => m.name));
  // Slack 전체공지 채널 메시지(배포 때 동기화)는 읽기 전용으로 함께 보여준다. 첫 줄 = 제목.
  d.notices = [...web.notices, ...web.slack.map(s => {
    const [title, ...rest] = s.text.split("\n");
    return { id: "slack-" + s.ts, slack: true, ts: s.ts, title: title.replace(/^\*(.*)\*$/, "$1"), body: rest.join("\n").trim(),
      author: s.author, date: s.date, important: false, permalink: s.permalink, edited: s.edited, reply_count: s.reply_count };
  })];
  d.pclog = web.pclog;

  web.leave.filter(r => names.has(r.name)).forEach(r => {
    const c = classify(r.kind, hpd);
    const dates = businessDays(r.start_date, r.end_date, d.holidays);
    d.entries.push({
      id: WEB_ID + r.id, wid: r.id, web: true, created_by: r.created_by, kind: r.kind,
      name: r.name, start: r.start_date, end: r.end_date, category: c.category, label: c.label, trip: c.trip,
      note: r.note, workdays: dates.length, deduct: Math.round(c.perDay * dates.length * 10000) / 10000, dates,
    });
  });

  // 주간업무는 모두 웹(Supabase)에서 작성한다. hr_weeks.id = 주차 키(엑셀에서 가져온 주차는 시트명).
  const week = r => ({ sheet: r.id, title: r.title, status: r.status, progress_label: r.progress_label,
    plan_label: r.plan_label, start: r.start_date || "", end: r.end_date || "", created_by: r.created_by });
  d.weeks = web.weeks.filter(r => r.kind === "plan").map(r => ({ ...week(r), items: [] }));
  d.personal = web.weeks.filter(r => r.kind === "report").map(r => ({ ...week(r), tasks: [] }));

  const weekBySheet = Object.fromEntries(d.weeks.map(w => [w.sheet, w]));
  web.weekly.forEach(r => {
    const w = weekBySheet[r.sheet];
    if (w) w.items.push({ area: r.area, progress: r.progress, plan: r.plan, key: r.key, author: r.author,
      written: r.written || r.updated_at.slice(5, 10).replace("-", "/"), reviewed: r.reviewed, stats: r.stats || null,
      wid: r.id, created_by: r.created_by });
  });

  const pBySheet = Object.fromEntries(d.personal.map(w => [w.sheet, w]));
  web.tasks.filter(r => names.has(r.owner)).forEach(r => {
    const w = pBySheet[r.sheet];
    if (w) w.tasks.push({ owner: r.owner, name: r.name, content: r.content, priority: r.priority, status: r.status,
      start: r.start_date || "", due: r.due || "", done: r.done || "", result: r.result, memo: r.memo,
      wid: r.id, created_by: r.created_by });
  });

  const ov = Object.fromEntries(web.review.map(r => [r.no, r]));
  d.reviews = d.reviews || { file: "", rows: [] };
  d.reviews.rows.forEach(row => {
    row.xl = Object.fromEntries(REVIEW_EDIT.map(k => [k, row[k]]));
    row.ov = {};
    const o = ov[row.no];
    if (!o) return;
    REVIEW_EDIT.forEach(k => { if (o[k] != null) { row[k] = o[k]; row.ov[k] = true; } });
    row.ovBy = o.updated_by; row.ovAt = o.updated_at;
  });
  return d;
}

// '오늘'과 사용/예정 연차를 보는 사람 기준으로 다시 계산한다(웹 입력 휴가 포함).
function rebaseToday(d) {
  d.today = iso(new Date());
  d.members.forEach(m => {
    let used = 0, planned = 0;
    d.entries.filter(e => e.name === m.name && e.deduct && e.dates.length).forEach(e => {
      const per = e.deduct / e.dates.length;
      e.dates.forEach(x => (x <= d.today ? (used += per) : (planned += per)));
    });
    m.used = Math.round((used + (m.prior_used || 0)) * 100) / 100;
    m.planned = Math.round(planned * 100) / 100;
    m.remaining = typeof m.total === "number" ? Math.round((m.total - m.used - m.planned) * 100) / 100 : null;
  });
  return d;
}

async function load(manual) {
  const btn = $("#btnReload");
  btn.disabled = true; btn.textContent = "읽는 중…";
  try {
    if (!state.user) {
      state.user = await ensureUser();
      renderUser();
    }
    const [base, web] = await Promise.all([fetchBase(), fetchWeb()]);
    state.data = rebaseToday(merge(base, web));
    if (!state.dashDate || !manual && state.dashDate === state.prevToday) state.dashDate = state.data.today;
    state.prevToday = state.data.today;
    if (!state.calMonth) state.calMonth = state.data.today.slice(0, 7);
    render();
  } catch (err) {
    showErrors([STATIC ? `데이터를 불러오지 못했습니다. (${err.message || err})`
      : `서버 또는 Supabase에 연결할 수 없습니다. 'HR앱 실행.bat'으로 서버를 실행했는지 확인하세요. (${err.message || err})`]);
  } finally {
    btn.disabled = false; btn.textContent = STATIC ? "⟳ 새로고침" : "⟳ 엑셀 새로고침";
  }
}
function showErrors(list) {
  const box = $("#errorBox");
  box.hidden = !list.length;
  box.textContent = list.join("\n");
}

function renderUser() {
  const u = state.user;
  $("#userBox").innerHTML = `<div class="who"><b>${esc(u.name)}</b>${u.admin ? ` <span class="small">관리자</span>` : ""}</div>
    <button class="link-btn" data-act="pw">비밀번호 변경</button> · <button class="link-btn" data-act="out">로그아웃</button>`;
  $("#userBox [data-act=out]").onclick = async () => { await sb.auth.signOut(); location.reload(); };
  $("#userBox [data-act=pw]").onclick = () => openForm({
    title: "비밀번호 변경",
    fields: [{ name: "pw", label: "새 비밀번호 (6자 이상)", type: "password", required: true }],
    onSave: async v => {
      if (v.pw.length < 6) throw new Error("6자 이상 입력하세요.");
      const { error } = await sb.auth.updateUser({ password: v.pw });
      if (error) throw error;
      alert("비밀번호를 변경했습니다. 사업정보 검색 시스템도 같은 비밀번호로 로그인합니다.");
    },
    noReload: true,
  });
}

/* ------------------------------------------------------------ 입력 대화상자 */
// fields: {name,label,type,options,required,rows,placeholder,list,help} — 배열로 묶으면 한 줄에 둘씩 놓는다.
function openForm({ title, fields, data = {}, onSave, onDelete, deleteLabel = "삭제", noReload }) {
  const dlg = $("#formDialog");
  const one = f => {
    const v = data[f.name] ?? f.value ?? "";
    const req = f.required ? "required" : "";
    let input;
    if (f.type === "note") return `<p class="small muted">${esc(f.help)}</p>`;
    if (f.type === "textarea") input = `<textarea name="${f.name}" rows="${f.rows || 4}" ${req} placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`;
    else if (f.type === "select") input = `<select name="${f.name}" ${req}>${f.options.map(o => {
      const [val, lbl] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lbl)}</option>`;
    }).join("")}</select>`;
    else if (f.type === "checkbox") return `<label class="chk"><input type="checkbox" name="${f.name}" ${v ? "checked" : ""}> ${esc(f.label)}</label>`;
    else input = `<input name="${f.name}" type="${f.type || "text"}" value="${esc(v)}" ${req} placeholder="${esc(f.placeholder || "")}" ${f.list ? `list="dl-${f.name}"` : ""}>`
      + (f.list ? `<datalist id="dl-${f.name}">${f.list.map(o => `<option value="${esc(o)}">`).join("")}</datalist>` : "");
    return `<label>${esc(f.label)}${input}${f.help ? `<span class="small">${esc(f.help)}</span>` : ""}</label>`;
  };
  dlg.innerHTML = `<form method="dialog" class="dlg">
    <h3>${esc(title)}</h3>
    ${fields.map(f => Array.isArray(f) ? `<div class="row2">${f.map(one).join("")}</div>` : one(f)).join("")}
    <div class="form-msg"></div>
    <div class="dlg-actions">
      ${onDelete ? `<button type="button" class="btn-sec danger" data-del style="margin-right:auto">${esc(deleteLabel)}</button>` : ""}
      <button value="cancel" class="btn-sec" formnovalidate>취소</button>
      <button value="save" class="btn-pri">저장</button>
    </div></form>`;
  const form = $("form", dlg);
  const run = async fn => {
    form.querySelectorAll("button").forEach(b => (b.disabled = true));
    try {
      await fn();
      dlg.close();
      if (!noReload) await load();
    } catch (err) {
      $(".form-msg", form).textContent = err.message || String(err);
      form.querySelectorAll("button").forEach(b => (b.disabled = false));
    }
  };
  form.onsubmit = ev => {
    if (ev.submitter?.value !== "save") return;
    ev.preventDefault();
    const v = {};
    fields.flat().filter(f => f.type !== "note").forEach(f => {
      const el = form.elements[f.name];
      v[f.name] = f.type === "checkbox" ? el.checked : el.value.trim();
    });
    run(() => onSave(v));
  };
  if (onDelete) $("[data-del]", form).onclick = () => { if (confirm(`${deleteLabel}할까요?`)) run(onDelete); };
  dlg.showModal();
}
// 관리자는 다른 팀원 이름으로도 입력할 수 있다.
function whoField(name, label, cur) {
  const me = cur || state.user.name;
  return { name, label, type: "select", options: state.user.admin ? state.data.members.map(m => m.name) : [me], value: me };
}
function webTag(x) { return x.web ? ` <span class="pill web" title="웹 입력${x.created_by ? " · " + esc(x.created_by) : ""}">웹</span>` : ""; }
const nullIfEmpty = v => v || null;

/* ------------------------------------------------------------ status per day */
function dayStatus(day) {
  const { members, entries } = state.data;
  const byName = {};
  entries.filter(e => e.start <= day && day <= e.end).forEach(e => (byName[e.name] ||= []).push(e));
  const res = { work: [], trip: [], leave: [] };
  members.forEach(m => {
    const es = byName[m.name] || [];
    const lv = es.find(e => LEAVE_CATS.includes(e.category));
    const tr = es.find(e => e.trip);
    if (lv) res.leave.push({ m, e: lv });
    else if (tr) res.trip.push({ m, e: tr });
    else res.work.push({ m, e: es[0] || null });
  });
  return res;
}

/* ------------------------------------------------------------ render root */
function render() {
  const d = state.data;
  if (!d) return;
  showErrors(d.errors || []);
  $("#teamName").textContent = d.team_name;
  document.title = `${d.team_name} HR`;
  $("#todayLabel").textContent = fmtLong(d.today);
  $("#syncInfo").textContent = `${STATIC ? "웹 데이터 기준" : "엑셀 동기화"} ${d.generated.slice(5, 16)}`;
  const upcoming = d.entries.filter(e => e.start > d.today && e.start <= addDays(d.today, 7)).length;
  $("#navLeave").textContent = upcoming || "";
  const fresh = d.notices.filter(n => n.date >= addDays(d.today, -7)).length;
  $("#navNotice").textContent = fresh || "";

  document.querySelectorAll(".nav a").forEach(a => a.classList.toggle("active", a.dataset.page === state.page));
  Object.keys(PAGES).forEach(p => ($("#page-" + p).hidden = p !== state.page));
  $("#pageTitle").textContent = PAGES[state.page];
  ({ dashboard: renderDashboard, notices: renderNotices, tasks: renderTasks, reviews: renderReviews, pclog: renderPcLog, leave: renderLeave })[state.page]();
}

/* ------------------------------------------------------------ dashboard */
function renderDashboard() {
  const d = state.data;
  const day = state.dashDate;
  const st = dayStatus(day);
  const off = isOffDay(day);
  const holidayName = d.holidays[day];
  const total = d.members.length;

  const chip = (x, note) => `<span class="chip">${esc(x.m.name)}${note ? ` <small>${esc(note)}</small>` : ""}</span>`;
  const col = (title, cls, list, noteFn) => `
    <div class="board-col">
      <h3>${pill(cls, title)} <span class="muted small">${list.length}명</span></h3>
      <div class="chips">${list.length ? list.map(x => chip(x, noteFn(x))).join("") : `<span class="empty">없음</span>`}</div>
    </div>`;

  const statTile = (cls, icon, num, lbl) => `
    <div class="card stat"><div class="dot ${cls}">${icon}</div>
      <div><div class="num">${num}</div><div class="lbl">${lbl}</div></div></div>`;

  const recent = [...d.entries].sort((a, b) => b.start.localeCompare(a.start) || b.id - a.id).slice(0, 8);

  $("#page-dashboard").innerHTML = `
    <div class="card">
      <div class="card-h">
        <h2>오늘의 근무현황</h2><span class="sub">${esc(fmtLong(day))}</span>
        <div class="right datenav">
          <button data-act="prev" title="이전 근무일">◀</button>
          <input type="date" id="dashDate" value="${day}">
          <button data-act="next" title="다음 근무일">▶</button>
          <button data-act="today">오늘</button>
        </div>
      </div>
      <div class="stats">
        ${statTile("c-blue", "👥", total, "전체 팀원")}
        ${statTile("c-green", "●", off ? "-" : st.work.length, "출근")}
        ${statTile("c-violet", "✈", off ? "-" : st.trip.length, "출장·외부활동")}
        ${statTile("c-amber", "☀", off ? "-" : st.leave.length, "휴가")}
      </div>
      ${off ? `<div class="holiday-banner">${holidayName ? `🎌 ${esc(holidayName)}` : "주말"} — 근무일이 아닙니다.</div>` : `
      <div class="board mt">
        ${col("출근", "t-연차", st.work, x => x.e ? shortLabel(x.e) : "")}
        ${col("출장·외부활동", "t-출장", st.trip, x => shortLabel(x.e))}
        ${col("휴가", "t-오후반차", st.leave, x => x.e.category)}
      </div>`}
    </div>

    <div class="card mt">${leaveCalendar(true)}</div>

    <div class="card mt">
      <div class="card-h"><h2>최근 휴가 신청</h2><a class="right link" href="#leave">복무관리 →</a></div>
      <div class="table-wrap"><table>
        <thead><tr><th>상태</th><th>신청자</th><th>유형</th><th>기간</th><th class="num">차감</th><th>상세</th></tr></thead>
        <tbody>${recent.map(e => `<tr>
          <td>${pill("s-" + entryStatus(e), entryStatus(e))}</td>
          <td><b>${esc(e.name)}</b></td>
          <td>${pill("t-" + e.category, e.category)}</td>
          <td>${fmtPeriod(e)}</td>
          <td class="num">${e.deduct ? fmtDays(e.deduct) : "-"}</td>
          <td class="muted small">${esc(e.category === "연차" || e.category.endsWith("반차") ? e.note : e.label)}</td>
        </tr>`).join("")}</tbody>
      </table></div>
    </div>`;

  const page = $("#page-dashboard");
  bindCalendar(page, renderDashboard);
  page.querySelectorAll("[data-act]").forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === "today") state.dashDate = d.today;
    else {
      let x = state.dashDate;
      do { x = addDays(x, a === "next" ? 1 : -1); } while (isOffDay(x));
      state.dashDate = x;
    }
    renderDashboard();
  });
  $("#dashDate").onchange = ev => { if (ev.target.value) { state.dashDate = ev.target.value; renderDashboard(); } };
}

/* ------------------------------------------------------------ notices */
function renderNotices() {
  const list = [...state.data.notices].sort((a, b) => (b.important - a.important) || b.date.localeCompare(a.date)
    || String(b.ts || b.created_at || "").localeCompare(String(a.ts || a.created_at || "")));
  const slackTag = n => n.slack ? pill("web", "Slack")
    : n.slack_ts && n.slack_ts !== "before-slack" ? ` <span class="small muted">· Slack 게시됨</span>` : "";
  $("#page-notices").innerHTML = `
    <div class="toolbar"><span class="muted">총 ${list.length}건 · Slack 전체공지 채널과 배포 때 동기화</span>
      <button class="btn-pri" style="margin-left:auto" id="btnNewNotice">+ 공지 작성</button></div>
    <div class="card">
      ${list.length ? list.map(n => `
        <div class="notice-item">
          <div class="t">${n.important ? pill("imp", "중요") : ""}${slackTag(n)} ${esc(n.title)}
            ${!n.slack && canEdit(n) ? `<span class="acts"><button class="btn-sm" data-edit="${esc(n.id)}">수정</button></span>` : ""}
            ${n.permalink ? `<span class="acts"><a class="link small" href="${esc(n.permalink)}" target="_blank" rel="noopener">Slack에서 보기 →</a></span>` : ""}</div>
          <div class="m">${esc(n.date)}${n.author ? " · " + esc(n.author) : ""}${n.edited ? " · 수정됨" : ""}${n.reply_count ? ` · 댓글 ${n.reply_count}` : ""}</div>
          ${n.body ? `<div class="b">${esc(n.body)}</div>` : ""}
        </div>`).join("") : `<div class="empty">등록된 공지가 없습니다.</div>`}
    </div>`;
  $("#btnNewNotice").onclick = () => openNotice(null);
  $("#page-notices").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openNotice(state.data.notices.find(n => n.id === b.dataset.edit)));
}
function openNotice(n) {
  openForm({
    title: n ? "공지 수정" : "공지 작성",
    data: n || { author: state.user.name, date: state.data.today },
    fields: [
      { name: "title", label: "제목", required: true },
      { name: "body", label: "내용", type: "textarea", rows: 7 },
      [{ name: "author", label: "작성자" }, { name: "date", label: "게시일", type: "date", required: true }],
      { name: "important", label: "중요 공지", type: "checkbox" },
      ...(n ? [] : [{ type: "note", help: "저장하면 다음 배포(평일 09·13·18시) 때 Slack 전체공지 채널에도 게시됩니다. 게시 후 수정·삭제는 Slack에 반영되지 않습니다." }]),
    ],
    onSave: v => n ? must(sb.from("hr_notices").update(v).eq("id", n.id)) : must(sb.from("hr_notices").insert(v)),
    onDelete: n && (() => must(sb.from("hr_notices").delete().eq("id", n.id))),
  });
}

/* ------------------------------------------------------------ tasks (주간업무) */
function formatTask(text, q) {
  if (!text) return `<span class="muted small">내용 없음</span>`;
  const hl = s => {
    let h = esc(s);
    if (q) h = h.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[&<>"']/g, c => esc(c)), "gi"), m => `<mark>${m}</mark>`);
    return h;
  };
  return text.split("\n").map(raw => {
    const ln = raw.trim();
    if (!ln) return "";
    if (/^[-ㅇ○●]/.test(ln)) return `<div class="fx-l1">${hl(ln.replace(/^[-ㅇ○●]\s*/, ""))}</div>`;
    if (/^\*/.test(ln)) return `<div class="fx-l2">${hl(ln.replace(/^\*\s*/, ""))}</div>`;
    if (/^<.*>$/.test(ln)) return `<div class="fx-sub">${hl(ln.slice(1, -1))}</div>`;
    if (/^\[/.test(ln)) return `<div class="fx-mono">${hl(ln)}</div>`;
    return `<div class="fx-p">${hl(ln)}</div>`;
  }).join("");
}
function areaKey(a) { return a.replace(/\s*및.*$/, "").replace(/조사$/, "").trim(); }

/* 새 주차 기본값: 다음 월요일이 속한 주. 몇째 주인지는 그 주 목요일 기준(26년11월2주차). */
function nextMonday(from) {
  let x = from;
  while (parseIso(x).getDay() !== 1) x = addDays(x, 1);
  return x;
}
function weekName(monday) {
  const t = parseIso(addDays(monday, 3));
  return { y: t.getFullYear() % 100, m: t.getMonth() + 1, n: Math.ceil(t.getDate() / 7) };
}
const canEditWeek = w => !!state.user && (state.user.admin || (w.created_by || "").toLowerCase() === state.user.email);

function openNewWeek(kind) {
  const list = kind === "plan" ? state.data.weeks : state.data.personal;
  const prev = list[0];
  const mon = nextMonday(kind === "report" && prev?.end ? addDays(prev.end, 1) : state.data.today);
  const { y, m, n } = weekName(mon);
  const md = s => `${parseIso(s).getMonth() + 1}/${parseIso(s).getDate()}`;
  const data = kind === "plan"
    ? { title: `${y}년${m}월${n}주차`, status: "초안", copy: !!prev,
        progress_label: prev ? prev.plan_label.replace(/^계획/, "진행") : "진행",
        plan_label: `계획(${String(m).padStart(2, "0")}월 ${n}주차, ${md(mon)}~)` }
    : { title: `${m}월 ${n}주차`, start: mon, end: addDays(mon, 4), copy: !!prev };
  const copyHelp = kind === "plan" ? "업무영역·작성자를 가져오고, 지난주 ‘계획’을 이번 주 ‘진행’에 넣습니다."
    : "완료·중단이 아닌 업무를 그대로 가져옵니다.";
  openForm({
    title: kind === "plan" ? "새 주차 만들기 · 주간업무계획" : "새 주차 만들기 · 개인별 업무",
    data,
    fields: [
      { name: "title", label: "주차 이름", required: true },
      ...(kind === "plan"
        ? [{ name: "status", label: "상태", type: "select", options: ["초안", "최종"] },
           [{ name: "progress_label", label: "왼쪽 열 제목" }, { name: "plan_label", label: "오른쪽 열 제목" }]]
        : [[{ name: "start", label: "시작일", type: "date", required: true }, { name: "end", label: "종료일", type: "date", required: true }]]),
      ...(prev ? [{ name: "copy", label: `‘${prev.title}’ 내용 이어받기 — ${copyHelp}`, type: "checkbox" }] : []),
    ],
    onSave: async v => {
      await must(sb.rpc("hr_new_week", {
        p_kind: kind, p_title: v.title, p_status: v.status || "", p_progress_label: v.progress_label || "",
        p_plan_label: v.plan_label || "", p_start: nullIfEmpty(v.start), p_end: nullIfEmpty(v.end),
        p_copy_from: v.copy ? prev.sheet : null,
      }));
      if (kind === "plan") state.weekIdx = 0; else state.pWeek = 0;
    },
  });
}

function openWeekSettings(kind, w) {
  const empty = kind === "plan" ? !w.items.length : !w.tasks.length;
  openForm({
    title: `주차 설정 · ${w.title}`,
    data: w,
    fields: [
      { name: "title", label: "주차 이름", required: true },
      ...(kind === "plan"
        ? [{ name: "status", label: "상태", type: "select", options: ["초안", "최종"] },
           [{ name: "progress_label", label: "왼쪽 열 제목" }, { name: "plan_label", label: "오른쪽 열 제목" }]]
        : [[{ name: "start", label: "시작일", type: "date" }, { name: "end", label: "종료일", type: "date" }]]),
    ],
    onSave: v => must(sb.from("hr_weeks").update(kind === "plan"
      ? { title: v.title, status: v.status, progress_label: v.progress_label, plan_label: v.plan_label }
      : { title: v.title, start_date: nullIfEmpty(v.start), end_date: nullIfEmpty(v.end) }).eq("id", w.sheet)),
    // 업무가 남아 있는 주차는 지우지 않는다(내용 보존)
    onDelete: empty && (() => must(sb.from("hr_weeks").delete().eq("id", w.sheet))),
    deleteLabel: "빈 주차 삭제",
  });
}

function renderTasks() {
  const weeks = state.data.weeks;
  const el = $("#page-tasks");
  state.weekIdx = Math.max(0, Math.min(state.weekIdx, weeks.length - 1));
  const q = state.taskQuery.trim();

  const tabs = `<div class="tabs">
    <button data-tab="week" class="${state.taskTab === "week" ? "active" : ""}">주차별 보기</button>
    <button data-tab="area" class="${state.taskTab === "area" ? "active" : ""}">업무영역별 추이</button>
    <button data-tab="person" class="${state.taskTab === "person" ? "active" : ""}">개인별 업무</button></div>`;

  if (state.taskTab === "person") {
    el.innerHTML = tabs + personalView();
    el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.taskTab = b.dataset.tab; renderTasks(); });
    bindPersonal(el);
    return;
  }
  if (!weeks.length) {
    el.innerHTML = tabs + `<div class="card empty">아직 주차가 없습니다. <button class="btn-pri" id="btnNewWeek">+ 새 주차</button></div>`;
    el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.taskTab = b.dataset.tab; renderTasks(); });
    $("#btnNewWeek").onclick = () => openNewWeek("plan");
    return;
  }

  let body = "";
  if (state.taskTab === "week") {
    const w = weeks[state.weekIdx];
    const items = w.items.filter(it => !q || [it.area, it.progress, it.plan, it.key, it.author].join("\n").toLowerCase().includes(q.toLowerCase()));
    const written = w.items.filter(it => it.author).length;
    const reviewed = w.items.filter(it => it.reviewed).length;
    // 팀장 검토는 '최종' 주차에서 관리자(팀장)가 업무영역별로 체크한다.
    const final = w.status === "최종", lead = state.user.admin;
    const reviewMark = it => !final ? ""
      : lead ? `<label class="chk review-chk"><input type="checkbox" data-review="${it.wid}" ${it.reviewed ? "checked" : ""}> 팀장 검토</label>`
      : it.reviewed ? pill("s-최종", "팀장 검토 ✓") : pill("s-완료", "검토 전");
    body = `
      <div class="toolbar">
        <button class="btn-sec" data-wk="1" ${state.weekIdx >= weeks.length - 1 ? "disabled" : ""}>◀ 이전 주</button>
        <select id="weekSel">${weeks.map((x, i) => `<option value="${i}" ${i === state.weekIdx ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select>
        <button class="btn-sec" data-wk="-1" ${state.weekIdx === 0 ? "disabled" : ""}>다음 주 ▶</button>
        ${w.status ? pill("s-" + w.status, w.status) : ""}
        ${canEditWeek(w) ? `<button class="btn-sm" id="btnWeekSet">주차 설정</button>` : ""}
        ${final && lead && reviewed < w.items.length ? `<button class="btn-sm" id="btnReviewAll">✓ 전체 검토 완료</button>` : ""}
        ${final && w.items.length && reviewed === w.items.length ? `
          <button class="btn-sm" id="btnHwpPlan" title="한글(HWPX) 양식 그대로 내려받기">⬇ 주간업무계획</button>
          <button class="btn-sm" id="btnHwpKey" title="한글(HWPX) 양식 그대로 내려받기">⬇ 핵심업무계획</button>`
        : final ? `<span class="small muted" title="팀장 검토가 모두 끝나면 한글 파일을 내려받을 수 있습니다">한글 다운로드: 검토 ${reviewed}/${w.items.length}</span>` : ""}
        <input id="taskQ" placeholder="검색 (업무·키워드·작성자)" value="${esc(state.taskQuery)}" style="margin-left:auto;min-width:220px">
        <button class="btn-sec" id="btnNewWeek">+ 새 주차</button>
        <button class="btn-pri" id="btnNewWeekly">+ 업무 추가</button>
      </div>
      <div class="stats" style="margin-bottom:16px">
        <div class="card stat"><div class="dot c-blue">☰</div><div><div class="num">${w.items.length}</div><div class="lbl">업무영역</div></div></div>
        <div class="card stat"><div class="dot c-green">✎</div><div><div class="num">${written}/${w.items.length}</div><div class="lbl">작성 완료</div></div></div>
        <div class="card stat"><div class="dot c-violet">✓</div><div><div class="num">${final ? `${reviewed}/${w.items.length}` : "-"}</div><div class="lbl">팀장 검토${final ? "" : " (최종 후)"}</div></div></div>
        <div class="card stat"><div class="dot c-amber">★</div><div><div class="num">${w.items.filter(i => i.key).length}</div><div class="lbl">핵심업무 지정</div></div></div>
      </div>
      ${items.length ? items.map(it => `
        <div class="card task-card">
          <div class="task-head">
            <h3>${esc(it.area)}</h3>
            ${reviewMark(it)}
            <span class="who">${it.author ? `작성 ${esc(it.author)}${it.written ? " · " + esc(it.written) : ""}` : "미작성"}</span>
            <button class="btn-sm" data-wedit="${it.wid}">수정</button>
          </div>
          <div class="task-cols">
            <div class="task-col"><h4>${esc(w.progress_label)}</h4><div class="txt">${formatTask(it.progress, q)}</div></div>
            <div class="task-col"><h4>${esc(w.plan_label)}</h4><div class="txt">${formatTask(it.plan, q)}</div></div>
          </div>
          ${isReviewArea(it.area) && it.stats ? statsTable(it.stats) : ""}
          ${it.key ? `<div class="keybox"><b>★ 핵심 업무 계획</b>${formatTask(it.key, q)}</div>` : ""}
        </div>`).join("") : `<div class="card empty">검색 결과가 없습니다.</div>`}`;
  } else {
    const areas = [...new Set(weeks.flatMap(w => w.items.map(i => areaKey(i.area))))];
    if (!areas.includes(state.taskArea)) state.taskArea = areas[0] || "";
    const rows = weeks.map(w => ({ w, it: w.items.find(i => areaKey(i.area) === state.taskArea) })).filter(x => x.it);
    body = `
      <div class="toolbar">
        <select id="areaSel">${areas.map(a => `<option ${a === state.taskArea ? "selected" : ""}>${esc(a)}</option>`).join("")}</select>
        <span class="muted small">${rows.length}개 주차 · 각 주차의 ‘계획’ 기준</span>
        <input id="taskQ" placeholder="검색" value="${esc(state.taskQuery)}" style="margin-left:auto;min-width:220px">
      </div>
      <div class="card"><div class="timeline">
        ${rows.filter(({ it }) => !q || (it.plan + it.progress).toLowerCase().includes(q.toLowerCase())).map(({ w, it }) => `
          <div class="tl-item">
            <div class="tl-h">${esc(w.plan_label)} ${w.status ? pill("s-" + w.status, w.status) : ""}
              <span class="muted small">${esc(it.author || "")}</span></div>
            <div class="txt">${formatTask(it.plan, q)}</div>
          </div>`).join("")}
      </div></div>`;
  }
  el.innerHTML = tabs + body;

  el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.taskTab = b.dataset.tab; renderTasks(); });
  el.querySelectorAll("[data-wk]").forEach(b => b.onclick = () => { state.weekIdx += Number(b.dataset.wk); renderTasks(); });
  const ws = $("#weekSel"); if (ws) ws.onchange = () => { state.weekIdx = Number(ws.value); renderTasks(); };
  const nw = $("#btnNewWeekly"); if (nw) nw.onclick = () => openWeekly(weeks[state.weekIdx], null);
  const nk = $("#btnNewWeek"); if (nk) nk.onclick = () => openNewWeek("plan");
  const wsb = $("#btnWeekSet"); if (wsb) wsb.onclick = () => openWeekSettings("plan", weeks[state.weekIdx]);
  const setReviewed = async (ids, on, ctl) => {
    ctl.disabled = true;
    try {
      await must(sb.from("hr_weekly").update({ reviewed: on }).in("id", ids));
      await load();
    } catch (err) { alert(err.message || err); ctl.disabled = false; }
  };
  el.querySelectorAll("[data-review]").forEach(c => c.onchange = () => setReviewed([Number(c.dataset.review)], c.checked, c));
  const hp = $("#btnHwpPlan"); if (hp) hp.onclick = () => downloadHwpx(buildPlanHwpx, weeks[state.weekIdx], hp);
  const hk = $("#btnHwpKey"); if (hk) hk.onclick = () => downloadHwpx(buildKeyHwpx, weeks[state.weekIdx], hk);
  const ra = $("#btnReviewAll");
  if (ra) ra.onclick = () => {
    const w = weeks[state.weekIdx];
    if (confirm(`${w.title}의 업무영역 ${w.items.length}개를 모두 팀장 검토 완료로 표시할까요?`))
      setReviewed(w.items.map(i => i.wid), true, ra);
  };
  el.querySelectorAll("[data-wedit]").forEach(b => b.onclick = () => {
    const w = weeks[state.weekIdx];
    openWeekly(w, w.items.find(i => i.wid === Number(b.dataset.wedit)));
  });
  const as = $("#areaSel"); if (as) as.onchange = () => { state.taskArea = as.value; renderTasks(); };
  const tq = $("#taskQ");
  tq.oninput = () => {
    state.taskQuery = tq.value;
    const pos = tq.selectionStart;
    renderTasks();
    const n = $("#taskQ"); n.focus(); n.setSelectionRange(pos, pos);
  };
}

// '사전협의' 업무영역에는 <사전협의 진행현황> 표(광역지자체) 숫자를 주차별로 직접 입력한다. 합계는 계산.
const REVIEW_STATS = [["wait", "접수대기"], ["reject", "반려"], ["kosi", "중기연 검토"], ["office", "지방청 검토"], ["done", "협의완료"]];
const isReviewArea = a => /사전협의/.test(a || "");
const statsTotal = s => REVIEW_STATS.reduce((n, [k]) => n + (Number(s?.[k]) || 0), 0);
function statsTable(s) {
  return `<div class="table-wrap mt"><table class="stats-table">
    <thead><tr><th>구분</th>${REVIEW_STATS.map(([, l]) => `<th class="num">${l}</th>`).join("")}<th class="num">합계(누적)</th></tr></thead>
    <tbody><tr><td>광역지자체</td>${REVIEW_STATS.map(([k]) => `<td class="num">${s[k] ?? "-"}</td>`).join("")}<td class="num"><b>${statsTotal(s)}</b></td></tr></tbody>
  </table></div>`;
}

/* ------------------------------------------------------------ 주간업무 한글(HWPX) 내려받기 */
// static/templates/*.hwpx는 tools/make_hwpx_templates.py가 실제 양식에서 내용만 비워 만든 견본이다.
// 견본 문단(빈 줄·{{L1}}·{{L2}})을 복제해 채우므로 글꼴·문단 모양·표 서식은 양식 그대로 유지된다.
const HP_NS = "http://www.hancom.co.kr/hwpml/2011/paragraph";
const HH_NS = "http://www.hancom.co.kr/hwpml/2011/head";
const AREA_HWP = { "만족도조사": "정책만족도", "현황조사": "현황조사 및 현행화" };  // 웹 업무영역 → 보고서 표기

const hxAll = (el, name) => [...el.getElementsByTagNameNS(HP_NS, name)];
const hxKids = (el, name) => [...el.children].filter(c => c.namespaceURI === HP_NS && c.localName === name);
function hxUp(el, name) {
  while (el && !(el.namespaceURI === HP_NS && el.localName === name)) el = el.parentNode;
  return el;
}
function hxReplace(root, marker, value) {
  hxAll(root, "t").filter(t => t.textContent.includes(marker)).forEach(t => {
    t.textContent = t.textContent.replace(marker, value);
    hxKids(hxUp(t, "p"), "linesegarray").forEach(x => x.remove());  // 줄 배치는 한글이 다시 계산한다
  });
}
// 검정 글자 모양 id → 같은 모양의 파란 글자 id (양식에서 '지난주와 달라진 계획'을 파랗게 쓴다)
function blueStyles(headerDoc) {
  const key = el => { const c = el.cloneNode(true); c.removeAttribute("id"); c.removeAttribute("textColor"); return new XMLSerializer().serializeToString(c); };
  const blue = {}, byKey = {};
  const all = [...headerDoc.getElementsByTagNameNS(HH_NS, "charPr")];
  all.filter(c => (c.getAttribute("textColor") || "").toUpperCase() === "#0000FF").forEach(c => (byKey[key(c)] ||= c.getAttribute("id")));
  all.forEach(c => { const b = byKey[key(c)]; if (b) blue[c.getAttribute("id")] = b; });
  return blue;
}
// 웹 입력 줄 → 보고서 문단: '- ' 항목(앞에 빈 줄)과 ' * ' 세부항목. 진행현황 줄은 표로 따로 넣는다.
function hwpLines(text) {
  const out = [];
  String(text || "").replace(/`/g, "’").split("\n").forEach(raw => {
    const s = raw.replace(/\s+$/, ""), t = s.trim();
    if (!t || /^<.*진행현황.*>$/.test(t) || /^\[(구분|광역지자체)\]/.test(t)) return;
    if (/^[-ㅇ○●]/.test(t) && !/^\s/.test(s)) out.push({ l1: true, text: "- " + t.replace(/^[-ㅇ○●]\s*/, "") });
    else if (/^[*\-]/.test(t)) out.push({ l1: false, text: ` ${t[0]} ` + t.replace(/^[*\-]\s*/, "") });
    else out.push({ l1: false, text: " " + t });
  });
  return out;
}
function statsFromText(text) {
  const m = String(text || "").match(/\[광역지자체\]\s*([\d\s/]+)/);
  if (!m) return null;
  const n = m[1].split("/").map(x => Number(x.trim()));
  return Object.fromEntries(REVIEW_STATS.map(([k], i) => [k, Number.isFinite(n[i]) ? n[i] : null]));
}
// 계획 줄에서 진행 칸의 가장 비슷한 줄에 없는 낱말만 파랗게 표시한다(양식 원본의 표기 방식).
// 반환: [[글자, 파랑여부], ...] 같은 색끼리 묶은 조각
function diffSegments(text, others) {
  const tok = s => s.split(/(?<=\s)(?=\S)/);  // 낱말 + 뒤 공백
  const norm = t => t.trim().replace(/[‘’'`]/g, "'");
  const a = tok(text);
  let best = null, bestN = 0;
  others.forEach(o => {
    const b = tok(o), dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    if (dp[0][0] > bestN) { bestN = dp[0][0]; best = { b, dp }; }
  });
  const isWord = t => !!t.trim() && !/^[-*]$/.test(t.trim());
  const same = new Array(a.length).fill(false);
  if (best) {
    for (let i = 0, j = 0; i < a.length && j < best.b.length;) {
      if (norm(a[i]) === norm(best.b[j])) { same[i] = true; i++; j++; }
      else if (best.dp[i + 1][j] >= best.dp[i][j + 1]) i++; else j++;
    }
  }
  // 표시(-, *)를 뺀 낱말이 절반도 안 겹치면 완전히 새 줄로 보고 표시만 검정으로 둔다
  const words = a.filter(isWord).length, matched = a.filter((t, i) => same[i] && isWord(t)).length;
  if (matched < Math.max(1, words / 2)) a.forEach((t, i) => (same[i] = !isWord(t)));
  const segs = [];
  a.forEach((t, i) => {
    const b = !same[i] && !!t.trim();
    if (segs.length && segs[segs.length - 1][1] === b) segs[segs.length - 1][0] += t; else segs.push([t, b]);
  });
  return segs;
}
function fillHwpCell(tc, lines, blue, compare) {
  const sub = hxKids(tc, "subList")[0];
  const [spacer, l1, l2, anchor] = hxKids(sub, "p");
  [spacer, l1, l2].forEach(p => p.remove());
  lines.forEach(ln => {
    if (ln.l1) sub.insertBefore(spacer.cloneNode(true), anchor || null);
    const p = (ln.l1 ? l1 : l2).cloneNode(true);
    hxReplace(p, ln.l1 ? "{{L1}}" : "{{L2}}", ln.text);
    if (compare) {
      const run = hxAll(p, "run").find(r => hxKids(r, "t").length);
      const black = run.getAttribute("charPrIDRef");
      if (blue[black]) {
        const segs = diffSegments(ln.text, compare);
        segs.forEach(([txt, isBlue], i) => {
          const r = i ? run.cloneNode(true) : run;
          hxKids(r, "t")[0].textContent = txt;
          r.setAttribute("charPrIDRef", isBlue ? blue[black] : black);
          if (i) p.insertBefore(r, segs[i - 1].el.nextSibling);
          segs[i].el = r;
        });
      }
    }
    sub.insertBefore(p, anchor || null);
  });
  if (anchor && lines.length) sub.insertBefore(spacer.cloneNode(true), anchor);  // 진행현황 앞 빈 줄
}
function hwpWeekInfo(w) {
  const m = w.title.match(/(\d{2})년\s*(\d{1,2})월\s*([\d·,]+)주차/) || [];
  const year = m[1] ? 2000 + Number(m[1]) : Number(state.data.today.slice(0, 4));
  const label = m[2] ? `${Number(m[2])}월 ${m[3]}주차` : w.title;
  const d = w.plan_label.match(/(\d{1,2})\/(\d{1,2})/);
  let range = "";
  if (d) {
    const start = `${year}-${String(d[1]).padStart(2, "0")}-${String(d[2]).padStart(2, "0")}`, end = addDays(start, 4);
    const f = s => `${Number(s.slice(5, 7))}.${Number(s.slice(8))}`;
    range = `(${f(start)}~${f(end)})`;
  }
  return { year, label, range };
}
const hwpLabel = l => l.replace(/^진행/, "계획").replace(/\s*,[^)]*\)/, ")");
async function loadZip() {
  if (!window.JSZip) await new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
    s.onload = ok; s.onerror = () => fail(new Error("압축 라이브러리를 불러오지 못했습니다"));
    document.head.appendChild(s);
  });
  return window.JSZip;
}
async function openHwpx(name) {
  const JSZip = await loadZip();
  const res = await fetch(`templates/${name}.hwpx`, { cache: "no-cache" });
  if (!res.ok) throw new Error("한글 양식 파일을 찾지 못했습니다");
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const parse = async path => new DOMParser().parseFromString(await zip.file(path).async("string"), "application/xml");
  return { zip, sec: await parse("Contents/section0.xml"), head: await parse("Contents/header.xml") };
}
async function packHwpx({ zip, sec }) {
  zip.file("Contents/section0.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + new XMLSerializer().serializeToString(sec.documentElement));
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });  // 맨 앞·무압축 유지
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", mimeType: "application/hwp+zip" });
}

async function buildPlanHwpx(w) {
  const doc = await openHwpx("weekly_plan");
  const { sec } = doc, blue = blueStyles(doc.head), info = hwpWeekInfo(w);
  const main = hxAll(sec, "tbl").find(t => t.getAttribute("colCnt") === "3");
  const [, , normal, review] = hxKids(main, "tr");
  normal.remove(); review.remove();
  w.items.forEach((it, i) => {
    const isRv = isReviewArea(it.area);
    const tr = (isRv ? review : normal).cloneNode(true);
    const [c0, c1, c2] = hxKids(tr, "tc");
    [c0, c1, c2].forEach(tc => hxKids(tc, "cellAddr")[0].setAttribute("rowAddr", String(2 + i)));
    hxReplace(c0, "{{AREA}}", AREA_HWP[it.area] || it.area);
    const prog = hwpLines(it.progress), plan = hwpLines(it.plan);
    fillHwpCell(c1, prog, blue, null);
    fillHwpCell(c2, plan, blue, prog.map(l => l.text));
    if (isRv) {
      const s = it.stats && REVIEW_STATS.some(([k]) => it.stats[k] != null) ? it.stats : statsFromText(it.progress);
      const sub = hxKids(c1, "subList")[0], rest = hxKids(sub, "p").slice(-3);  // 빈 줄, '<사전협의 진행현황>', 표 문단
      if (s) {
        REVIEW_STATS.forEach(([k]) => hxReplace(c1, `{{${k}}}`, s[k] == null ? "-" : String(s[k])));
        hxReplace(c1, "{{total}}", String(statsTotal(s)));
      } else rest.forEach(p => p.remove());
    }
    main.appendChild(tr);
  });
  main.setAttribute("rowCnt", String(2 + w.items.length));
  hxReplace(sec, "{{PROG_LABEL}}", hwpLabel(w.progress_label));
  hxReplace(sec, "{{PLAN_LABEL}}", hwpLabel(w.plan_label));
  hxReplace(sec, "{{HEADING}}", `${info.year}년 ${info.label}${info.range}`);
  return { blob: await packHwpx(doc), name: `주간업무계획 ${info.label}_평가팀` };
}

async function buildKeyHwpx(w) {
  const doc = await openHwpx("weekly_key");
  const { sec } = doc, info = hwpWeekInfo(w);
  const lines = w.items.flatMap(it => String(it.key || "").replace(/`/g, "’").split("\n"))
    .map(s => s.trim().replace(/^[-ㅇ○●*]\s*/, "")).filter(Boolean);
  const t = hxAll(sec, "t").find(x => x.textContent.includes("{{KEY}}"));
  const sub = hxUp(t, "subList");
  const [item, spacer] = hxKids(sub, "p");
  item.remove(); spacer.remove();
  lines.forEach((ln, i) => {
    if (i) sub.appendChild(spacer.cloneNode(true));
    const p = item.cloneNode(true);
    hxReplace(p, "{{KEY}}", ln);
    sub.appendChild(p);
  });
  if (!lines.length) sub.appendChild(spacer);
  hxReplace(sec, "{{TITLE}}", `${info.year}년 ${info.label} 중소벤처기업연구원 부서별 핵심 업무 계획`);
  return { blob: await packHwpx(doc), name: `주간핵심업무계획 ${info.label}_평가팀` };
}

async function downloadHwpx(build, w, btn) {
  btn.disabled = true;
  try {
    const { blob, name } = await build(w);
    const t = state.data.today.replace(/-/g, "").slice(2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `#${t}_${name}.hwpx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  } catch (err) { alert(`한글 파일을 만들지 못했습니다. (${err.message || err})`); }
  btn.disabled = false;
}

// 주간업무계획은 팀 공동 문서라 팀원 누구나 고칠 수 있다. 삭제는 작성자·관리자, 팀장 검토 표시는 관리자만.
function openWeekly(w, it) {
  const members = state.data.members.map(m => m.name);
  const authors = [...new Set([...members, it?.author].filter(Boolean))];
  const withStats = isReviewArea(it?.area);
  const sf = REVIEW_STATS.map(([k, l]) => ({ name: "st_" + k, label: l, type: "number" }));
  openForm({
    title: `${it ? "업무 수정" : "업무 추가"} · ${w.title}`,
    data: it ? { ...it, ...Object.fromEntries(REVIEW_STATS.map(([k]) => ["st_" + k, it.stats?.[k] ?? ""])) } : { author: state.user.name },
    fields: [
      { name: "area", label: "업무영역", required: true, list: [...new Set(w.items.map(i => i.area))] },
      { name: "progress", label: w.progress_label, type: "textarea", rows: 6, help: "줄 앞에 - 또는 ○를 쓰면 항목, *는 세부항목으로 표시됩니다." },
      { name: "plan", label: w.plan_label, type: "textarea", rows: 6 },
      { name: "key", label: "핵심 업무 계획 (선택)", type: "textarea", rows: 2 },
      ...(withStats ? [{ type: "note", help: "<사전협의 진행현황> 광역지자체 건수 (합계는 자동 계산)" }, [sf[0], sf[1]], [sf[2], sf[3]], sf[4]] : []),
      { name: "author", label: "작성자", type: "select", options: ["", ...authors].map(a => [a, a || "(미작성)"]) },
      ...(state.user.admin && w.status === "최종" ? [{ name: "reviewed", label: "팀장 검토 완료", type: "checkbox" }] : []),
    ],
    onSave: async v => {
      const row = { area: v.area, progress: v.progress, plan: v.plan, key: v.key, author: v.author,
        written: state.data.today.slice(5).replace("-", "/") };
      if ("reviewed" in v) row.reviewed = v.reviewed;
      if (withStats) row.stats = Object.fromEntries(REVIEW_STATS.map(([k]) => [k, v["st_" + k] === "" ? null : Number(v["st_" + k])]));
      const save = r => it ? must(sb.from("hr_weekly").update(r).eq("id", it.wid))
        : must(sb.from("hr_weekly").insert({ ...r, sheet: w.sheet }));
      try {
        await save(row);
      } catch (err) {
        // 진행현황 칸(hr_weekly.stats)이 아직 DB에 없으면 나머지만 저장한다(supabase/2026-11-04_weekly_stats.sql)
        if (!("stats" in row) || !/stats/.test(err.message)) throw err;
        delete row.stats;
        await save(row);
        alert("업무 내용은 저장했지만, 진행현황 숫자 칸이 아직 DB에 없어 숫자는 저장하지 못했습니다. 관리자에게 알려 주세요.");
      }
    },
    onDelete: it && canEdit(it) && (() => must(sb.from("hr_weekly").delete().eq("id", it.wid))),
  });
}

/* ------------------------------------------------------------ 개인별 업무 (주간업무보고) */
const P_STATUS = ["진행 중", "시작 전", "완료", "중단"];
const P_STATUS_CLS = { "진행 중": "ps-run", "시작 전": "ps-wait", "완료": "ps-done", "중단": "ps-stop" };

// 엑셀에서 가져온 빈 양식 시트는 숨기고, 웹에서 만든 주차는 비어 있어도 보인다.
function pWeeks() { return state.data.personal.filter(w => w.tasks.length || w.created_by); }
function isOverdue(t) { return t.due && t.due < state.data.today && !["완료", "중단"].includes(t.status); }
function ownerOrder(names) {
  const order = state.data.members.map(m => m.name);
  const rank = n => (order.indexOf(n) + 1) || 999;
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
function weekLabel(w) {
  return w.start ? `${w.title} (${fmtDate(w.start, false)}~${fmtDate(w.end, false)})` : w.title;
}

function personalView() {
  const weeks = pWeeks();
  if (!weeks.length) return `<div class="card empty">아직 주차가 없습니다. <button class="btn-pri" id="btnNewPWeek">+ 새 주차</button></div>`;
  const allWeeks = state.pWeek === "all";
  if (!allWeeks) state.pWeek = Math.min(state.pWeek, weeks.length - 1);
  const scope = allWeeks ? weeks : [weeks[state.pWeek]];
  const q = state.taskQuery.trim().toLowerCase();

  const inScope = scope.flatMap(w => w.tasks.map(t => ({ ...t, week: w })));
  const owners = ownerOrder(new Set(inScope.map(t => t.owner)));
  if (state.pOwner && !owners.includes(state.pOwner)) state.pOwner = "";
  const list = inScope.filter(t =>
    (!state.pOwner || t.owner === state.pOwner) &&
    (!state.pStatus || t.status === state.pStatus) &&
    (!q || [t.owner, t.name, t.content, t.result, t.memo].join("\n").toLowerCase().includes(q)));
  const base = inScope.filter(t => !state.pOwner || t.owner === state.pOwner);
  const cnt = s => base.filter(t => t.status === s).length;

  const hl = s => {
    let h = esc(s);
    if (q) h = h.replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), m => `<mark>${m}</mark>`);
    return h.replace(/\n/g, "<br>");
  };
  const stars = n => `<span class="stars" title="우선순위 ${n}">${"★".repeat(n)}<span class="off">${"★".repeat(Math.max(0, 4 - n))}</span></span>`;
  const table = (tasks, showOwner, showWeek) => `
    <div class="table-wrap"><table class="ptable">
      <thead><tr>${showWeek ? "<th>주차</th>" : ""}${showOwner ? "<th>담당</th>" : ""}<th>우선</th><th style="width:38%">업무</th><th>상태</th><th>시작 ~ 완료예정</th><th>완료일</th><th>결과/메모</th></tr></thead>
      <tbody>${tasks.map(t => `<tr>
        ${showWeek ? `<td class="small nowrap">${esc(t.week.title)}</td>` : ""}
        ${showOwner ? `<td><b>${esc(t.owner)}</b></td>` : ""}
        <td>${stars(t.priority)}</td>
        <td><div class="pt-name">${hl(t.name || "(업무명 없음)")}${canEdit(t) ? ` <button class="btn-sm" data-tedit="${t.wid}">수정</button>` : ""}</div>${t.content ? `<div class="pt-desc">${hl(t.content)}</div>` : ""}</td>
        <td class="nowrap">${pill(P_STATUS_CLS[t.status] || "t-기타", t.status)}${isOverdue(t) ? " " + pill("imp", "기한초과") : ""}</td>
        <td class="small nowrap">${t.start || t.due ? `${t.start ? fmtDate(t.start) : ""} ~ ${t.due ? fmtDate(t.due) : ""}` : "-"}</td>
        <td class="small nowrap">${t.done ? fmtDate(t.done) : "-"}</td>
        <td class="small">${hl(t.result)}${t.result && t.memo ? "<br>" : ""}${t.memo ? `<span class="muted">${hl(t.memo)}</span>` : ""}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;

  let main;
  if (!list.length) main = `<div class="card empty">조건에 맞는 업무가 없습니다.</div>`;
  else if (state.pOwner && allWeeks) {
    main = weeks.map(w => {
      const ts = list.filter(t => t.week === w || t.week.sheet === w.sheet);
      return ts.length ? `<div class="card task-card"><div class="card-h"><h2>${esc(weekLabel(w))}</h2><span class="sub">${ts.length}건</span></div>${table(ts, false, false)}</div>` : "";
    }).join("");
  } else if (state.pOwner) {
    main = `<div class="card">${table(list, false, false)}</div>`;
  } else {
    main = ownerOrder(new Set(list.map(t => t.owner))).map(o => {
      const ts = list.filter(t => t.owner === o);
      const m = state.data.members.find(x => x.name === o);
      return `<div class="card task-card">
        <div class="card-h"><h2>${esc(o)}</h2><span class="sub">${esc(m?.position || "")}</span>
          <span class="right small muted">${ts.length}건 · 진행 ${ts.filter(t => t.status === "진행 중").length} · 완료 ${ts.filter(t => t.status === "완료").length}</span></div>
        ${table(ts, false, allWeeks)}</div>`;
    }).join("");
  }

  return `
    <div class="toolbar">
      <button class="btn-sec" data-pw="1" ${allWeeks || state.pWeek >= weeks.length - 1 ? "disabled" : ""}>◀ 이전 주</button>
      <select id="pWeekSel">
        ${weeks.map((w, i) => `<option value="${i}" ${!allWeeks && i === state.pWeek ? "selected" : ""}>${esc(weekLabel(w))}</option>`).join("")}
        <option value="all" ${allWeeks ? "selected" : ""}>전체 주차 모아보기</option>
      </select>
      <button class="btn-sec" data-pw="-1" ${allWeeks || state.pWeek === 0 ? "disabled" : ""}>다음 주 ▶</button>
      <div class="seg">${["", ...P_STATUS].map(s => `<button data-ps="${s}" class="${state.pStatus === s ? "on" : ""}">${s || "전체"}</button>`).join("")}</div>
      ${!allWeeks && canEditWeek(weeks[state.pWeek]) ? `<button class="btn-sm" id="btnPWeekSet">주차 설정</button>` : ""}
      <input id="taskQ" placeholder="검색 (업무명·내용·결과)" value="${esc(state.taskQuery)}" style="margin-left:auto;min-width:220px">
      <button class="btn-sec" id="btnNewPWeek">+ 새 주차</button>
      <button class="btn-pri" id="btnNewTask" title="${esc(weekLabel(allWeeks ? weeks[0] : weeks[state.pWeek]))} 주차에 추가">+ 업무 추가</button>
    </div>
    <div class="owner-chips">
      <button data-po="" class="${!state.pOwner ? "on" : ""}">전체 <small>${inScope.length}</small></button>
      ${owners.map(o => `<button data-po="${esc(o)}" class="${state.pOwner === o ? "on" : ""}">${esc(o)} <small>${inScope.filter(t => t.owner === o).length}</small></button>`).join("")}
    </div>
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="dot c-blue">☰</div><div><div class="num">${base.length}</div><div class="lbl">전체 업무${state.pOwner ? ` · ${esc(state.pOwner)}` : ""}</div></div></div>
      <div class="card stat"><div class="dot c-violet">▶</div><div><div class="num">${cnt("진행 중")}</div><div class="lbl">진행 중 · 시작 전 ${cnt("시작 전")}</div></div></div>
      <div class="card stat"><div class="dot c-green">✓</div><div><div class="num">${cnt("완료")}</div><div class="lbl">완료${cnt("중단") ? ` · 중단 ${cnt("중단")}` : ""}</div></div></div>
      <div class="card stat"><div class="dot c-red">!</div><div><div class="num">${base.filter(isOverdue).length}</div><div class="lbl">기한초과 (완료예정일 경과)</div></div></div>
    </div>
    ${main}
    <p class="small muted">※ 본인 업무는 ‘수정’으로 고칠 수 있습니다(관리자는 모든 업무). 새 주차를 만들면 이전 주의 진행 중인 업무를 이어받을 수 있습니다.</p>`;
}

function bindPersonal(el) {
  $("#btnNewPWeek").onclick = () => openNewWeek("report");
  if (!pWeeks().length) return;
  const pws = $("#btnPWeekSet"); if (pws) pws.onclick = () => openWeekSettings("report", pWeeks()[state.pWeek]);
  el.querySelectorAll("[data-pw]").forEach(b => b.onclick = () => { state.pWeek += Number(b.dataset.pw); renderTasks(); });
  const ws = $("#pWeekSel");
  ws.onchange = () => { state.pWeek = ws.value === "all" ? "all" : Number(ws.value); renderTasks(); };
  el.querySelectorAll("[data-ps]").forEach(b => b.onclick = () => { state.pStatus = b.dataset.ps; renderTasks(); });
  el.querySelectorAll("[data-po]").forEach(b => b.onclick = () => { state.pOwner = b.dataset.po; renderTasks(); });
  const weeks = pWeeks();
  $("#btnNewTask").onclick = () => openTask(state.pWeek === "all" ? weeks[0] : weeks[state.pWeek], null);
  el.querySelectorAll("[data-tedit]").forEach(b => b.onclick = () => {
    const id = Number(b.dataset.tedit);
    const w = weeks.find(x => x.tasks.some(t => t.wid === id));
    openTask(w, w.tasks.find(t => t.wid === id));
  });
  const tq = $("#taskQ");
  tq.oninput = () => {
    state.taskQuery = tq.value;
    const pos = tq.selectionStart;
    renderTasks();
    const n = $("#taskQ"); n.focus(); n.setSelectionRange(pos, pos);
  };
}

function openTask(w, t) {
  openForm({
    title: `${t ? "업무 수정" : "업무 추가"} · ${weekLabel(w)}`,
    data: t ? { ...t, priority: String(t.priority) } : { status: "진행 중", priority: "2", start: state.data.today },
    fields: [
      [whoField("owner", "담당", t?.owner), { name: "status", label: "상태", type: "select", options: P_STATUS }],
      { name: "name", label: "업무명", required: true },
      { name: "content", label: "내용", type: "textarea", rows: 3 },
      [{ name: "priority", label: "우선순위", type: "select", options: [["4", "★★★★"], ["3", "★★★"], ["2", "★★"], ["1", "★"], ["0", "없음"]] },
       { name: "start", label: "시작일", type: "date" }],
      [{ name: "due", label: "완료예정일", type: "date" }, { name: "done", label: "완료일", type: "date" }],
      { name: "result", label: "결과", type: "textarea", rows: 2 },
      { name: "memo", label: "메모" },
    ],
    onSave: v => {
      const row = { owner: v.owner, status: v.status, name: v.name, content: v.content, priority: Number(v.priority),
        start_date: nullIfEmpty(v.start), due: nullIfEmpty(v.due), done: nullIfEmpty(v.done), result: v.result, memo: v.memo };
      return t ? must(sb.from("hr_tasks").update(row).eq("id", t.wid)) : must(sb.from("hr_tasks").insert({ ...row, sheet: w.sheet }));
    },
    onDelete: t && (() => must(sb.from("hr_tasks").delete().eq("id", t.wid))),
  });
}

/* ------------------------------------------------------------ 공용 PC 사용대장 */
// 일시는 timestamptz로 저장하고, 화면에서는 보는 사람 PC 시간대(한국)로 보여준다.
function localDT(ts) {
  const d = new Date(ts), z = n => String(n).padStart(2, "0");
  return `${iso(d)}T${z(d.getHours())}:${z(d.getMinutes())}`;
}
function fmtDT(ts, sameDayAs) {
  if (!ts) return "";
  const [day, hm] = localDT(ts).split("T");
  return sameDayAs && localDT(sameDayAs).startsWith(day) ? hm : `${fmtDate(day)} ${hm}`;
}
function pcDuration(r) {
  const min = Math.round((new Date(r.end_at) - new Date(r.start_at)) / 60000);
  return min < 60 ? `${min}분` : `${Math.floor(min / 60)}시간${min % 60 ? ` ${min % 60}분` : ""}`;
}

function renderPcLog() {
  const all = [...state.data.pclog].sort((a, b) => b.start_at.localeCompare(a.start_at));
  const months = [...new Set(all.map(r => localDT(r.start_at).slice(0, 7)))];
  state.pcMonth ??= state.data.today.slice(0, 7);
  const list = all.filter(r => !state.pcMonth || localDT(r.start_at).startsWith(state.pcMonth));
  const inUse = all.filter(r => !r.end_at);
  $("#page-pclog").innerHTML = `
    <div class="toolbar">
      <select id="pcMonth"><option value="">전체 기간</option>
        ${[...new Set([state.data.today.slice(0, 7), ...months])].sort().reverse().map(m =>
          `<option value="${m}" ${m === state.pcMonth ? "selected" : ""}>${m.replace("-", "년 ")}월</option>`).join("")}</select>
      <span class="muted">${list.length}건</span>
      ${inUse.length ? `<span class="small">${pill("ps-run", "사용 중")} ${inUse.map(r => esc(r.user_name)).join(", ")}</span>` : ""}
      <button class="btn-sec" style="margin-left:auto" id="btnPcXlsx" ${list.length ? "" : "disabled"}>⬇ 엑셀 다운로드</button>
      <button class="btn-pri" id="btnNewPc">+ 사용 기록</button>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>사용시작</th><th>사용종료</th><th>사용시간</th><th>사용자</th><th style="width:40%">사용용도</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(r => `<tr>
        <td class="nowrap">${fmtDT(r.start_at)}</td>
        <td class="nowrap">${r.end_at ? fmtDT(r.end_at, r.start_at) : pill("ps-run", "사용 중")}</td>
        <td class="nowrap small">${r.end_at ? pcDuration(r) : "-"}</td>
        <td><b>${esc(r.user_name)}</b></td>
        <td>${esc(r.purpose)}</td>
        <td class="nowrap">${canEdit(r) ? `${r.end_at ? "" : `<button class="btn-sm" data-pcend="${r.id}">사용 종료</button> `}<button class="btn-sm" data-pcedit="${r.id}">수정</button>` : ""}</td>
      </tr>`).join("") : `<tr><td colspan="6" class="empty">기록이 없습니다.</td></tr>`}</tbody>
    </table></div></div>`;
  $("#pcMonth").onchange = ev => { state.pcMonth = ev.target.value; renderPcLog(); };
  $("#btnNewPc").onclick = () => openPcLog(null);
  $("#btnPcXlsx").onclick = async ev => {
    const btn = ev.currentTarget;
    btn.disabled = true;
    try {
      await downloadXlsx(`공용PC_사용대장_${state.pcMonth || "전체"}.xlsx`, "사용대장",
        ["사용시작", "사용종료", "사용시간", "사용자", "사용용도"],
        [...list].reverse().map(r => [localDT(r.start_at).replace("T", " "), r.end_at ? localDT(r.end_at).replace("T", " ") : "사용 중",
          r.end_at ? pcDuration(r) : "", r.user_name, r.purpose]));
    } catch (err) { alert(`엑셀 파일을 만들지 못했습니다. (${err.message || err})`); }
    btn.disabled = false;
  };
  $("#page-pclog").querySelectorAll("[data-pcedit]").forEach(b => b.onclick = () =>
    openPcLog(state.data.pclog.find(r => r.id === Number(b.dataset.pcedit))));
  $("#page-pclog").querySelectorAll("[data-pcend]").forEach(b => b.onclick = async () => {
    b.disabled = true;
    try {
      await must(sb.from("hr_pc_log").update({ end_at: new Date().toISOString() }).eq("id", Number(b.dataset.pcend)));
      await load();
    } catch (err) { alert(err.message || err); b.disabled = false; }
  });
}
// SheetJS는 엑셀 다운로드를 누를 때만 불러온다.
let xlsxLib;
function loadXlsx() {
  return xlsxLib ||= new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => ok(window.XLSX);
    s.onerror = () => { xlsxLib = null; fail(new Error("엑셀 라이브러리를 불러오지 못했습니다")); };
    document.head.appendChild(s);
  });
}
async function downloadXlsx(filename, sheet, header, rows) {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = header.map((h, i) => ({ wch: Math.min(60, Math.max(h.length * 2, ...rows.map(r => String(r[i] ?? "").length * 1.6)) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, filename);
}

function openPcLog(r) {
  openForm({
    title: r ? "공용 PC 사용 기록 수정" : "공용 PC 사용 기록",
    data: r ? { ...r, start_at: localDT(r.start_at), end_at: r.end_at ? localDT(r.end_at) : "" }
      : { start_at: localDT(new Date()) },
    fields: [
      whoField("user_name", "사용자", r?.user_name),
      [{ name: "start_at", label: "사용시작 일시", type: "datetime-local", required: true },
       { name: "end_at", label: "사용종료 일시", type: "datetime-local", help: "사용 중이면 비워 두고, 끝나면 목록의 ‘사용 종료’를 누르세요." }],
      { name: "purpose", label: "사용용도", required: true, placeholder: "예: 사전협의 자료 다운로드, 배포 실행" },
    ],
    onSave: v => {
      // datetime-local 값은 시간대가 없으므로 이 PC 시간대 기준으로 변환해 저장한다
      const row = { user_name: v.user_name, purpose: v.purpose, start_at: new Date(v.start_at).toISOString(),
        end_at: v.end_at ? new Date(v.end_at).toISOString() : null };
      if (row.end_at && row.end_at < row.start_at) throw new Error("사용종료 일시가 사용시작보다 빠릅니다.");
      return r ? must(sb.from("hr_pc_log").update(row).eq("id", r.id)) : must(sb.from("hr_pc_log").insert(row));
    },
    onDelete: r && (() => must(sb.from("hr_pc_log").delete().eq("id", r.id))),
  });
}

/* ------------------------------------------------------------ leave (복무관리) */
function renderLeave() {
  const el = $("#page-leave");
  const tabs = `<div class="tabs">
    ${[["list", "근태 등록"], ["cal", "근무 현황"]].map(([k, t]) =>
      `<button data-tab="${k}" class="${state.leaveTab === k ? "active" : ""}">${t}</button>`).join("")}</div>`;
  const body = ({ list: leaveList, cal: leaveCalendar }[state.leaveTab] || leaveList)();
  el.innerHTML = tabs + body;
  el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.leaveTab = b.dataset.tab; renderLeave(); });
  bindLeave(el);
}

function leaveList() {
  const d = state.data, f = state.leaveFilter;
  const names = d.members.map(m => m.name);
  const cats = [...new Set(d.entries.map(e => e.category))];
  const months = [...new Set(d.entries.flatMap(e => [e.start.slice(0, 7), e.end.slice(0, 7)]))].sort();
  const list = d.entries.filter(e =>
    (!f.name || e.name === f.name) &&
    (!f.category || e.category === f.category) &&
    (!f.month || e.start.slice(0, 7) <= f.month && f.month <= e.end.slice(0, 7)) &&
    (f.period === "all" || entryStatus(e) === f.period)
  ).sort((a, b) => b.start.localeCompare(a.start) || b.id - a.id);
  const sum = list.reduce((s, e) => s + e.deduct, 0);
  const sel = (id, all, opts, cur, lbl = x => x) => `<select id="${id}"><option value="">${all}</option>${opts.map(o => `<option value="${esc(o)}" ${o === cur ? "selected" : ""}>${esc(lbl(o))}</option>`).join("")}</select>`;
  return `
    <div class="toolbar">
      ${sel("fName", "전체 팀원", names, f.name)}
      ${sel("fCat", "전체 유형", cats, f.category)}
      ${sel("fMonth", "전체 월", months, f.month, m => `${Number(m.slice(5))}월`)}
      <div class="seg">${["all", "예정", "진행중", "완료"].map(p => `<button data-period="${p}" class="${f.period === p ? "on" : ""}">${p === "all" ? "전체" : p}</button>`).join("")}</div>
      <span class="muted small" style="margin-left:auto">${list.length}건 · 연차 차감 합계 ${fmtDays(sum)}</span>
      <button class="btn-pri" id="btnNewLeave">+ 근태 등록</button>
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>상태</th><th>이름</th><th>유형</th><th>기간</th><th class="num">근무일</th><th class="num">연차 차감</th><th>구분(원문)</th><th>비고</th><th></th></tr></thead>
      <tbody>${list.map(e => `<tr>
        <td>${pill("s-" + entryStatus(e), entryStatus(e))}</td>
        <td><b>${esc(e.name)}</b>${webTag(e)}</td>
        <td>${pill("t-" + e.category, e.category)}${e.trip && e.category !== "출장" ? " " + pill("t-출장", "외부") : ""}</td>
        <td>${fmtPeriod(e)}</td>
        <td class="num">${e.workdays}일</td>
        <td class="num">${e.deduct ? fmtDays(e.deduct) : "-"}</td>
        <td class="small">${esc(e.label)}</td>
        <td class="small muted">${esc(e.note)}</td>
        <td>${e.web && canEdit(e) ? `<button class="btn-sm" data-ledit="${e.wid}">수정</button>` : ""}</td>
      </tr>`).join("") || `<tr><td colspan="9" class="empty">조건에 맞는 내역이 없습니다.</td></tr>`}</tbody>
    </table></div></div>`;
}

// inCard: 대시보드처럼 이미 카드 안에 넣을 때 바깥 카드를 생략한다.
function leaveCalendar(inCard = false) {
  const d = state.data;
  const [y, m] = state.calMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const cur = new Date(start); cur.setDate(start.getDate() + i);
    const s = iso(cur);
    if (i >= 35 && cur.getMonth() !== m - 1) break;
    const evs = d.entries.filter(e => e.start <= s && s <= e.end && !isOffDay(s));
    const cls = ["day", cur.getMonth() !== m - 1 && "out", cur.getDay() === 0 && "sun", cur.getDay() === 6 && "sat", d.holidays[s] && "hol", s === d.today && "today"].filter(Boolean).join(" ");
    cells += `<div class="${cls}"><div class="dn">${cur.getDate()}</div>
      ${d.holidays[s] ? `<div class="hn">${esc(d.holidays[s])}</div>` : ""}
      ${evs.map(e => `<div class="ev t-${esc(e.category)}" title="${esc(e.name + " · " + e.label)}">${esc(e.name)} ${esc(e.category === "시간단위" ? "시간" : e.category === "연차" ? "" : e.category)}</div>`).join("")}
    </div>`;
  }
  const grid = `<div class="cal">${DOW.map(x => `<div class="dow">${x}</div>`).join("")}${cells}</div>`;
  return `
    <div class="toolbar">
      ${inCard ? `<h2 style="font-size:16px;margin:0 8px 0 0">근무 현황</h2>` : ""}
      <button class="btn-sec" data-cal="-1">◀</button>
      <b style="font-size:16px;min-width:110px;text-align:center">${y}년 ${m}월</b>
      <button class="btn-sec" data-cal="1">▶</button>
      <button class="btn-sec" data-cal="0">이번 달</button>
      <div class="legend" style="margin-left:auto">
        ${["연차", "오전반차", "오후반차", "시간단위", "공가"].map(c => `<span class="t-${c}" style="--c:currentColor;background:none">${c}</span>`).join("")}
      </div>
    </div>
    ${inCard ? grid : `<div class="card" style="padding:0">${grid}</div>`}`;
}

function bindCalendar(el, rerender) {
  el.querySelectorAll("[data-cal]").forEach(b => b.onclick = () => {
    const n = Number(b.dataset.cal);
    if (!n) state.calMonth = state.data.today.slice(0, 7);
    else {
      const [y, m] = state.calMonth.split("-").map(Number);
      state.calMonth = iso(new Date(y, m - 1 + n, 1)).slice(0, 7);
    }
    rerender();
  });
}

function bindLeave(el) {
  const f = state.leaveFilter;
  const on = (id, key) => { const x = $("#" + id); if (x) x.onchange = () => { f[key] = x.value; renderLeave(); }; };
  on("fName", "name"); on("fCat", "category"); on("fMonth", "month");
  el.querySelectorAll("[data-period]").forEach(b => b.onclick = () => { f.period = b.dataset.period; renderLeave(); });
  bindCalendar(el, renderLeave);
  const nl = $("#btnNewLeave"); if (nl) nl.onclick = () => openLeave(null);
  el.querySelectorAll("[data-ledit]").forEach(b => b.onclick = () => openLeave(state.data.entries.find(e => e.wid === Number(b.dataset.ledit))));
}

const LEAVE_KINDS = ["연차", "오전반차", "오후반차", "시간단위휴가", "공가", "출장", "대외활동"];
function openLeave(e) {
  // '시간단위휴가(10:00~14:00)' → 구분 + 괄호 안 내용
  const m = (e?.kind || "").match(/^([^(]+?)\s*(?:\((.*)\))?$/) || [];
  const kind = LEAVE_KINDS.includes(m[1]) ? m[1] : (e ? "" : "연차");
  openForm({
    title: e ? "근태 수정" : "근태 등록",
    data: e ? { name: e.name, start: e.start, end: e.end, kind, detail: kind ? m[2] || "" : e.kind, note: e.note }
      : { start: state.data.today, end: state.data.today, kind },
    fields: [
      whoField("name", "이름", e?.name),
      [{ name: "start", label: "시작일", type: "date", required: true }, { name: "end", label: "종료일", type: "date", required: true }],
      [{ name: "kind", label: "구분", type: "select", options: kind || !e ? LEAVE_KINDS : ["", ...LEAVE_KINDS] },
       { name: "detail", label: "시간·사유 (괄호 안)", placeholder: "예: 10:00~14:00, 건강검진" }],
      { name: "note", label: "비고" },
    ],
    onSave: v => {
      if (v.end < v.start) throw new Error("종료일이 시작일보다 빠릅니다.");
      if (v.kind === "시간단위휴가" && !TIME_RE.test(v.detail)) throw new Error("시간단위휴가는 시간을 10:00~14:00 형식으로 입력하세요.");
      const row = { name: v.name, start_date: v.start, end_date: v.end, kind: v.kind ? v.kind + (v.detail ? `(${v.detail})` : "") : v.detail, note: v.note };
      if (!row.kind) throw new Error("구분을 선택하세요.");
      return e ? must(sb.from("hr_leave").update(row).eq("id", e.wid)) : must(sb.from("hr_leave").insert(row));
    },
    onDelete: e && (() => must(sb.from("hr_leave").delete().eq("id", e.wid))),
  });
}

/* ------------------------------------------------------------ 협의검토관리 */
// 진행현황 = newbiz_dashboard의 '협의건 일정표'와 같은 열·기준. 검토자·초안 작성·검토본·메모는 웹에서 덮어쓸 수 있다.
const REVIEW_EDIT = ["assignee", "draft", "draft_review", "memo"];
const REVIEW_OPEN = ["접수완료", "검토진행", "재협의대기", "재협의진행"];  // 접수완료 후 아직 끝나지 않은 단계
const RV_COLS = [
  ["no", "협의번호"], ["assignee", "검토자"], ["kind", "구분"], ["agency", "기관"], ["field", "분야"], ["name", "사업명"],
  ["state", "진행상태"], ["age", "경과일"], ["received", "접수"], ["accepted", "접수완료"], ["wait_days", "접수 처리기간"],
  ["draft", "초안 작성"], ["draft_review", "검토본"], ["reviewed", "검토완료"], ["result", "결과서 수령"], ["memo", "메모"],
];
const RV_NUM = new Set(["age", "wait_days"]);

function renderReviews() {
  const el = $("#page-reviews");
  // 대시보드 iframe은 한 번만 만들어 두고 탭 전환·새로고침 때 다시 불러오지 않는다
  if (!$("#rvEmbed", el)) {
    el.innerHTML = `<div class="tabs" id="rvTabs"></div><div id="rvBody"></div>
      <div class="card embed-card" id="rvEmbed" hidden>
        <div class="card-h">
          <h2>사전협의 검토현황</h2><span class="sub">newbiz_dashboard</span>
          <a class="right btn-sec" href="${REVIEW_DASHBOARD}" target="_blank" rel="noopener">새 창에서 열기 ↗</a>
        </div>
        <iframe class="embed" src="${REVIEW_DASHBOARD}" title="사전협의 검토현황 대시보드" loading="lazy"></iframe>
      </div>`;
  }
  $("#rvTabs").innerHTML = [["list", "진행현황"], ["dash", "대시보드"]].map(([k, t]) =>
    `<button data-tab="${k}" class="${state.rvTab === k ? "active" : ""}">${t}</button>`).join("");
  $("#rvTabs").querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.rvTab = b.dataset.tab; renderReviews(); });
  $("#rvEmbed").hidden = state.rvTab !== "dash";
  $("#rvBody").hidden = state.rvTab === "dash";
  if (state.rvTab !== "dash") renderReviewList();
}

// 경과일: 접수완료일부터 오늘까지(진행 중인 건만). 대시보드와 같이 30일 이상 주황, 60일 이상 빨강.
function rvAge(r) {
  return REVIEW_OPEN.includes(r.state) && r.accepted ? Math.round((parseIso(state.data.today) - parseIso(r.accepted)) / 864e5) : "";
}
function rvShortDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(2, 4)}.${s.slice(5, 7)}.${s.slice(8)}` : esc(s); }
function rvPill(s) {
  const cls = /원안동의|재협의완료/.test(s) ? "ok" : /권고/.test(s) ? "rec" : /반려/.test(s) ? "bad" : /대기/.test(s) ? "wait" : "warn";
  return `<span class="rvp ${cls}">${esc(s || "-")}</span>`;
}

function renderReviewList() {
  const { file, collected, rows } = state.data.reviews;
  const f = state.rvFilter;
  const el = $("#rvBody");
  if (!rows.length) {
    el.innerHTML = `<div class="card empty">협의건 일정표(config.json의 review_file: dash_cases_2026.csv)를 찾지 못했습니다.</div>`;
    return;
  }
  rows.forEach(r => (r.age = rvAge(r)));
  const q = f.q.trim().toLowerCase();
  // 구분·분야·검토자 거르개를 먼저 적용하고, 진행상태 칩의 건수는 그 결과로 센다(대시보드와 같은 기준)
  const base = rows.filter(r =>
    (!f.kind || r.kind === f.kind) && (!f.field || r.field === f.field) &&
    (!f.who || (f.who === "_none" ? !r.assignee : r.assignee === f.who)) &&
    (!q || [r.no, r.agency, r.name, r.memo].join("\n").toLowerCase().includes(q)));
  const stages = [...new Set(rows.map(r => r.state).filter(Boolean))].sort();
  const list = base.filter(r => !f.stage || (f.stage === "_open" ? REVIEW_OPEN.includes(r.state) : r.state === f.stage));
  const [sk, dir] = f.sort;
  list.sort((a, b) => {
    const x = a[sk], y = b[sk];
    const c = RV_NUM.has(sk) ? (x === "" ? -1e9 : +x) - (y === "" ? -1e9 : +y) : String(x).localeCompare(String(y), "ko");
    return c * dir || b.no.localeCompare(a.no);
  });
  const open = base.filter(r => REVIEW_OPEN.includes(r.state));
  const opts = (vals, cur) => vals.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
  const chip = (key, v, l) => `<button data-${key}="${esc(v)}" class="${f[key === "rk" ? "kind" : "stage"] === v ? "on" : ""}">${esc(l)}</button>`;
  const people = ownerOrder(new Set(rows.map(r => r.assignee).filter(Boolean)));
  const ovAttr = (r, k) => r.ov[k] ? ` class="ov" title="웹 입력 · ${esc(r.ovBy || "")} · ${esc((r.ovAt || "").slice(0, 10))}"` : "";
  const td = (r, k) => {
    if (k === "no") return `<td class="nowrap small">${esc(r.no)}</td>`;
    if (k === "assignee") return `<td class="nowrap"><span${ovAttr(r, k)}>${esc(r.assignee || "미배정")}</span></td>`;
    if (k === "kind" || k === "field") return `<td class="nowrap small">${esc(r[k])}</td>`;
    if (k === "agency") return `<td class="small">${esc(r.agency)}</td>`;
    if (k === "name") return `<td class="rv-name"><b>${esc(r.name)}</b>${r.type ? `<div class="pt-desc">${esc(r.type)}</div>` : ""}</td>`;
    if (k === "state") return `<td class="nowrap">${rvPill(r.state)}</td>`;
    if (k === "age") return `<td class="num nowrap ${r.age >= 60 ? "age-bad" : r.age >= 30 ? "age-warn" : ""}">${r.age === "" ? "" : r.age + "일"}</td>`;
    if (k === "wait_days") return `<td class="num nowrap small">${r.wait_days === "" ? "" : Math.round(+r.wait_days) + "일"}</td>`;
    if (k === "memo") return `<td class="small rv-memo"><span${ovAttr(r, k)}>${esc(r.memo)}</span>${r.memo && r.memo_date && !r.ov.memo ? `<small>${rvShortDate(r.memo_date)} 확인</small>` : ""}</td>`;
    const tip = k === "draft_review" && r.reviewer && !r.ov[k] ? ` title="검토본 담당: ${esc(r.reviewer)}"` : "";
    return `<td class="nowrap small"${tip}><span${ovAttr(r, k)}>${r[k] ? rvShortDate(r[k]) : ""}</span></td>`;
  };

  el.innerHTML = `
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="dot c-blue">⚖</div><div><div class="num">${base.length}</div><div class="lbl">협의건</div></div></div>
      <div class="card stat"><div class="dot c-violet">▶</div><div><div class="num">${open.length}</div><div class="lbl">진행 중 (접수완료 후 미완료)</div></div></div>
      <div class="card stat"><div class="dot c-amber">✎</div><div><div class="num">${open.filter(r => r.draft).length}/${open.length}</div><div class="lbl">진행 중 초안 작성</div></div></div>
      <div class="card stat"><div class="dot c-red">!</div><div><div class="num">${open.filter(r => r.age >= 30).length}</div><div class="lbl">경과 30일 이상 (60일 이상 ${open.filter(r => r.age >= 60).length})</div></div></div>
    </div>
    <div class="toolbar">
      <div class="seg">${chip("rk", "", "전체")}${chip("rk", "중앙부처", "중앙부처")}${chip("rk", "지자체", "지자체")}</div>
      <select id="rvField"><option value="">전체 분야</option>${opts([...new Set(rows.map(r => r.field).filter(Boolean))].sort().map(x => [x, x]), f.field)}</select>
      <select id="rvWho"><option value="">전체 검토자</option>${opts([...people.map(p => [p, p]), ["_none", "미배정"]], f.who)}</select>
      <input id="rvQ" placeholder="사업명·부처·메모로 찾기" value="${esc(f.q)}" style="margin-left:auto;min-width:220px">
    </div>
    <div class="toolbar">
      <div class="seg wrap">${chip("rs", "_open", `진행 중 ${open.length}`)}${chip("rs", "", `전체 ${base.length}`)}${stages.map(s => chip("rs", s, `${s} ${base.filter(r => r.state === s).length}`)).join("")}</div>
      <span class="muted small" style="margin-left:auto">${list.length}건</span>
    </div>
    <div class="card"><div class="table-wrap rv-wrap"><table class="rvtable">
      <thead><tr>${RV_COLS.map(([k, l]) => `<th><button class="th-sort" data-sort="${k}">${l}${sk === k ? (dir > 0 ? " ▲" : " ▼") : ""}</button></th>`).join("")}<th></th></tr></thead>
      <tbody>${list.map(r => `<tr>${RV_COLS.map(([k]) => td(r, k)).join("")}<td><button class="btn-sm" data-rv="${esc(r.no)}">입력</button></td></tr>`).join("")
        || `<tr><td colspan="${RV_COLS.length + 1}" class="empty">조건에 맞는 협의건이 없습니다.</td></tr>`}</tbody>
    </table></div>
    <p class="small muted" style="margin:12px 0 0">※ 원본: 사전협의 대시보드 수집분(${esc(file)}, ${esc(collected)}) — SIMS 사전협의목록과 원드라이브 ①~② 폴더 업로드일.
      접수 처리기간은 접수~접수완료, 경과일은 접수완료일부터 오늘까지(진행 중 건만, 30일↑ 주황·60일↑ 빨강).
      <span class="ov-key">파란 글씨</span>는 웹에서 입력한 값으로 수집값보다 우선합니다.</p></div>`;

  el.querySelectorAll("[data-rk]").forEach(b => b.onclick = () => { f.kind = b.dataset.rk; renderReviewList(); });
  el.querySelectorAll("[data-rs]").forEach(b => b.onclick = () => { f.stage = b.dataset.rs; renderReviewList(); });
  $("#rvField").onchange = ev => { f.field = ev.target.value; renderReviewList(); };
  $("#rvWho").onchange = ev => { f.who = ev.target.value; renderReviewList(); };
  el.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => {
    const k = b.dataset.sort;
    f.sort = [k, f.sort[0] === k ? -f.sort[1] : (RV_NUM.has(k) ? -1 : 1)];
    renderReviewList();
  });
  const rq = $("#rvQ");
  rq.oninput = () => {
    f.q = rq.value;
    const pos = rq.selectionStart;
    renderReviewList();
    const n = $("#rvQ"); n.focus(); n.setSelectionRange(pos, pos);
  };
  el.querySelectorAll("[data-rv]").forEach(b => b.onclick = () => openReview(rows.find(r => r.no === b.dataset.rv)));
}

function openReview(r) {
  const names = state.data.members.map(m => m.name);
  const was = k => ` · 수집값: ${r.xl[k] || "없음"}`;
  openForm({
    title: `${r.no} · ${r.name}`,
    data: { assignee: r.assignee, draft: r.draft, draft_review: r.draft_review, memo: r.memo },
    fields: [
      { name: "assignee", label: "검토자" + was("assignee"), type: "select",
        options: [["", "미배정"], ...[...new Set([...names, r.assignee, r.xl.assignee].filter(Boolean))].map(n => [n, n])] },
      [{ name: "draft", label: "초안 작성" + was("draft"), type: "date" }, { name: "draft_review", label: "검토본" + was("draft_review"), type: "date" }],
      { name: "memo", label: "메모", type: "textarea", rows: 3 },
    ],
    // 수집값과 같은 값은 저장하지 않아(null) 이후 수집값이 바뀌면 그대로 따라가게 한다
    onSave: v => {
      const row = { no: r.no, updated_by: state.user.email };
      REVIEW_EDIT.forEach(k => { row[k] = v[k] === (r.xl[k] || "") ? null : v[k]; });
      return must(sb.from("hr_review").upsert(row));
    },
    onDelete: Object.keys(r.ov).length ? (() => must(sb.from("hr_review").upsert(
      { no: r.no, updated_by: state.user.email, ...Object.fromEntries(REVIEW_EDIT.map(k => [k, null])) }))) : null,
    deleteLabel: "수집값으로 되돌리기",
  });
}

/* ------------------------------------------------------------ routing */
function route() {
  const [p, sub] = location.hash.replace("#", "").split("/");
  state.page = PAGES[p] ? p : "dashboard";
  if (state.page === "tasks" && ["week", "area", "person"].includes(sub)) state.taskTab = sub;
  if (state.page === "leave" && ["list", "cal"].includes(sub)) state.leaveTab = sub;
  if (state.page === "reviews" && ["list", "dash"].includes(sub)) state.rvTab = sub;
  $("#sidebar").classList.remove("open");
  render();
}
window.addEventListener("hashchange", route);
$("#btnReload").onclick = () => load(true);
$("#menuBtn").onclick = () => $("#sidebar").classList.toggle("open");
setInterval(() => { if (!document.hidden) load(); }, 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

route();
load();
