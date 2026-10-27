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
  rvFilter: { state: "_active", who: "", stage: "", q: "" },
};

const PAGES = { dashboard: "대시보드", notices: "공지사항", tasks: "주간업무관리", reviews: "협의검토관리", leave: "휴가관리" };
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
        <div class="brand-mark" style="margin:0 auto 12px">평</div>
        <h2>정책평가팀 HR</h2>
        <p class="muted small">${mode === "login" ? "사업정보 검색 시스템과 같은 @kosi.re.kr 계정으로 로그인하세요." : "처음 쓰는 경우 @kosi.re.kr 이메일로 가입하세요."}</p>
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
  const [notices, leave, weekly, tasks, review] = await Promise.all([
    must(sb.from("hr_notices").select("*")),
    must(sb.from("hr_leave").select("*")),
    must(sb.from("hr_weekly").select("*").order("id")),
    must(sb.from("hr_tasks").select("*").order("id")),
    must(sb.from("hr_review").select("*")),
  ]);
  return { notices, leave, weekly, tasks, review };
}

function merge(d, web) {
  const hpd = d.hours_per_day || 8;
  const names = new Set(d.members.map(m => m.name));
  d.notices = web.notices;

  web.leave.filter(r => names.has(r.name)).forEach(r => {
    const c = classify(r.kind, hpd);
    const dates = businessDays(r.start_date, r.end_date, d.holidays);
    d.entries.push({
      id: WEB_ID + r.id, wid: r.id, web: true, created_by: r.created_by, kind: r.kind,
      name: r.name, start: r.start_date, end: r.end_date, category: c.category, label: c.label, trip: c.trip,
      note: r.note, workdays: dates.length, deduct: Math.round(c.perDay * dates.length * 10000) / 10000, dates,
    });
  });

  const weekBySheet = Object.fromEntries(d.weeks.map(w => [w.sheet, w]));
  web.weekly.forEach(r => {
    const w = weekBySheet[r.sheet];
    if (w) w.items.push({ area: r.area, progress: r.progress, plan: r.plan, key: r.key, author: r.author,
      written: r.updated_at.slice(5, 10).replace("-", "/"), reviewed: false, web: true, wid: r.id, created_by: r.created_by });
  });

  const pBySheet = Object.fromEntries(d.personal.map(w => [w.sheet, w]));
  web.tasks.filter(r => names.has(r.owner)).forEach(r => {
    const w = pBySheet[r.sheet];
    if (w) w.tasks.push({ owner: r.owner, name: r.name, content: r.content, priority: r.priority, status: r.status,
      start: r.start_date || "", due: r.due || "", done: r.done || "", result: r.result, memo: r.memo,
      web: true, wid: r.id, created_by: r.created_by });
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
    fields.flat().forEach(f => {
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
  ({ dashboard: renderDashboard, notices: renderNotices, tasks: renderTasks, reviews: renderReviews, leave: renderLeave })[state.page]();
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
      <div class="card-h"><h2>최근 휴가 신청</h2><a class="right link" href="#leave">휴가관리 →</a></div>
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
  const list = [...state.data.notices].sort((a, b) => (b.important - a.important) || b.date.localeCompare(a.date));
  $("#page-notices").innerHTML = `
    <div class="toolbar"><span class="muted">총 ${list.length}건</span>
      <button class="btn-pri" style="margin-left:auto" id="btnNewNotice">+ 공지 작성</button></div>
    <div class="card">
      ${list.length ? list.map(n => `
        <div class="notice-item">
          <div class="t">${n.important ? pill("imp", "중요") : ""}${esc(n.title)}
            ${canEdit(n) ? `<span class="acts"><button class="btn-sm" data-edit="${esc(n.id)}">수정</button></span>` : ""}</div>
          <div class="m">${esc(n.date)}${n.author ? " · " + esc(n.author) : ""}</div>
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

function renderTasks() {
  const weeks = state.data.weeks;
  const el = $("#page-tasks");
  if (!weeks.length) { el.innerHTML = `<div class="card empty">주간업무계획 엑셀에서 시트를 찾지 못했습니다.</div>`; return; }
  state.weekIdx = Math.min(state.weekIdx, weeks.length - 1);
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

  let body = "";
  if (state.taskTab === "week") {
    const w = weeks[state.weekIdx];
    const items = w.items.filter(it => !q || [it.area, it.progress, it.plan, it.key, it.author].join("\n").toLowerCase().includes(q.toLowerCase()));
    const written = w.items.filter(it => it.author).length;
    const reviewed = w.items.filter(it => it.reviewed).length;
    body = `
      <div class="toolbar">
        <button class="btn-sec" data-wk="1" ${state.weekIdx >= weeks.length - 1 ? "disabled" : ""}>◀ 이전 주</button>
        <select id="weekSel">${weeks.map((x, i) => `<option value="${i}" ${i === state.weekIdx ? "selected" : ""}>${esc(x.title)}</option>`).join("")}</select>
        <button class="btn-sec" data-wk="-1" ${state.weekIdx === 0 ? "disabled" : ""}>다음 주 ▶</button>
        ${w.status ? pill("s-" + w.status, w.status) : ""}
        <input id="taskQ" placeholder="검색 (업무·키워드·작성자)" value="${esc(state.taskQuery)}" style="margin-left:auto;min-width:220px">
        <button class="btn-pri" id="btnNewWeekly">+ 업무 추가</button>
      </div>
      <div class="stats" style="margin-bottom:16px">
        <div class="card stat"><div class="dot c-blue">☰</div><div><div class="num">${w.items.length}</div><div class="lbl">업무영역</div></div></div>
        <div class="card stat"><div class="dot c-green">✎</div><div><div class="num">${written}/${w.items.length}</div><div class="lbl">작성 완료</div></div></div>
        <div class="card stat"><div class="dot c-violet">✓</div><div><div class="num">${reviewed}/${w.items.length}</div><div class="lbl">팀장 검토</div></div></div>
        <div class="card stat"><div class="dot c-amber">★</div><div><div class="num">${w.items.filter(i => i.key).length}</div><div class="lbl">핵심업무 지정</div></div></div>
      </div>
      ${items.length ? items.map(it => `
        <div class="card task-card">
          <div class="task-head">
            <h3>${esc(it.area)}</h3>${webTag(it)}
            ${it.reviewed ? pill("s-최종", "팀장 검토 ✓") : pill("s-완료", "검토 전")}
            <span class="who">${it.author ? `작성 ${esc(it.author)}${it.written ? " · " + esc(it.written) : ""}` : "미작성"}</span>
            ${it.web && canEdit(it) ? `<button class="btn-sm" data-wedit="${it.wid}">수정</button>` : ""}
          </div>
          <div class="task-cols">
            <div class="task-col"><h4>${esc(w.progress_label)}</h4><div class="txt">${formatTask(it.progress, q)}</div></div>
            <div class="task-col"><h4>${esc(w.plan_label)}</h4><div class="txt">${formatTask(it.plan, q)}</div></div>
          </div>
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

function openWeekly(w, it) {
  openForm({
    title: `${it ? "업무 수정" : "업무 추가"} · ${w.title}`,
    data: it || { author: state.user.name },
    fields: [
      { name: "area", label: "업무영역", required: true, list: [...new Set(w.items.map(i => i.area))] },
      { name: "progress", label: w.progress_label, type: "textarea", rows: 5, help: "줄 앞에 - 또는 ○를 쓰면 항목, *는 세부항목으로 표시됩니다." },
      { name: "plan", label: w.plan_label, type: "textarea", rows: 5 },
      { name: "key", label: "핵심 업무 계획 (선택)", type: "textarea", rows: 2 },
      whoField("author", "작성자", it?.author),
    ],
    onSave: v => it ? must(sb.from("hr_weekly").update(v).eq("id", it.wid))
      : must(sb.from("hr_weekly").insert({ ...v, sheet: w.sheet })),
    onDelete: it && (() => must(sb.from("hr_weekly").delete().eq("id", it.wid))),
  });
}

/* ------------------------------------------------------------ 개인별 업무 (주간업무보고) */
const P_STATUS = ["진행 중", "시작 전", "완료", "중단"];
const P_STATUS_CLS = { "진행 중": "ps-run", "시작 전": "ps-wait", "완료": "ps-done", "중단": "ps-stop" };

function pWeeks() { return state.data.personal.filter(w => w.tasks.length); }
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
  if (!weeks.length) return `<div class="card empty">주간업무보고 엑셀(config.json의 personal_file)에서 업무를 찾지 못했습니다.</div>`;
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
        <td><div class="pt-name">${hl(t.name || "(업무명 없음)")}${webTag(t)}${t.web && canEdit(t) ? ` <button class="btn-sm" data-tedit="${t.wid}">수정</button>` : ""}</div>${t.content ? `<div class="pt-desc">${hl(t.content)}</div>` : ""}</td>
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
      <input id="taskQ" placeholder="검색 (업무명·내용·결과)" value="${esc(state.taskQuery)}" style="margin-left:auto;min-width:220px">
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
    <p class="small muted">※ 원본: [내부용]정책평가팀 주간업무보고.xlsx · 시트 내 업무가 없는 양식 시트는 목록에서 제외됩니다.</p>`;
}

function bindPersonal(el) {
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

/* ------------------------------------------------------------ leave (휴가관리) */
function renderLeave() {
  const el = $("#page-leave");
  const tabs = `<div class="tabs">
    ${[["list", "휴가 사용 내역"], ["status", "연차 상세 현황"], ["cal", "휴가 달력"]].map(([k, t]) =>
      `<button data-tab="${k}" class="${state.leaveTab === k ? "active" : ""}">${t}</button>`).join("")}</div>`;
  const body = { list: leaveList, status: leaveStatus, cal: leaveCalendar }[state.leaveTab]();
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
      <button class="btn-pri" id="btnNewLeave">+ 휴가 등록</button>
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

function leaveStatus() {
  const d = state.data;
  const counts = name => {
    const c = {};
    d.entries.filter(e => e.name === name).forEach(e => (c[e.category] = (c[e.category] || 0) + 1));
    return c;
  };
  const unset = d.members.filter(m => m.total == null).length;
  return `
    ${unset ? `<div class="holiday-banner" style="margin:0 0 16px">총 연차일수가 설정되지 않은 팀원이 ${unset}명 있습니다. <b>config.json</b>의 <code>total</code>(부여 연차)과 <code>prior_used</code>(엑셀 기록 이전 사용분)를 입력하면 잔여 연차가 계산됩니다.</div>` : ""}
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>이름</th><th>직위</th><th class="num">부여</th><th class="num">사용</th><th class="num">예정</th><th class="num">잔여</th><th>사용률</th><th>유형별 건수</th></tr></thead>
      <tbody>${d.members.map(m => {
        const c = counts(m.name);
        const pct = m.total ? Math.round(((m.used + m.planned) / m.total) * 100) : null;
        return `<tr>
          <td><b>${esc(m.name)}</b></td><td class="muted">${esc(m.position || "-")}</td>
          <td class="num">${m.total == null ? `<span class="muted small">미설정</span>` : fmtDays(m.total)}</td>
          <td class="num">${fmtDays(m.used)}</td>
          <td class="num">${m.planned ? fmtDays(m.planned) : "-"}</td>
          <td class="num">${m.remaining == null ? "-" : `<b style="color:${m.remaining < 0 ? "var(--red)" : "inherit"}">${fmtDays(m.remaining)}</b>`}</td>
          <td style="min-width:120px">${pct == null ? `<span class="muted small">-</span>` : `<div class="bar"><i class="u" style="width:${Math.min(100, pct)}%"></i></div><span class="small muted">${pct}%</span>`}</td>
          <td>${Object.entries(c).map(([k, v]) => pill("t-" + k, `${k} ${v}`)).join(" ") || `<span class="muted small">없음</span>`}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
    <p class="small muted" style="margin:12px 0 0">※ 연차 1일, 반차 0.5일, 시간단위휴가는 ${state.data.hours_per_day}시간=1일로 환산하며 주말·공휴일은 제외합니다. 공가·대외활동은 차감하지 않습니다.</p></div>`;
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
      ${inCard ? `<h2 style="font-size:16px;margin:0 8px 0 0">휴가 달력</h2>` : ""}
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
    title: e ? "휴가 수정" : "휴가 등록",
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
const REVIEW_EDIT = ["assignee", "draft", "draft_review", "sent", "memo"];
const REVIEW_ACTIVE = ["접수완료", "검토진행", "재협의진행"];

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

function rvDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) ? fmtDate(s, false) : esc(s); }
function rvStage(r) {
  if (r.sent) return "송부";
  if (r.draft_review) return "초안검토";
  if (r.draft) return "초안작성";
  return "";
}

function renderReviewList() {
  const { file, rows } = state.data.reviews;
  const f = state.rvFilter;
  const el = $("#rvBody");
  if (!rows.length) {
    el.innerHTML = `<div class="card empty">사전협의 접수·검토 현황 엑셀(config.json의 review_file)을 찾지 못했습니다.</div>`;
    return;
  }
  const q = f.q.trim().toLowerCase();
  const states = [...new Set(rows.map(r => r.state).filter(Boolean))];
  const people = ownerOrder(new Set(rows.map(r => r.assignee).filter(Boolean)));
  const list = rows.filter(r =>
    (!f.state || (f.state === "_active" ? REVIEW_ACTIVE.includes(r.state) : r.state === f.state)) &&
    (!f.who || r.assignee === f.who) &&
    (!f.stage || (f.stage === "none" ? !rvStage(r) : rvStage(r) === f.stage)) &&
    (!q || [r.no, r.agency, r.biz1, r.biz2, r.biz3, r.memo].join("\n").toLowerCase().includes(q)));
  const active = rows.filter(r => REVIEW_ACTIVE.includes(r.state));
  const cell = (r, k) => `<td class="small nowrap ${r.ov[k] ? "ov" : ""}" ${r.ov[k] ? `title="웹 입력 · ${esc(r.ovBy || "")} · ${esc((r.ovAt || "").slice(0, 10))}"` : ""}>${r[k] ? rvDate(r[k]) : "-"}</td>`;
  const sel = (id, all, opts, cur) => `<select id="${id}"><option value="">${all}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;

  el.innerHTML = `
    <div class="stats" style="margin-bottom:16px">
      <div class="card stat"><div class="dot c-blue">⚖</div><div><div class="num">${rows.length}</div><div class="lbl">전체 협의</div></div></div>
      <div class="card stat"><div class="dot c-violet">▶</div><div><div class="num">${active.length}</div><div class="lbl">검토 중 (접수완료·검토진행)</div></div></div>
      <div class="card stat"><div class="dot c-amber">✎</div><div><div class="num">${active.filter(r => r.draft).length}/${active.length}</div><div class="lbl">검토 중 초안작성</div></div></div>
      <div class="card stat"><div class="dot c-green">✓</div><div><div class="num">${active.filter(r => r.draft_review).length}/${active.length}</div><div class="lbl">검토 중 초안검토</div></div></div>
    </div>
    <div class="toolbar">
      ${sel("rvState", "전체 진행상태", [["_active", "검토 중 전체"], ...states.map(s => [s, `${s} (${rows.filter(r => r.state === s).length})`])], f.state)}
      ${sel("rvWho", "전체 담당자", people.map(p => [p, `${p} (${rows.filter(r => r.assignee === p).length})`]), f.who)}
      <div class="seg">${[["", "전체"], ["none", "초안 전"], ["초안작성", "초안작성"], ["초안검토", "초안검토"], ["송부", "송부"]].map(([v, l]) =>
        `<button data-stage="${v}" class="${f.stage === v ? "on" : ""}">${l}</button>`).join("")}</div>
      <input id="rvQ" placeholder="검색 (협의번호·기관·사업명·메모)" value="${esc(f.q)}" style="margin-left:auto;min-width:220px">
    </div>
    <div class="card"><div class="table-wrap"><table class="rvtable">
      <thead><tr><th>협의번호</th><th>기관</th><th style="width:30%">사업명</th><th>진행상태</th><th>담당</th>
        <th>접수</th><th>검토완료</th><th>초안작성</th><th>초안검토</th><th>중기청송부</th><th>메모</th><th></th></tr></thead>
      <tbody>${list.map(r => `<tr>
        <td class="nowrap small">${esc(r.no)}</td>
        <td class="small"><span class="muted">${esc(r.kind)}</span><br>${esc(r.agency)}</td>
        <td><div class="pt-name">${esc(r.biz3 || r.biz2 || r.biz1)}</div>
          <div class="pt-desc">${esc([[r.biz3 && r.biz2, r.biz2 && r.biz1].filter(Boolean).reverse().join(" › "), r.type, r.field].filter(Boolean).join(" · "))}</div></td>
        <td class="nowrap">${pill("rv-" + (r.state || "").replace(/\(.*$/, ""), r.state || "-")}</td>
        <td class="nowrap ${r.ov.assignee ? "ov" : ""}">${esc(r.assignee || "-")}</td>
        ${cell(r, "received")}${cell(r, "reviewed")}${cell(r, "draft")}${cell(r, "draft_review")}${cell(r, "sent")}
        <td class="small ${r.ov.memo ? "ov" : ""}">${esc(r.memo)}</td>
        <td><button class="btn-sm" data-rv="${esc(r.no)}">입력</button></td>
      </tr>`).join("") || `<tr><td colspan="12" class="empty">조건에 맞는 협의가 없습니다.</td></tr>`}</tbody>
    </table></div>
    <p class="small muted" style="margin:12px 0 0">※ 원본: ${esc(file)} · <span class="ov-key">파란 글씨</span>는 웹에서 입력한 값으로, 엑셀 값보다 우선합니다. ${list.length}건 표시</p></div>`;

  const on = (id, key) => { $("#" + id).onchange = ev => { f[key] = ev.target.value; renderReviewList(); }; };
  on("rvState", "state"); on("rvWho", "who");
  el.querySelectorAll("[data-stage]").forEach(b => b.onclick = () => { f.stage = b.dataset.stage; renderReviewList(); });
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
  const dateVal = s => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "");
  const names = state.data.members.map(m => m.name);
  const xl = k => r.xl[k] ? ` · 엑셀: ${r.xl[k]}` : " · 엑셀: 비어 있음";
  openForm({
    title: `${r.no} · ${r.biz3 || r.biz2 || r.biz1}`,
    data: { assignee: r.assignee, draft: dateVal(r.draft), draft_review: dateVal(r.draft_review), sent: dateVal(r.sent), memo: r.memo },
    fields: [
      { name: "assignee", label: "검토담당자" + xl("assignee"), type: "select",
        options: [["", "-"], ...[...new Set([...names, r.assignee].filter(Boolean))].map(n => [n, n])] },
      [{ name: "draft", label: "초안작성", type: "date" }, { name: "draft_review", label: "초안검토", type: "date" }],
      { name: "sent", label: "중기청송부", type: "date" },
      { name: "memo", label: "메모", type: "textarea", rows: 3 },
    ],
    // 엑셀과 같은 값은 저장하지 않아(null) 이후 엑셀이 바뀌면 그대로 따라가게 한다
    onSave: v => {
      const row = { no: r.no, updated_by: state.user.email };
      REVIEW_EDIT.forEach(k => {
        // 날짜로 해석되지 않는 엑셀 원문(예: '확인중')은 날짜칸이 비어 보이므로 비워 둔 채 저장해도 바꾸지 않은 것으로 본다
        const xv = k === "assignee" || k === "memo" ? r.xl[k] || "" : dateVal(r.xl[k] || "");
        row[k] = v[k] === xv ? null : v[k];
      });
      return must(sb.from("hr_review").upsert(row));
    },
    onDelete: Object.keys(r.ov).length ? (() => must(sb.from("hr_review").upsert(
      { no: r.no, updated_by: state.user.email, ...Object.fromEntries(REVIEW_EDIT.map(k => [k, null])) }))) : null,
    deleteLabel: "엑셀 값으로 되돌리기",
  });
}

/* ------------------------------------------------------------ routing */
function route() {
  const [p, sub] = location.hash.replace("#", "").split("/");
  state.page = PAGES[p] ? p : "dashboard";
  if (state.page === "tasks" && ["week", "area", "person"].includes(sub)) state.taskTab = sub;
  if (state.page === "leave" && ["list", "status", "cal"].includes(sub)) state.leaveTab = sub;
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
