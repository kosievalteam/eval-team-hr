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
};

const PAGES = { dashboard: "대시보드", notices: "공지사항", tasks: "업무관리", leave: "휴가관리" };
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
const STATIC = !!window.HR_STATIC;  // GitHub Pages: 암호화된 data.enc를 브라우저에서 복호화
const PW_KEY = "hr-pw";

function b64bytes(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
async function decrypt(blob, password) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: b64bytes(blob.salt), iterations: blob.iter },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64bytes(blob.iv) }, key, b64bytes(blob.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}
function getSavedPw() {
  try { return sessionStorage.getItem(PW_KEY) || localStorage.getItem(PW_KEY); } catch { return null; }
}
function savePw(pw, remember) {
  try { sessionStorage.setItem(PW_KEY, pw); if (remember) localStorage.setItem(PW_KEY, pw); } catch { /* 저장 불가 환경 */ }
}
function clearPw() {
  try { sessionStorage.removeItem(PW_KEY); localStorage.removeItem(PW_KEY); } catch { /* noop */ }
}
function askPassword(message) {
  return new Promise(resolve => {
    let gate = $("#pwGate");
    if (!gate) {
      gate = document.createElement("div");
      gate.id = "pwGate";
      gate.innerHTML = `<form class="gate-box">
        <div class="brand-mark" style="margin:0 auto 12px">평</div>
        <h2>정책평가팀 HR</h2>
        <p class="muted small">팀 비밀번호를 입력하세요.</p>
        <input type="password" name="pw" autocomplete="current-password" required autofocus>
        <label class="chk small"><input type="checkbox" name="remember"> 이 기기에서 기억하기</label>
        <div class="gate-msg"></div>
        <button class="btn-pri">열기</button></form>`;
      document.body.appendChild(gate);
    }
    gate.hidden = false;
    $(".gate-msg", gate).textContent = message || "";
    const f = $("form", gate);
    f.pw.value = "";
    f.pw.focus();
    f.onsubmit = ev => {
      ev.preventDefault();
      gate.hidden = true;
      resolve({ pw: f.pw.value, remember: f.remember.checked });
    };
  });
}
async function fetchStatic() {
  const res = await fetch("data.enc?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("data.enc를 불러오지 못했습니다 (" + res.status + ")");
  const blob = await res.json();
  let pw = getSavedPw(), msg = "";
  for (;;) {
    if (!pw) {
      const a = await askPassword(msg);
      pw = a.pw;
      try {
        const data = await decrypt(blob, pw);
        savePw(pw, a.remember);
        return data;
      } catch { pw = null; msg = "비밀번호가 올바르지 않습니다."; continue; }
    }
    try { return await decrypt(blob, pw); } catch { clearPw(); pw = null; msg = "비밀번호가 변경되었습니다. 다시 입력하세요."; }
  }
}
// 웹 데이터는 배포 시점 스냅샷이므로 '오늘'과 사용/예정 연차를 보는 사람 기준으로 다시 계산한다.
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
    if (STATIC) state.data = rebaseToday(await fetchStatic());
    else state.data = await (await fetch("/api/data", { cache: "no-store" })).json();
    if (!state.dashDate || !manual && state.dashDate === state.prevToday) state.dashDate = state.data.today;
    state.prevToday = state.data.today;
    if (!state.calMonth) state.calMonth = state.data.today.slice(0, 7);
    render();
  } catch (err) {
    showErrors([STATIC ? `데이터를 불러오지 못했습니다. (${err})`
      : `서버에 연결할 수 없습니다. 'HR앱 실행.bat'으로 서버를 실행했는지 확인하세요. (${err})`]);
  } finally {
    btn.disabled = false; btn.textContent = STATIC ? "⟳ 새로고침" : "⟳ 엑셀 새로고침";
  }
}
function showErrors(list) {
  const box = $("#errorBox");
  box.hidden = !list.length;
  box.textContent = list.join("\n");
}

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
  ({ dashboard: renderDashboard, notices: renderNotices, tasks: renderTasks, leave: renderLeave })[state.page]();
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
  const members = [...d.members].sort((a, b) => (b.used + b.planned) - (a.used + a.planned));
  const maxUse = Math.max(1, ...members.map(m => m.total || (m.used + m.planned)));

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
    </div>

    <div class="card mt">
        <div class="card-h"><h2>팀원 연차 현황</h2><span class="sub">2026년 · 엑셀 기준</span>
          <div class="right legend"><span style="--c:var(--pri)">사용</span><span style="--c:#a9bffb">예정</span></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>이름</th><th style="width:40%">사용률</th><th class="num">사용</th><th class="num">예정</th><th class="num">잔여</th></tr></thead>
          <tbody>${members.map(m => {
            const base = m.total || maxUse;
            return `<tr>
              <td><b>${esc(m.name)}</b> <span class="muted small">${esc(m.position || "")}</span></td>
              <td><div class="bar"><i class="u" style="width:${(m.used / base) * 100}%"></i><i class="p" style="width:${(m.planned / base) * 100}%"></i></div></td>
              <td class="num">${fmtDays(m.used)}</td>
              <td class="num">${m.planned ? fmtDays(m.planned) : "-"}</td>
              <td class="num">${m.remaining == null ? `<span class="muted small">미설정</span>` : fmtDays(m.remaining)}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
    </div>`;

  const page = $("#page-dashboard");
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
      ${STATIC ? `<span class="small muted" style="margin-left:auto">공지 작성·수정은 관리자 PC의 HR앱에서 할 수 있습니다.</span>`
        : `<button class="btn-pri" style="margin-left:auto" id="btnNewNotice">+ 공지 작성</button>`}</div>
    <div class="card">
      ${list.length ? list.map(n => `
        <div class="notice-item">
          <div class="t">${n.important ? pill("imp", "중요") : ""}${esc(n.title)}
            ${STATIC ? "" : `<span class="acts"><button class="btn-sm" data-edit="${esc(n.id)}">수정</button><button class="btn-sm" data-del="${esc(n.id)}">삭제</button></span>`}</div>
          <div class="m">${esc(n.date)}${n.author ? " · " + esc(n.author) : ""}</div>
          ${n.body ? `<div class="b">${esc(n.body)}</div>` : ""}
        </div>`).join("") : `<div class="empty">등록된 공지가 없습니다.</div>`}
    </div>`;
  if (STATIC) return;
  $("#btnNewNotice").onclick = () => openNotice(null);
  $("#page-notices").querySelectorAll("[data-edit]").forEach(b => b.onclick = () => openNotice(state.data.notices.find(n => n.id === b.dataset.edit)));
  $("#page-notices").querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("이 공지를 삭제할까요?")) return;
    await fetch("/api/notices/" + encodeURIComponent(b.dataset.del), { method: "DELETE" });
    load();
  });
}
function openNotice(n) {
  const f = $("#noticeForm");
  f.reset();
  $("#noticeDlgTitle").textContent = n ? "공지 수정" : "공지 작성";
  f.id.value = n?.id || "";
  f.title.value = n?.title || "";
  f.body.value = n?.body || "";
  f.author.value = n?.author || "";
  f.date.value = n?.date || state.data.today;
  f.important.checked = !!n?.important;
  $("#noticeDialog").showModal();
}
$("#noticeDialog").addEventListener("close", async () => {
  if ($("#noticeDialog").returnValue !== "save") return;
  const f = $("#noticeForm");
  const body = { id: f.id.value || undefined, title: f.title.value, body: f.body.value, author: f.author.value, date: f.date.value, important: f.important.checked };
  const res = await fetch("/api/notices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) alert((await res.json()).error || "저장에 실패했습니다.");
  load();
});

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
            <h3>${esc(it.area)}</h3>
            ${it.reviewed ? pill("s-최종", "팀장 검토 ✓") : pill("s-완료", "검토 전")}
            <span class="who">${it.author ? `작성 ${esc(it.author)}${it.written ? " · " + esc(it.written) : ""}` : "미작성"}</span>
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
  const as = $("#areaSel"); if (as) as.onchange = () => { state.taskArea = as.value; renderTasks(); };
  const tq = $("#taskQ");
  tq.oninput = () => {
    state.taskQuery = tq.value;
    const pos = tq.selectionStart;
    renderTasks();
    const n = $("#taskQ"); n.focus(); n.setSelectionRange(pos, pos);
  };
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
        <td><div class="pt-name">${hl(t.name || "(업무명 없음)")}</div>${t.content ? `<div class="pt-desc">${hl(t.content)}</div>` : ""}</td>
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
  const tq = $("#taskQ");
  tq.oninput = () => {
    state.taskQuery = tq.value;
    const pos = tq.selectionStart;
    renderTasks();
    const n = $("#taskQ"); n.focus(); n.setSelectionRange(pos, pos);
  };
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
    </div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>상태</th><th>이름</th><th>유형</th><th>기간</th><th class="num">근무일</th><th class="num">연차 차감</th><th>구분(원문)</th><th>비고</th></tr></thead>
      <tbody>${list.map(e => `<tr>
        <td>${pill("s-" + entryStatus(e), entryStatus(e))}</td>
        <td><b>${esc(e.name)}</b></td>
        <td>${pill("t-" + e.category, e.category)}${e.trip && e.category !== "출장" ? " " + pill("t-출장", "외부") : ""}</td>
        <td>${fmtPeriod(e)}</td>
        <td class="num">${e.workdays}일</td>
        <td class="num">${e.deduct ? fmtDays(e.deduct) : "-"}</td>
        <td class="small">${esc(e.label)}</td>
        <td class="small muted">${esc(e.note)}</td>
      </tr>`).join("") || `<tr><td colspan="8" class="empty">조건에 맞는 내역이 없습니다.</td></tr>`}</tbody>
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

function leaveCalendar() {
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
  return `
    <div class="toolbar">
      <button class="btn-sec" data-cal="-1">◀</button>
      <b style="font-size:16px;min-width:110px;text-align:center">${y}년 ${m}월</b>
      <button class="btn-sec" data-cal="1">▶</button>
      <button class="btn-sec" data-cal="0">이번 달</button>
      <div class="legend" style="margin-left:auto">
        ${["연차", "오전반차", "오후반차", "시간단위", "공가"].map(c => `<span class="t-${c}" style="--c:currentColor;background:none">${c}</span>`).join("")}
      </div>
    </div>
    <div class="card" style="padding:0"><div class="cal">${DOW.map(x => `<div class="dow">${x}</div>`).join("")}${cells}</div></div>`;
}

function bindLeave(el) {
  const f = state.leaveFilter;
  const on = (id, key) => { const x = $("#" + id); if (x) x.onchange = () => { f[key] = x.value; renderLeave(); }; };
  on("fName", "name"); on("fCat", "category"); on("fMonth", "month");
  el.querySelectorAll("[data-period]").forEach(b => b.onclick = () => { f.period = b.dataset.period; renderLeave(); });
  el.querySelectorAll("[data-cal]").forEach(b => b.onclick = () => {
    const n = Number(b.dataset.cal);
    if (!n) state.calMonth = state.data.today.slice(0, 7);
    else {
      const [y, m] = state.calMonth.split("-").map(Number);
      state.calMonth = iso(new Date(y, m - 1 + n, 1)).slice(0, 7);
    }
    renderLeave();
  });
}

/* ------------------------------------------------------------ routing */
function route() {
  const [p, sub] = location.hash.replace("#", "").split("/");
  state.page = PAGES[p] ? p : "dashboard";
  if (state.page === "tasks" && ["week", "area", "person"].includes(sub)) state.taskTab = sub;
  if (state.page === "leave" && ["list", "status", "cal"].includes(sub)) state.leaveTab = sub;
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
