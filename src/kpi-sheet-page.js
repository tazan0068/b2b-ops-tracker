/* ============================================================
   통합 KPI 첫 화면 — 구글시트(B2B_통합데이터 v8 이후) 탭을 그대로 읽어 보여준다
   · 데이터: window.B2BSheet (내장 "저장된 데이터" / 구글시트 실시간)
   · 모든 KPI 카드는 클릭 → 드릴다운(근거 목록): 해당 탭·필터 규칙 · 검색 · 정렬 · 연도 · 엑셀(CSV) · 카드 ↔ 목록 합계 대조
   · window.B2BKPI = { page(), after() } — 트래커 라우터(PAGES id "kpi")에 연결 (v15 와 동일 지점)
   · 트래커의 업무 기록(localStorage netform.b2b.tracker.v1)은 읽지도 쓰지도 않는다
   ============================================================ */
(function () {
  var S = window.B2BSheet;
  var V = { view: "dash", year: "2026", q: "", page: {}, per: 50, awardYear: "all", awardTrade: "all", ledgerYear: "all", ledgerKind: "all", ledgerMain: "all", vendor: null, inactFilter: "all", actYear: "2026", linkMsg: null, ledgerState: "idle", detail: null, draft: null, integrity: null, integrityBadOnly: false };
  var repaintRef = null; var ledgerRows = null; var OC = {};
  var MAIN_UNVERIFIED = { "2022": 1, "2023": 1 };
  var INTERNAL = /테스트|포어솔루션|넷폼/;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function won(n) { if (n == null || n === "" || isNaN(n)) return null; var a = Math.abs(n), s = n < 0 ? "−" : ""; if (a >= 1e8) return s + (a / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: a >= 1e10 ? 0 : 1 }) + "억"; if (a >= 1e4) return s + Math.round(a / 1e4).toLocaleString("ko-KR") + "만"; return s + a.toLocaleString("ko-KR") + "원"; }
  function wonF(n) { return isNum(n) ? n.toLocaleString("ko-KR") : null; }
  function num(n) { return n == null || n === "" || isNaN(n) ? null : Number(n).toLocaleString("ko-KR"); }
  function pc(v) { return v == null || v === "" || isNaN(v) ? null : (Number(v) * 100).toFixed(2) + "%"; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function sum(rows, k) { return rows.reduce(function (s, r) { return s + (isNum(r[k]) ? r[k] : 0); }, 0); }
  function hhmm(d) { if (!d) return ""; var x = new Date(d); return isNaN(x) ? String(d) : x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0") + " " + String(x.getHours()).padStart(2, "0") + ":" + String(x.getMinutes()).padStart(2, "0"); }
  function T(name) { return S.tab(name) || null; }
  function toObjs(t) { return t.rows.map(function (r) { var o = {}; t.header.forEach(function (h, i) { o[h] = r[i]; }); return o; }); }
  function objs(name) { if (OC[name]) return OC[name]; var t = T(name); return (OC[name] = t ? toObjs(t) : []); }
  function has(name) { return !!T(name); }
  /* 공개 보기(기본): 로그인 없이 서버가 집계해 둔 공개용 집계값만 쓴다. 시공사·현장·거래 명세 화면은 상세 보기(로그인)에서만 */
  function isPub() { return S.state.mode === "public"; }
  function pubWanted() { return S.viewMode() === "public"; }
  function kpiRow(y) { return objs("1.통합KPI").filter(function (r) { return String(r["연도"]) === String(y); })[0] || null; }
  function kpiVal(y, c) { var k = kpiRow(y); return k ? k[c] : null; }
  function years() { return objs("1.통합KPI").map(function (r) { return String(r["연도"]); }); }
  function leading(label) { return objs("18.선행지표요약").filter(function (x) { return String(x["지표"]).indexOf(label) === 0; })[0] || null; }
  function match(o, q, keys) { if (!q) return true; var s = q.toLowerCase(); return keys.some(function (k) { var v = o[k]; return v != null && String(v).toLowerCase().indexOf(s) >= 0; }); }
  function pageOf(id) { return V.page[id] || 0; }
  function group(rows, keyFn, init, acc) { var m = {}, order = []; rows.forEach(function (r) { var k = keyFn(r); if (!(k in m)) { m[k] = init(r); order.push(k); } acc(m[k], r); }); return order.map(function (k) { return m[k]; }); }
  function vlink(name, id) { if (!name) return '<span class="mini">—</span>'; return '<a class="vlink" data-kact="vendor" data-id="' + esc(id || "") + '" data-name="' + esc(name) + '">' + esc(name) + "</a>"; }

  /* ---------- 공통 조각 ---------- */
  function tile(l, v, s, cls, detailId) { var na = v == null || typeof v === "string" && !/[0-9]/.test(v); return '<div class="tile ' + (cls || "") + '"' + (detailId ? ' data-kact="detail" data-id="' + detailId + '" tabindex="0" role="button"' : "") + '><div class="l">' + esc(l) + '</div><div class="v' + (na ? " na" : "") + '">' + (v == null ? "확인 불가" : esc(v)) + '</div>' + (s ? '<div class="s">' + s + "</div>" : "") + "</div>"; }
  function val(v, f) { if (v == null || v === "") return null; if (typeof v === "string" && !isNum(Number(v))) return v; return f ? f(v) : v; }
  function sortRows(rows, sort) { if (!sort || !sort.k) return rows; var k = sort.k, d = sort.dir === "desc" ? -1 : 1; return rows.slice().sort(function (a, b) { var x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; if (isNum(x) && isNum(y)) return (x - y) * d; return String(x).localeCompare(String(y), "ko") * d; }); }
  function table(id, cols, rows, opt) {
    opt = opt || {}; var per = opt.per || V.per; var p = pageOf(id); var n = rows.length; var pages = Math.max(1, Math.ceil(n / per)); if (p >= pages) p = pages - 1; V.page[id] = p;
    var slice = rows.slice(p * per, p * per + per);
    var h = '<div class="tblwrap"><table><thead><tr>' + cols.map(function (c) { var sortable = opt.sort && !c.raw; var on = sortable && opt.sort.k === c.k; return '<th class="' + (c.r ? "r" : "") + '"' + (sortable ? ' data-kact="sort" data-k="' + esc(c.k) + '"' : "") + ">" + esc(c.l || c.k) + (on ? '<span class="arr">' + (opt.sort.dir === "desc" ? "▼" : "▲") + "</span>" : "") + "</th>"; }).join("") + "</tr></thead><tbody>";
    if (!slice.length) h += '<tr><td colspan="' + cols.length + '" class="mini" style="white-space:normal;padding:14px 12px;line-height:1.6">' + esc(opt.empty || "조건에 해당하는 행이 없습니다") + "</td></tr>";
    slice.forEach(function (o) { h += "<tr" + (opt.rowAct ? ' data-kact="' + opt.rowAct + '" data-id="' + esc(o[opt.rowKey]) + '"' : "") + ">" + cols.map(function (c) { var v = c.f ? c.f(o) : o[c.k]; var txt = v == null || v === "" ? '<span class="mini">—</span>' : (c.raw ? v : esc(c.fmt ? (c.fmt(v) == null ? v : c.fmt(v)) : v)); return '<td class="' + (c.r ? "r num" : "") + (c.wrap ? " wrap" : "") + '">' + txt + "</td>"; }).join("") + "</tr>"; });
    if (opt.totals && n) h += '<tr class="tfoot">' + cols.map(function (c, i) { if (i === 0) return "<td>합계 (" + num(n) + "행)</td>"; var t = opt.totals[c.k]; return '<td class="' + (c.r ? "r num" : "") + '">' + (t == null ? "" : esc(c.fmt ? (c.fmt(t) == null ? t : c.fmt(t)) : t)) + "</td>"; }).join("") + "</tr>";
    h += "</tbody></table></div>";
    if (n > per) h += '<div class="pg"><span>' + (p * per + 1) + "–" + Math.min(n, p * per + per) + " / " + num(n) + '</span><button data-kact="pg" data-id="' + id + '" data-d="-1"' + (p === 0 ? " disabled" : "") + '>이전</button><button data-kact="pg" data-id="' + id + '" data-d="1"' + (p >= pages - 1 ? " disabled" : "") + ">다음</button></div>";
    return h;
  }
  function csv(cols, rows, name) { var lines = [cols.map(function (c) { return c.l || c.k; }).join(",")]; rows.forEach(function (o) { lines.push(cols.map(function (c) { var v = c.csv ? c.csv(o) : (c.f && !c.raw ? c.f(o) : o[c.k]); v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")); }); var blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }); var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + ".csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function needLedger() { if (ledgerRows) return true; if (V.ledgerState !== "loading") { V.ledgerState = "loading"; S.ledger(function () { if (repaintRef) repaintRef(true); }).then(function (t) { ledgerRows = toObjs(t); V.ledgerSrc = t; V.ledgerState = "ready"; if (repaintRef) repaintRef(true); }).catch(function (e) { V.ledgerState = "error"; V.ledgerErr = e.message || String(e); if (repaintRef) repaintRef(true); }); } return false; }
  function ledgerOf(y) { return (ledgerRows || []).filter(function (r) { return y === "all" || String(r["연도"]) === y; }); }
  function loadingBox() { var p = S.state.ledgerProgress; return '<div class="loading">원문 읽는 중… ' + (p ? num(p.loaded) + " / " + num(p.total) : "") + (V.ledgerState === "error" ? '<div class="ks-warn">원문 읽기 실패: ' + esc(V.ledgerErr) + "</div>" : "") + "</div>"; }

  /* ---------- 상태 바 ---------- */
  function hms(ts) { if (!ts) return "—"; var d = new Date(ts); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0"); }
  function ivText(ms) { return ms >= 60000 ? Math.round(ms / 60000) + "분" : Math.round(ms / 1000) + "초"; }
  function schemaWarn(sy) {
    var i = sy.issues || { missingTabs: [], badTabs: [] }; if (!i.missingTabs.length && !i.badTabs.length) return "";
    return '<div class="ks-warn"><b>시트 구조 경고:</b> ' + (i.missingTabs.length ? "누락된 탭 " + i.missingTabs.length + "개(" + esc(i.missingTabs.join(", ")) + ")" : "") + (i.missingTabs.length && i.badTabs.length ? " · " : "") + (i.badTabs.length ? "열 구조가 바뀐 탭 " + i.badTabs.length + "개(" + i.badTabs.map(function (b) { return esc(b.tab) + " — 누락 열: " + esc(b.missing.join(", ")); }).join(" / ") + ")" : "") + ". 해당 탭에 의존하는 카드·목록은 값을 <b>0으로 대체하지 않고</b> '표시하지 않음/확인 불가'로 둡니다. 시트 구조를 복원하거나 대시보드를 갱신해야 합니다.</div>";
  }
  function progText() { var sy = S.state.sync; if (sy.status !== "syncing") return ""; var el = sy.startedAt ? Math.round((Date.now() - sy.startedAt) / 1000) : 0; var p = sy.progress; return (p ? p.label + " " + num(p.done) + " / " + num(p.total) + " · " : "연결 중… · ") + "경과 " + el + "초"; }
  function progHtml() { var sy = S.state.sync, p = sy.progress; var pct = p && p.total ? Math.min(100, Math.round(p.done / p.total * 100)) : 0; return '<span class="ks-prog">' + esc(progText()) + '</span><span class="ks-pbar"><i style="width:' + pct + '%"></i></span>'; }
  function syncProblem(sy, live) {
    var btns = '<div class="ks-tools" style="margin:8px 0 0"><button class="btn" data-kact="refresh">다시 시도</button><button class="btn ghost" data-kact="diag">연결 진단</button></div>';
    if (sy.status === "syncing" && sy.startedAt && Date.now() - sy.startedAt > 30000) return '<div class="ks-warn"><b>응답이 평소보다 느립니다.</b> <span class="ks-prog">' + esc(progText()) + '</span> — 계속 기다리거나 [취소] 후 다시 시도하세요. 3분이 지나면 자동으로 중단하고 오류를 표시합니다.<div class="ks-tools" style="margin:8px 0 0"><button class="btn" data-kact="cancelsync">취소</button><button class="btn ghost" data-kact="diag">연결 진단</button></div></div>';
    if (sy.status === "error" && !live) return '<div class="ks-warn"><b>동기화가 끝나지 않았거나 실패했습니다.</b> ' + esc((sy.lastError && sy.lastError.message) || sy.message || "") + (sy.lastError ? ' <span class="mini">[' + esc(sy.lastError.code) + " · " + hms(sy.lastError.at) + "]</span>" : "") + btns + "</div>";
    return "";
  }
  function logText() {
    var out = ["연결 진단 " + new Date().toISOString(), ""]; var d = V.diag;
    if (d) { d.steps.forEach(function (x) { out.push((x.ok === true ? "OK  " : x.ok === false ? "FAIL" : "... ") + " " + x.name + " · " + x.ms + "ms · " + x.detail); }); out.push("합계 " + (d.totalMs || 0) + "ms", ""); }
    out.push("요청 로그(최근 " + S.getLog().length + "건: 이름 · 상태 · 시간 · 크기 · 시도)");
    S.getLog().slice(-60).forEach(function (r) { out.push(new Date(r.t).toISOString().slice(11, 19) + " " + r.label + " · " + r.status + " · " + r.ms + "ms · " + r.kb + "KB · #" + r.attempt); });
    var le = S.state.sync.lastError; if (le) out.push("", "마지막 오류: [" + le.code + "] " + le.message);
    return out.join("\n");
  }
  function diagCard() {
    var d = V.diag, h = '<div class="card"><div class="card-h"><h2>연결 진단</h2><span class="mini">단계별 응답 상태·시간만 기록합니다(시트 내용·토큰·시트 ID 미포함)</span></div><div class="ks-tools" style="margin:0 0 8px"><button class="btn" data-kact="diag"' + (V.diagRunning ? " disabled" : "") + ">" + (V.diagRunning ? "진단 중…" : "연결 진단 실행") + '</button><button class="btn ghost" data-kact="copylog">결과·요청 로그 복사</button></div>';
    if (d && d.steps.length) { h += '<div class="kv">' + d.steps.map(function (x) { return "<span>" + esc(x.name) + "</span><span>" + (x.ok === true ? "✓ " : x.ok === false ? "✗ " : "… ") + (x.ok === null ? "진행 중" : x.ms + "ms") + (x.detail ? " · " + esc(x.detail) : "") + "</span>"; }).join("") + "</div>"; if (!V.diagRunning) h += '<p class="card-sub">' + (d.ok ? "모든 단계 정상 · 총 " + d.totalMs + "ms" : "실패한 단계가 있습니다. 위 ✗ 항목의 오류 코드와 안내를 확인하세요.") + "</p>"; }
    else h += '<p class="card-sub">로그인·시트 정보·탭 읽기·판매 원문 첫 구간을 순서대로 확인해 어디서 막히는지 보여 줍니다. 읽기 전용이며 시트를 수정하지 않습니다.</p>';
    return h + "</div>";
  }
  function pubStatusBar() {
    var st = S.state, sy = st.sync, p = st.pub || {}, pub = p.data, meta = (pub && pub.meta) || {}, serve = p.serve || {}, cls, label;
    if (isPub() && sy.stale) { cls = "fallback"; label = !p.error && serve.state && serve.state !== "ok" ? "공개 집계 · 새 집계 게시 보류 (이전 정상 집계)" : "공개 집계 · 이전 데이터 (갱신 확인 실패)"; }
    else if (isPub()) { cls = "live"; label = "공개 집계 · 자동 갱신 · 마지막 확인 " + hms(p.checkedAt); }
    else if (sy.status === "syncing" || st.loading) { cls = "embedded"; label = "공개 집계 불러오는 중"; }
    else if (st.mode === "fallback" && !S.noData()) { cls = "fallback"; label = "공개 집계를 불러오지 못함 · 저장된 검증본 표시 중"; }
    else { cls = "fallback"; label = "공개 집계를 불러오지 못함"; }
    var sub = isPub() ? "기준일 " + esc(meta.asOf || "") + " · 서버 집계 " + esc(hhmm(meta.generatedAt)) + " · 시트 변경 감지 " + esc(hhmm(meta.sourceModified)) + " · 다음 확인 " + hms(sy.nextAt) + " (" + ivText(sy.interval) + "마다 자동)" : (sy.status === "syncing" ? progHtml() : esc(sy.message || ""));
    var h = '<div class="ks-bar"><span class="ks-src ' + cls + '"><span class="dot"></span>' + esc(label) + '</span><span class="mini">' + sub + '</span><span class="sp"></span><button class="btn ghost" data-kact="refresh"' + (st.loading ? " disabled" : "") + ">" + (st.loading ? "확인 중…" : "지금 확인") + '</button><button class="btn ghost" data-kact="view" data-id="link">상세 보기(로그인)</button>' + (isPub() ? '<button class="btn ghost" data-kact="integrity">검증 정보</button>' : "") + "</div>";
    if (V.view !== "dash") h += '<div class="ks-note"><b>공개 보기</b> — 로그인 없이 누구나 볼 수 있는 <b>집계값</b>입니다. 시공사·현장·거래 명세와 판매 원문은 포함하지 않으며(비공개), 시트를 공유받은 직원은 [상세 보기(로그인)]에서 기존처럼 근거 목록을 열람합니다. 2022~2025년은 확정 실적 · 2026년은 기준일까지 누계 · 시트가 바뀌면 서버가 자동으로 다시 집계합니다.</div>';
    if (isPub() && sy.stale) h += '<div class="ks-warn stale"><b>이전 데이터입니다.</b> ' + esc(sy.message) + (p.checkedAt ? " 마지막 정상 확인: " + hhmm(p.checkedAt) : "") + '<div class="ks-tools" style="margin:8px 0 0"><button class="btn" data-kact="refresh">다시 시도</button></div></div>';
    return h;
  }
  function pubWaiting() {
    var st = S.state, sy = st.sync, busy = st.loading || sy.status === "syncing"; var code = sy.lastError && sy.lastError.code;
    var title = busy ? "공개 집계를 불러오는 중입니다" : code === "PUBCONF" ? "공개 데이터 주소가 설정되지 않았습니다" : "공개 집계를 불러오지 못했습니다";
    var body = busy ? "서버가 자동 집계해 둔 공개용 집계값을 가져옵니다. 잠시만 기다려 주세요." : code === "PUBCONF" ? "관리자가 공개 집계 서버(Apps Script) 주소를 설정해야 이 화면에 숫자가 표시됩니다. 임의의 수치는 표시하지 않습니다." : (sy.message || "원인을 확인하지 못했습니다") + " — 임의의 수치는 표시하지 않습니다.";
    var h = '<div class="card core6"><div class="card-h"><h2>팀장 핵심 지표 6</h2><span class="badge rev">' + (busy ? "불러오는 중" : "연결 대기") + '</span></div><div class="tiles six">' + ["① 전체 자재 순매출", "② POUR 낙찰", "③ POUR 반영 공고", "④ 메인 자재 순매출", "⑤ 공식 L2→L3 전환율", "⑥ 장기 무활동 협력사"].map(function (l) { return '<div class="tile"><div class="l">' + esc(l) + '</div><div class="v na">' + (busy ? "불러오는 중" : "확인 불가") + '</div></div>'; }).join("") + "</div></div>";
    return h + '<div class="card"><div class="card-h"><h2>' + esc(title) + '</h2></div><p class="card-sub">' + esc(body) + '</p><div class="ks-tools" style="margin:0"><button class="btn" data-kact="refresh">다시 시도</button><button class="btn ghost" data-kact="view" data-id="link">상세 보기(로그인)</button></div></div>';
  }
  function pubVerifyModal() {
    var p = S.state.pub || {}, pub = p.data; if (!pub) return ""; var m = pub.meta || {}, g = pub.growth || {}, rec = g.reconcile || [], okn = rec.filter(function (r) { return r["결과"] === "일치"; }).length, bad = rec.filter(function (r) { return r["결과"] === "불일치"; }), na = rec.filter(function (r) { return r["결과"] === "대조 대상 아님"; }).length;
    var kv = [["출처", m.source], ["공개 범위", m.scope], ["기준일", m.asOf], ["서버 집계 시각", hhmm(m.generatedAt)], ["시트 변경 감지", hhmm(m.sourceModified)], ["읽은 탭 수", m.tabsRead], ["판매 원문 행 수(집계에만 사용, 공개 안 함)", num(m.ledgerRows)], ["기존 KPI 대조", "일치 " + okn + " · 불일치 " + bad.length + " · 대조 대상 아님 " + na], ["집계 버전", (m.calc || "") + " · " + pub.schema], ["내용 해시", m.hash], ["서버 상태", (p.serve && p.serve.state) || "—"], ["서버 메시지", (p.serve && p.serve.message) || "없음"]];
    return '<div class="ks-modal" data-kact="iclose-bg"><div class="box"><div class="hd"><h2>공개 집계 검증 정보</h2><button class="x" data-kact="iclose">닫기 ✕</button></div><div class="bd"><div class="kv">' + kv.map(function (x) { return "<span>" + esc(x[0]) + "</span><span>" + esc(x[1] == null ? "—" : x[1]) + "</span>"; }).join("") + '</div><p class="card-sub">서버는 게시 전에 ① 25개 탭·열 구조 ② 기존 KPI와의 대조 ③ 판매 원문 행 수 급감 ④ 업체·현장명 포함 여부를 검사하고, 하나라도 실패하면 새 값을 게시하지 않고 이전 정상 집계를 유지합니다.</p></div></div></div>';
  }
  function reviewPubCard() {
    var Lr = leading("검토 대상"); return '<div class="card"><div class="card-h"><h2>L2→L3 검토 ' + (Lr ? esc(Lr["값"]) + "건" : "—") + ' — 공식 계산 제외 · 별도 관리</h2><span class="badge rev">목록 비공개</span></div><p class="card-sub">검토 대상의 시공사·현장 목록과 증빙은 공개 보기에 포함하지 않습니다. 건수는 위 선행지표와 같은 집계값입니다. 시트를 공유받은 직원은 [상세 보기(로그인)]에서 목록을 확인합니다.</p></div>';
  }
  function restrictedModal() {
    return '<div class="ks-modal" data-kact="dclose-bg"><div class="box" role="dialog" aria-modal="true"><div class="hd"><h2>상세 근거는 비공개입니다</h2><button class="x" data-kact="dclose">닫기 ✕</button></div><div class="bd"><p class="card-sub">이 카드의 근거 목록에는 시공사·현장·거래 명세가 들어 있어 공개 보기에서는 제공하지 않습니다. 카드의 숫자와 연도별 추이는 화면의 집계값 그대로입니다. 시트를 공유받은 직원은 <b>상세 보기(로그인)</b>에서 기존처럼 근거 목록을 열람할 수 있습니다.</p><div class="ks-tools" style="margin:0"><button class="btn" data-kact="view" data-id="link">상세 보기(로그인)로 이동</button><button class="btn ghost" data-kact="dclose">닫기</button></div></div></div></div>';
  }
  function modeCard() {
    var pubm = pubWanted(); var configured = S.configured(S.settings());
    return '<div class="card"><div class="card-h"><h2>보기 방식</h2><span class="badge' + (pubm ? "" : " rev") + '">현재: ' + (pubm ? "공개 보기" : "상세 보기(로그인)") + '</span></div><p class="card-sub"><b>공개 보기(기본)</b> — 로그인·시트 연결 없이 어떤 컴퓨터·브라우저·계정에서도 같은 집계값이 보입니다. 서버가 구글시트를 자동으로 읽어 집계·검증한 값만 제공하며 시공사·현장·거래 명세는 없습니다.<br><b>상세 보기(로그인)</b> — 시트를 공유받은 직원이 Google 로그인으로 시트를 직접 읽어 근거 목록·시공사 상세까지 봅니다(기존 방식 그대로, 조회한 데이터는 메모리에만 두고 이 브라우저에 저장하지 않습니다).</p><div class="ks-tools" style="margin:0"><button class="btn' + (pubm ? "" : " ghost") + '" data-kact="vmode" data-id="public">공개 보기</button><button class="btn' + (pubm ? " ghost" : "") + '" data-kact="vmode" data-id="detail">상세 보기(로그인)' + (configured ? "" : " — 연결 설정 필요") + "</button></div></div>";
  }
  function statusBar() {
    if (pubWanted()) return pubStatusBar();
    var st = S.state, sy = st.sync, m = st.meta || {}, em = st.embeddedMeta || {};
    var nd = S.noData(), live = st.mode === "live", signedBefore = !!(S.settings() || {}).signedBefore;
    var cls, label;
    if (live && sy.stale) { cls = "fallback"; label = "이전 데이터 · 마지막 정상 동기화 " + hms(sy.lastOkAt); }
    else if (live) { cls = "live"; label = "구글시트 실시간 · 마지막 정상 동기화 " + hms(sy.lastOkAt); }
    else if (sy.status === "syncing") { cls = "embedded"; label = "구글시트 동기화 중"; }
    else if (sy.status === "denied") { cls = "fallback"; label = "접근 권한 없음 · 데이터 숨김"; }
    else if (sy.status === "signedout") { cls = "fallback"; label = "로그아웃됨 · 데이터 숨김"; }
    else if (st.needSignIn) { cls = "fallback"; label = "Google 로그인 필요"; }
    else if (st.mode === "fallback") { cls = "fallback"; label = nd ? "연결 실패 · 데이터 없음" : "저장된 데이터 (연결 실패)"; }
    else if (nd) { cls = "none"; label = "연결 대기 · 데이터 없음"; }
    else { cls = "embedded"; label = "저장된 데이터"; }
    var sub;
    if (live) sub = "시트 " + esc(m.title || "") + (m.auth === "google" && st.email ? " · " + esc(st.email) : "") + " · " + (sy.status === "syncing" ? progHtml() : (sy.changed === false ? "변경 없음 · " : sy.changed ? "방금 갱신됨 · " : "") + "다음 확인 " + hms(sy.nextAt) + " (" + ivText(sy.interval) + "마다 자동)");
    else if (nd) sub = "이 파일에는 회사 데이터가 들어 있지 않습니다. 구글시트에 연결하면 실제 데이터가 표시됩니다.";
    else sub = "마지막 검증본 " + esc(em.version || "") + " · 기준일 " + esc(em.asOf || "") + " · " + esc(em.verified || "");
    if (sy.status === "syncing" && !live) sub = progHtml();
    var needBtn = st.needSignIn || sy.status === "auth";
    var h = '<div class="ks-bar"><span class="ks-src ' + cls + '"><span class="dot"></span>' + esc(label) + '</span><span class="mini">' + sub + '</span><span class="sp"></span>' +
      (needBtn ? '<button class="btn" data-kact="gsignin">' + (signedBefore ? "로그인 상태 재확인" : "Google 로그인으로 연결") + "</button>" : "") +
      '<button class="btn ghost" data-kact="refresh"' + (st.loading ? " disabled" : "") + ">" + (st.loading ? "동기화 중…" : "지금 동기화") + '</button>' + (st.loading ? '<button class="btn ghost" data-kact="cancelsync">취소</button>' : "") + '<button class="btn ghost" data-kact="view" data-id="link">연결 설정</button><button class="btn ghost" data-kact="vmode" data-id="public">공개 보기</button><button class="btn ghost" data-kact="integrity">정합성 점검</button>' +
      ((st.signedIn || (live && m.auth === "google")) ? '<button class="btn ghost" data-kact="gsignout">로그아웃</button>' : "") + "</div>";
    if (V.view !== "dash") h += '<div class="ks-note">2022~2025년은 확정 과거 실적(변경은 승인 정정만) · 2026년은 지속 갱신(기준일 ' + esc(em.asOf || "2026-10-20") + ') · 공식 L2→L3 전환율은 검증된 확정 건만, 검토 건은 별도 표시 · <b>모든 지표 카드를 클릭하면 근거 목록이 열립니다</b></div>';
    if (live && sy.stale) h += '<div class="ks-warn stale"><b>이전 데이터입니다.</b> ' + esc(sy.message) + " 마지막 정상 동기화: " + hhmm(sy.lastOkAt) + '<div class="ks-tools" style="margin:8px 0 0"><button class="btn" data-kact="refresh">다시 시도</button><button class="btn ghost" data-kact="diag">연결 진단</button></div></div>';
    else if (st.needSignIn && !live) h += '<div class="ks-warn" style="color:#92400E;background:#FFF4E5;border-color:#F5D9A8"><b>' + (signedBefore ? "로그인 상태를 재확인해야 합니다." : "Google 로그인이 필요합니다.") + "</b> " + (signedBefore ? "[로그인 상태 재확인]을 한 번 누르면 이어서 자동으로 불러옵니다(팝업을 허용해 두면 다음부터는 열 때 자동 재확인). " : "시트를 공유받은 직원 계정으로 로그인하면 실제 데이터가 표시됩니다. ") + esc(sy.message || "") + "</div>";
    else if ((sy.status === "denied" || sy.status === "signedout") && !live) h += '<div class="ks-warn"><b>' + (sy.status === "denied" ? "접근이 거부되었습니다." : "로그아웃되었습니다.") + "</b> " + esc(sy.message) + "</div>";
    if (st.mode === "fallback" && !sy.stale) h += '<div class="ks-warn"><b>구글시트 연결 실패:</b> ' + esc(st.error) + (nd ? " — 표시할 데이터가 없어 '연결 대기' 상태입니다. [연결 설정]에서 설정을 확인하세요." : " — 아래 수치는 마지막 검증본(저장된 데이터)입니다. [연결 설정]에서 설정을 확인하세요.") + "</div>";
    h += syncProblem(sy, live);
    h += schemaWarn(sy);
    if (sy.consistency && sy.consistency.length) h += '<div class="ks-warn"><b>원본 버전 불일치:</b> KPI 탭의 전체자재순매출과 판매 원문 합계가 다릅니다(' + sy.consistency.map(function (c) { return esc(c.year + "년 KPI " + num(c.kpi) + " ≠ 원문 " + num(c.ledger)); }).join(" / ") + "). 시트가 갱신 중일 수 있어 " + (sy.stale ? "새 값을 적용하지 않았습니다." : "확인이 필요합니다.") + "</div>";
    if (st.mode === "live" && st.frozenDiff.length) h += '<div class="ks-warn"><b>확정 연도(2022~2025) 값이 시트와 다릅니다 (' + st.frozenDiff.length + "건):</b> " + st.frozenDiff.slice(0, 6).map(function (d) { return esc(d.year + " " + d.col + " 검증본 " + d.embedded + " → 시트 " + d.live); }).join(" / ") + (st.frozenDiff.length > 6 ? " …" : "") + " — 시트 값을 표시하되, 승인 정정 없이 바뀐 것이면 확인이 필요합니다.</div>";
    return h;
  }
  function syncInfoCard() {
    var st = S.state, sy = st.sync, m = st.meta || {}, live = st.mode === "live"; var iss = sy.issues || { missingTabs: [], badTabs: [] };
    var stName = { idle: "연결 설정 없음", syncing: "동기화 중", ok: "정상", stale: "이전 데이터(연결 실패/갱신 중)", auth: "로그인 재확인 필요", denied: "접근 권한 없음", signedout: "로그아웃", error: "오류" }[sy.status] || sy.status;
    var h = '<div class="card"><div class="card-h"><h2>동기화 상태</h2><span class="badge' + (sy.status === "ok" ? "" : " rev") + '">' + esc(stName) + "</span></div><div class=\"kv\"><span>마지막 정상 동기화</span><span>" + (sy.lastOkAt ? hhmm(sy.lastOkAt) + " (" + hms(sy.lastOkAt) + ")" : "없음") + "</span><span>마지막 시도</span><span>" + (sy.lastAttemptAt ? hhmm(sy.lastAttemptAt) + " (" + hms(sy.lastAttemptAt) + ")" : "—") + "</span><span>다음 자동 확인</span><span>" + (sy.nextAt ? hms(sy.nextAt) + " · " + ivText(sy.interval) + "마다, 화면이 보일 때" : "—") + "</span><span>최근 확인 결과</span><span>" + (sy.changed === true ? "변경 있음 → 전체 갱신 완료" : sy.changed === false ? "변경 없음" : "—") + "</span><span>로그인 계정</span><span>" + (st.email ? esc(st.email) : "—") + "</span><span>메시지</span><span>" + esc(sy.message || "—") + "</span></div>";
    var exp = S.expectedTabs(); h += '<div class="card-h" style="margin-top:14px"><h2>탭 구조 점검 (' + exp.length + "개 탭)</h2></div>";
    var badMap = {}; iss.badTabs.forEach(function (b) { badMap[b.tab] = b; });
    h += table("schema", [{ k: "탭" }, { k: "행수", l: "행 수", r: 1, fmt: num }, { k: "상태", raw: 1, f: function (o) { return '<span class="st ' + (o.상태 === "정상" ? "ok" : o.상태 === "원문(필요 시 조회)" ? "" : "bad") + '">' + esc(o.상태) + "</span>"; }, csv: function (o) { return o.상태; } }, { k: "비고", wrap: 1 }], exp.map(function (n) { var inMeta = live && m.tabs && m.tabs[n]; var t = live ? (st.tabs && st.tabs[n]) : null; return { 탭: n, 행수: live ? (n === S.LEDGER ? (sy.ledgerCount != null ? sy.ledgerCount : null) : (t ? t.rows.length : null)) : null, 상태: !live ? "—" : n === S.LEDGER ? (iss.missingTabs.indexOf(n) >= 0 ? "누락" : badMap[n] ? "구조 변경" : "원문(필요 시 조회)") : iss.missingTabs.indexOf(n) >= 0 ? "누락" : badMap[n] ? "구조 변경" : inMeta ? "정상" : "—", 비고: badMap[n] ? "누락 열: " + badMap[n].missing.join(", ") : iss.missingTabs.indexOf(n) >= 0 ? "시트에 탭이 없습니다 — 0으로 표시하지 않음" : "" }; }), { per: 30 });
    return h + "</div>" + diagCard();
  }

  /* 대시보드·데이터 화면은 dashboard-ui.js(window.B2BDashUI)가 그린다 — 이 파일은 데이터 읽기 도구(API)만 넘긴다 */
  function dash() { var U = window.B2BDashUI; return U ? U.render(API) : '<div class="card"><div class="ks-warn">대시보드 모듈을 불러오지 못했습니다.</div></div>'; }
  function dataView() { var U = window.B2BDashUI; return U ? U.renderData(API) : '<div class="card"><div class="ks-warn">데이터 화면 모듈을 불러오지 못했습니다.</div></div>'; }
  function nav() { var items = pubWanted() ? [["dash", "대시보드"], ["growth", "성장 분석"], ["ops", "시공사 추적"], ["data", "데이터"], ["link", "상세 보기(로그인)"]] : [["dash", "대시보드"], ["growth", "성장 분석"], ["ops", "시공사 추적"], ["data", "데이터"], ["home", "요약(근거 목록)"], ["sales", "매출·원문"], ["awards", "낙찰"], ["vendors", "시공사"], ["activity", "영업활동"], ["leading", "선행지표"], ["link", "연결 설정"]]; return '<div class="ks-nav">' + items.map(function (x) { return '<button data-kact="view" data-id="' + x[0] + '"' + (V.view === x[0] ? ' aria-current="true"' : "") + ">" + x[1] + "</button>"; }).join("") + "</div>"; }
  function yearChips(cur, act) { return '<div class="ks-chips">' + years().map(function (y) { return '<button data-kact="' + act + '" data-id="' + y + '"' + (cur === y ? ' aria-current="true"' : "") + ">" + y + (y === "2026" ? " (~10/20)" : "") + "</button>"; }).join("") + "</div>"; }

  /* ---------- 팀장 핵심 지표 6 (최신 연도 · 전년 동일기간 대비, 1.통합KPI 탭 값만 사용) ---------- */
  function deltaTxt(cur, prev, label) { if (!isNum(cur) || !isNum(prev)) return "전년 비교 불가"; if (!prev) return "전년 동일기간 0"; var r = (cur - prev) / Math.abs(prev); return (r >= 0 ? "▲ +" : "▼ −") + Math.abs(r * 100).toFixed(1) + "% · " + (label || "전년 동일기간") + " " + (won(prev) || num(prev)); }
  function core6() {
    var ys = years(); var y = ys[ys.length - 1], py = String(+y - 1); var k = kpiRow(y) || {}, p = kpiRow(py) || {};
    var L = leading("[공식] L2→L3 전환율"), Lc = leading("[공식] L3 전환 확정"), Lr = leading("검토 대상"), L2 = leading("L2 건수"), In = leading("장기 무활동"), Ic = leading("핵심 협력사 중"), Nv = leading("활동 이력 없음");
    var h = '<div class="card core6"><div class="card-h"><h2>팀장 핵심 지표 6</h2><span class="badge">' + esc(y) + "년 " + esc(k["기준"] || "") + " · " + esc(k["데이터구분"] || "") + '</span><span class="mini">전년 비교는 1.통합KPI 탭의 동일기간(1/1~10/20) 값 · 카드 클릭 = 근거 목록</span></div><div class="tiles six">';
    h += tile("① 전체 자재 순매출", val(k["전체자재순매출"], won), (y === ys[ys.length - 1] ? "1/1~" + esc(String(k["기준"] || "").replace(/^~/, "")) + " 누계 · " : "") + deltaTxt(k["동일기간_전체매출"], p["동일기간_전체매출"]), "hero", "salesTotal");
    h += tile("② POUR 낙찰", isNum(k["POUR낙찰_건수"]) ? num(k["POUR낙찰_건수"]) + "건" : val(k["POUR낙찰_건수"]), "건수 " + deltaTxt(k["동일기간_낙찰"], p["동일기간_낙찰"]).replace(/ · .*$/, function () { return " (전년 동일기간 " + num(p["동일기간_낙찰"]) + "건)"; }) + " · 낙찰금액 " + (won(k["POUR낙찰금액_VAT미확인"]) || "확인 불가") + " (VAT 미확인)", "hero", "awards");
    h += tile("③ POUR 반영 공고", isNum(k["POUR반영공고_건수"]) ? num(k["POUR반영공고_건수"]) + "건" : val(k["POUR반영공고_건수"]), "전체 공고 " + (num(k["전체공고_건수"]) || esc(k["전체공고_건수"])) + "건 중 POUR 반영 " + (pc(k["POUR반영비중"]) || esc(k["POUR반영비중"])) + " · 전년 연간 " + (num(p["POUR반영공고_건수"]) || "—") + "건(올해는 10/20까지라 단순 비교 불가)", "", "notices");
    h += tile("④ 메인 자재 순매출", MAIN_UNVERIFIED[y] ? "미확인" : val(k["메인자재순매출"], won), (MAIN_UNVERIFIED[y] ? "품목명 검증 전" : "비중 " + (pc(k["메인비중"]) || "—") + " · 구매 거래처 " + (num(k["메인구매거래처수"]) || "—") + "곳 · " + deltaTxt(k["동일기간_메인매출"], p["동일기간_메인매출"])), "", "mainSales");
    h += tile("⑤ 공식 L2→L3 전환율", L ? pc(L["값"]) : null, (Lc ? "확정 " + esc(Lc["값"]) : "") + (L2 ? " / 유효 L2 " + esc(L2["값"]) : "") + (Lr ? " · 검토 " + esc(Lr["값"]) + "건 별도(공식 제외)" : ""), "", "l2l3Rate");
    h += tile("⑥ 장기 무활동 협력사", In ? esc(In["값"]) + "곳" : null, (Ic ? "핵심 협력사 중 " + esc(Ic["값"]) + "곳" : "") + (Nv ? " · 활동 이력 없음 " + esc(Nv["값"]) + "곳" : "") + " · 기준일 2026-10-20", "", "inactive");
    return h + "</div></div>";
  }
  function integrityModal() {
    if (!V.integrity) return ""; if (V.integrity.pub) return pubVerifyModal(); var r = V.integrity; if (!Object.keys(r).length) return '<div class="ks-modal" data-kact="iclose-bg"><div class="box"><div class="hd"><h2>데이터 정합성 점검</h2><button class="x" data-kact="iclose">닫기 ✕</button></div><div class="bd">' + loadingBox() + '<div class="src">원문 원장을 먼저 읽은 뒤 11개 카드를 대조합니다.</div></div></div></div>'; var rows = []; var ok = 0, bad = 0, na = 0, missing = 0, ref = 0;
    Object.keys(r).forEach(function (id) { Object.keys(r[id]).forEach(function (k) { var x = r[id][k]; if (x.missing) { missing++; rows.push({ 카드: DETAILS[id].title, 보기: k, 행수: "", 결과: "탭 없음", 내용: x.missing }); return; } if (x.loading) { rows.push({ 카드: DETAILS[id].title, 보기: k, 행수: "", 결과: "원문 미적재", 내용: "원문을 먼저 불러온 뒤 다시 실행" }); return; } if (x.error) { bad++; rows.push({ 카드: DETAILS[id].title, 보기: k, 행수: "", 결과: "오류", 내용: x.error }); return; } if (!x.checks.length) { ref++; rows.push({ 카드: DETAILS[id].title, 보기: k, 행수: x.rows, 결과: "참고 보기", 내용: "대조 항목 없는 참고 목록(연도별 표·전체 목록 등)" }); return; } x.checks.forEach(function (c) { var cls = c.slice(0, c.indexOf(" ")); if (cls === "ok") ok++; else if (cls === "bad") bad++; else na++; rows.push({ 카드: DETAILS[id].title, 보기: k, 행수: x.rows, 결과: cls === "ok" ? "일치" : cls === "bad" ? "불일치" : "대조 대상 아님", 내용: c.slice(c.indexOf(" ") + 1) }); }); }); });
    var sum2 = "일치 " + ok + " · 불일치 " + bad + " · 대조 대상 아님(카드 값 없음) " + na + " · 참고 보기 " + ref + (missing ? " · 탭 없음 " + missing : "");
    var h = '<div class="ks-modal" data-kact="iclose-bg"><div class="box"><div class="hd"><h2>데이터 정합성 점검 — 카드 ↔ 근거 목록</h2><span class="chk ' + (bad ? "bad" : "ok") + '" style="margin:0">' + esc(sum2) + '</span><button class="x" data-kact="iclose">닫기 ✕</button></div><div class="bd"><div class="src">현재 표시 중인 데이터(' + (S.state.mode === "live" ? "구글시트 실시간" : "저장된 데이터") + ')로 11개 카드 × 연도 × 하위 보기의 건수·합계를 1.통합KPI·18.선행지표요약 값과 대조한 결과입니다. 시트 원천이 바뀌었는데 KPI 탭이 재계산되지 않으면 여기서 불일치로 드러납니다.</div>';
    var fr = V.integrityBadOnly ? rows.filter(function (x) { return x.결과 !== "일치"; }) : rows;
    h += '<div class="ks-chips"><button data-kact="ibad"' + (V.integrityBadOnly ? ' aria-current="true"' : "") + '>불일치·미대조만</button><button class="btn ghost" data-kact="icsv">엑셀(CSV) 다운로드</button></div>';
    h += table("integrity", [{ k: "카드" }, { k: "보기" }, { k: "행수", r: 1, fmt: num }, { k: "결과", raw: 1, f: function (o) { return '<span class="st ' + (o.결과 === "일치" ? "ok" : o.결과 === "불일치" || o.결과 === "오류" ? "bad" : "na") + '">' + esc(o.결과) + "</span>"; }, csv: function (o) { return o.결과; } }, { k: "내용", wrap: 1 }], fr, { per: 60 });
    V.integrityRows = rows; return h + "</div></div></div>";
  }

  /* ---------- 요약 (모든 카드 클릭형) ---------- */
  function home() {
    var y = V.year, k = kpiRow(y) || {}; var unv = MAIN_UNVERIFIED[y];
    var L = leading("[공식] L2→L3 전환율"), Lc = leading("[공식] L3 전환 확정"), Lr = leading("검토 대상"), Ld = leading("[공식] 평균 전환 소요일"), L2 = leading("L2 건수"), In = leading("장기 무활동"), Ic = leading("핵심 협력사 중"), Na = leading("신규 협력사 활성화율");
    var h = chartsCard() + core6() + '<div class="card"><div class="card-h"><h2>연도별 핵심 지표</h2><span class="badge">' + esc(k["데이터구분"] || "") + "</span><span class=\"mini\">기준 " + esc(k["기준"] || "") + " · 카드 클릭 = 근거 목록</span></div>" + yearChips(y, "year");
    h += '<div class="tiles">' + tile("전체 자재 순매출", val(k["전체자재순매출"], won), "판매 − 반품·회수·취소 반영 · 연도별·업체별·거래별", "hero", "salesTotal") +
      tile("메인 자재 순매출", unv ? "미확인" : val(k["메인자재순매출"], won), unv ? "2022~2023 품목명 검증 전" : "메인 비중 " + (pc(k["메인비중"]) || esc(k["메인비중"])) + " · 업체·품목·거래", "", "mainSales") +
      tile("POUR 낙찰 건수", val(k["POUR낙찰_건수"], num), "낙찰 시공사 " + (num(k["낙찰시공사수"]) || esc(k["낙찰시공사수"])) + "곳 · 금액 " + (won(k["POUR낙찰금액_VAT미확인"]) || "확인 불가") + "(VAT 미확인)", "", "awards") +
      tile("POUR 반영 공고", val(k["POUR반영공고_건수"], num), "전체 공고 " + (num(k["전체공고_건수"]) || esc(k["전체공고_건수"])) + " · 비중 " + (pc(k["POUR반영비중"]) || esc(k["POUR반영비중"])), "", "notices") +
      tile("기술자문 문의", val(k["기술자문문의_건수"], num), "컨설팅 요청 " + (num(k["컨설팅요청_건수"]) || esc(k["컨설팅요청_건수"])) + " · 설명회 " + (num(k["공법설명회_건수"]) || esc(k["공법설명회_건수"])), "", "tech") +
      tile("메인 구매 거래처", unv ? "미확인" : val(k["메인구매거래처수"], num), "공식 메인 구매율 " + esc(k["공식메인구매율"] == null ? "확인 불가" : k["공식메인구매율"]) + " · 후보 관측 " + esc(k["후보관측_메인구매업체"] == null ? "—" : k["후보관측_메인구매업체"]), "", "mainVendors") + "</div>";
    h += '<div class="card-h" style="margin-top:4px"><h2>선행지표 (전체 협력사 · 기준일 2026-10-20)</h2><span class="badge">팀장 확정 기준</span></div><div class="tiles">' +
      tile("공식 L2→L3 전환율", L ? pc(L["값"]) : null, (Lc ? "확정 " + esc(Lc["값"]) : "") + (L2 ? " / 유효 L2 " + esc(L2["값"]) : "") + " · 검증된 확정 건만", "hero", "l2l3Rate") +
      tile("검토 대상 (공식 제외 · 별도 관리)", Lr ? esc(Lr["값"]) + "건" : null, Lr ? esc(Lr["기준"]) : "", "", "review") +
      tile("평균 전환 소요일 (확정)", Ld && Ld["값"] != null ? esc(Ld["값"]) + "일" : null, Ld ? esc(Ld["기준"]) : "", "", "avgDays") +
      tile("장기 무활동 (90일 이상)", In ? esc(In["값"]) + "곳" : null, (In ? esc(In["비고"]) : "") + (Ic ? " · 핵심 협력사 중 " + esc(Ic["값"]) + "곳" : ""), "", "inactive") +
      tile("신규 협력사 활성화율", Na ? pc(Na["값"]) : null, Na ? esc(Na["비고"]) : "", "", "activation") + "</div>";
    var cols = [{ k: "연도" }, { k: "데이터구분" }, { k: "전체자재순매출", l: "전체 순매출", r: 1, fmt: won }, { k: "메인자재순매출", l: "메인 순매출", r: 1, fmt: won }, { k: "메인비중", r: 1, fmt: pc }, { k: "POUR낙찰_건수", l: "POUR 낙찰", r: 1, fmt: num }, { k: "낙찰시공사수", l: "낙찰 시공사", r: 1, fmt: num }, { k: "POUR반영공고_건수", l: "POUR 공고", r: 1, fmt: num }, { k: "타사공법낙찰_건수", l: "타사공법 낙찰", r: 1, fmt: num }, { k: "기술자문문의_건수", l: "기술자문", r: 1, fmt: num }, { k: "컨설팅요청_건수", l: "컨설팅", r: 1, fmt: num }, { k: "L3전환_확정_공식", l: "L3 확정", r: 1 }, { k: "L2L3전환율_공식", l: "전환율(공식)", r: 1, fmt: pc }, { k: "L3전환_검토대상", l: "검토", r: 1 }];
    h += '<div class="card-h" style="margin-top:4px"><h2>연도별 비교 (1.통합KPI 탭)</h2></div>' + table("kpiy", cols, objs("1.통합KPI"), { per: 10 }) + "</div>";
    h += isPub() ? reviewPubCard() : reviewCard();
    return h;
  }
  function chartsCard() {
    if (!has("1.통합KPI")) return "";
    var rows = objs("1.통합KPI");
    var defs = [["전체 자재 순매출", "전체자재순매출", won, "salesTotal"], ["POUR 낙찰 건수", "POUR낙찰_건수", num, "awards"], ["POUR 반영 공고", "POUR반영공고_건수", num, "notices"], ["메인 자재 순매출", "메인자재순매출", won, "mainSales"]];
    var h = '<div class="card"><div class="card-h"><h2>연도별 추이 (1.통합KPI 탭)</h2><span class="mini">막대를 누르면 그 연도의 근거 목록 · 2026은 10/20까지 누계 · 숫자가 아닌 값(미확인·데이터 없음)은 막대 없이 그대로 표기합니다</span></div><div class="ks-charts">';
    defs.forEach(function (d) { var max = 0; rows.forEach(function (r) { if (isNum(r[d[1]]) && r[d[1]] > max) max = r[d[1]]; });
      h += '<div class="ks-ch"><div class="t">' + esc(d[0]) + '</div><div class="bars">' + rows.map(function (r) { var v = r[d[1]], y = String(r["연도"]);
        if (isNum(v)) return '<div class="b" data-kact="detail" data-id="' + d[3] + '" data-year="' + esc(y) + '" tabindex="0" role="button" title="' + esc(y + "년 " + d[2](v)) + '"><div class="v">' + esc(d[2](v)) + '</div><div class="bar" style="height:' + Math.max(2, Math.round(v / max * 84)) + 'px"></div><div class="y">' + esc(y) + "</div></div>";
        return '<div class="b na"><div class="v">' + esc(v == null ? "—" : String(v)) + '</div><div class="bar" style="height:0"></div><div class="y">' + esc(y) + "</div></div>"; }).join("") + "</div></div>"; });
    return h + "</div></div>";
  }
  function reviewCard() {
    if (!has("16.L2L3전환")) return '<div class="card"><div class="ks-warn"><b>시트 구조 경고:</b> 16.L2L3전환 탭이 없거나 열 구조가 바뀌어 L2→L3 검토 목록을 표시하지 않습니다(0건으로 대체하지 않음).</div></div>';
    var rows = objs("16.L2L3전환").filter(function (r) { return r["판정"] === "검토"; });
    var cols = [{ k: "판정코드", l: "코드" }, { k: "시공사", raw: 1, f: function (o) { return vlink(o["시공사"], o["통합ID"]); } }, { k: "L2현장명", l: "현장" }, { k: "L2일자", l: "L2" }, { k: "L3일자", l: "L3" }, { k: "L3유형" }, { k: "판정근거", wrap: 1 }, { k: "추가확인_상태", l: "상태" }];
    return '<div class="card"><div class="card-h"><h2>L2→L3 검토 ' + rows.length + '건 — 공식 계산 제외 · 별도 관리</h2><span class="badge rev">확정 시 승인 이력 기록 후 재계산</span><button class="btn ghost rt" data-kact="detail" data-id="review">상세·증빙 보기</button></div>' + table("review", cols, rows, { per: 20 }) + "</div>";
  }

  /* ---------- 드릴다운 정의 (카드 → 근거 목록) ---------- */
  var VEND = function (o) { return vlink(o["거래처명"] || o["낙찰시공사"] || o["협력사명"] || o["업체명"] || o["시공사"] || o["업체"], o["통합ID"]); };
  var DETAILS = {
    salesTotal: { title: "전체 자재 순매출", yearly: true, subs: [["vendor", "업체별"], ["tx", "거래별"], ["year", "연도별"]], tabs: "3.이카운트판매원문 · 1.통합KPI",
      build: function (d) { var y = d.year, card = kpiVal(y, "전체자재순매출");
        if (d.sub === "year") return { cols: [{ k: "연도" }, { k: "데이터구분" }, { k: "전체자재순매출", r: 1, fmt: wonF }, { k: "동일기간_전체매출", l: "동일기간(1/1~10/20)", r: 1, fmt: wonF }, { k: "메인자재순매출", r: 1, fmt: wonF }, { k: "메인비중", r: 1, fmt: pc }], rows: objs("1.통합KPI"), keys: ["연도"], check: null, note: "1.통합KPI 탭 그대로" };
        if (!needLedger()) return { loading: true };
        var rows = ledgerOf(y);
        if (d.sub === "vendor") { var g = group(rows, function (r) { return (r["통합ID"] || "") + "|" + r["거래처명"]; }, function (r) { return { 통합ID: r["통합ID"], 거래처명: r["거래처명"], 거래행수: 0, 공급가액합: 0, 핵심메인합: 0, 음수전표행: 0 }; }, function (a, r) { a.거래행수++; if (isNum(r["공급가액"])) a.공급가액합 += r["공급가액"]; if (r["메인자재분류"] === "핵심 메인" && isNum(r["공급가액"])) a.핵심메인합 += r["공급가액"]; if (r["구분"] === "음수 전표") a.음수전표행++; }); return { cols: [{ k: "거래처명", raw: 1, f: VEND, csv: function (o) { return o["거래처명"]; } }, { k: "통합ID" }, { k: "거래행수", r: 1, fmt: num }, { k: "공급가액합", l: "순매출(공급가액 합)", r: 1, fmt: wonF }, { k: "핵심메인합", l: "핵심 메인", r: 1, fmt: wonF }, { k: "음수전표행", l: "음수 전표", r: 1, fmt: num }], rows: g, keys: ["거래처명", "통합ID"], totals: { 거래행수: rows.length, 공급가액합: sum(rows, "공급가액") }, check: chk("카드 순매출", card, "업체별 합계", sum(rows, "공급가액"), wonF), note: "3.이카운트판매원문 탭 · 연도 " + y + " · 거래처별 합계 (판매 − 반품·회수·취소 = 공급가액 합)" }; }
        return { cols: [{ k: "거래일자" }, { k: "전표번호" }, { k: "거래처명", raw: 1, f: VEND, csv: function (o) { return o["거래처명"]; } }, { k: "통합ID" }, { k: "품목명·규격", wrap: 1 }, { k: "수량", r: 1, fmt: num }, { k: "공급가액", r: 1, fmt: wonF }, { k: "구분" }, { k: "메인자재분류" }, { k: "적요(현장명)", wrap: 1 }, { k: "레코드ID" }], rows: rows, keys: ["거래처명", "통합ID", "품목명·규격", "전표번호", "적요(현장명)"], totals: { 공급가액: sum(rows, "공급가액") }, check: chk("카드 순매출", card, "거래 합계", sum(rows, "공급가액"), wonF), note: "3.이카운트판매원문 탭 · 연도 " + y + " 전체 행(판매·음수 전표·금액 공란 포함)" }; } },
    mainSales: { title: "메인 자재 순매출", yearly: true, subs: [["vendor", "구매 업체"], ["item", "품목별"], ["tx", "거래별"]], tabs: "4.메인자재구매현황 · 3.이카운트판매원문(메인자재분류=핵심 메인)",
      build: function (d) { var y = d.year, card = kpiVal(y, "메인자재순매출"); var unv = MAIN_UNVERIFIED[y] ? "2022~2023년은 과거 품목명 검증 전이라 카드에는 '미확인'으로 표시 — 아래는 현재 분류 기준으로 잡힌 행(참고)" : "";
        if (d.sub === "vendor") { var rows = objs("4.메인자재구매현황").filter(function (r) { return String(r["연도"]) === y && isNum(r["메인자재순매출"]) && r["메인자재순매출"] > 0; }); return { cols: [{ k: "거래처명", raw: 1, f: VEND, csv: function (o) { return o["거래처명"]; } }, { k: "통합ID" }, { k: "구매유형" }, { k: "메인자재순매출", r: 1, fmt: wonF }, { k: "메인자재_재도장", l: "재도장", r: 1, fmt: wonF }, { k: "메인자재_우레탄중도", l: "우레탄 중도", r: 1, fmt: wonF }, { k: "메인자재_에폭시중도", l: "에폭시 중도", r: 1, fmt: wonF }, { k: "전체순매출", r: 1, fmt: wonF }, { k: "메인비중", r: 1, fmt: pc }, { k: "비고", wrap: 1 }], rows: rows, keys: ["거래처명", "통합ID", "구매유형"], totals: { 메인자재순매출: sum(rows, "메인자재순매출"), 전체순매출: sum(rows, "전체순매출") }, check: MAIN_UNVERIFIED[y] ? null : chk("카드 메인 순매출", card, "업체 합계", sum(rows, "메인자재순매출"), wonF), note: "4.메인자재구매현황 탭 · 연도 " + y + " · 메인자재순매출 > 0 인 거래처. " + unv }; }
        if (!needLedger()) return { loading: true };
        var tx = ledgerOf(y).filter(function (r) { return r["메인자재분류"] === "핵심 메인"; });
        if (d.sub === "item") { var g = group(tx, function (r) { return r["품목명·규격"]; }, function (r) { return { "품목명·규격": r["품목명·규격"], 거래행수: 0, 수량합: 0, 공급가액합: 0, 거래처: {} }; }, function (a, r) { a.거래행수++; if (isNum(r["수량"])) a.수량합 += r["수량"]; if (isNum(r["공급가액"])) a.공급가액합 += r["공급가액"]; a.거래처[r["거래처명"]] = 1; }); g.forEach(function (a) { a.거래처수 = Object.keys(a.거래처).length; delete a.거래처; }); return { cols: [{ k: "품목명·규격", wrap: 1 }, { k: "거래행수", r: 1, fmt: num }, { k: "수량합", r: 1, fmt: num }, { k: "공급가액합", l: "금액", r: 1, fmt: wonF }, { k: "거래처수", r: 1, fmt: num }], rows: g, keys: ["품목명·규격"], totals: { 거래행수: tx.length, 공급가액합: sum(tx, "공급가액") }, check: MAIN_UNVERIFIED[y] ? null : chk("카드 메인 순매출", card, "품목 합계", sum(tx, "공급가액"), wonF), note: "3.이카운트판매원문 탭 · 연도 " + y + " · 메인자재분류 = 핵심 메인. " + unv }; }
        return { cols: [{ k: "거래일자" }, { k: "전표번호" }, { k: "거래처명", raw: 1, f: VEND, csv: function (o) { return o["거래처명"]; } }, { k: "통합ID" }, { k: "품목명·규격", wrap: 1 }, { k: "수량", r: 1, fmt: num }, { k: "공급가액", r: 1, fmt: wonF }, { k: "구분" }, { k: "적요(현장명)", wrap: 1 }], rows: tx, keys: ["거래처명", "통합ID", "품목명·규격", "전표번호", "적요(현장명)"], totals: { 공급가액: sum(tx, "공급가액") }, check: MAIN_UNVERIFIED[y] ? null : chk("카드 메인 순매출", card, "거래 합계", sum(tx, "공급가액"), wonF), note: "3.이카운트판매원문 탭 · 연도 " + y + " · 메인자재분류 = 핵심 메인. " + unv }; } },
    awards: { title: "POUR 낙찰", yearly: true, subs: [["list", "낙찰 현장별"], ["vendor", "시공사별"]], tabs: "5.POUR공고낙찰",
      build: function (d) { var y = d.year, rows = objs("5.POUR공고낙찰").filter(function (r) { return String(r["연도"]) === y; }); var amt = sum(rows, "낙찰금액"); var checks = [chk("카드 낙찰 건수", kpiVal(y, "POUR낙찰_건수"), "목록 건수", rows.length, num), chk("카드 낙찰 금액", kpiVal(y, "POUR낙찰금액_VAT미확인"), "목록 금액 합", amt, wonF)];
        if (d.sub === "vendor") { var g = group(rows, function (r) { return r["낙찰시공사"]; }, function (r) { return { 낙찰시공사: r["낙찰시공사"], 통합ID: r["통합ID"], 연결상태: r["연결상태"], 낙찰건수: 0, 낙찰금액합: 0, 금액미확인: 0 }; }, function (a, r) { a.낙찰건수++; if (isNum(r["낙찰금액"])) a.낙찰금액합 += r["낙찰금액"]; else a.금액미확인++; }); checks.push(chk("카드 낙찰 시공사", kpiVal(y, "낙찰시공사수"), "시공사 수", g.length, num)); return { cols: [{ k: "낙찰시공사", raw: 1, f: VEND, csv: function (o) { return o["낙찰시공사"]; } }, { k: "통합ID" }, { k: "연결상태", raw: 1, f: function (o) { return st(o["연결상태"]); }, csv: function (o) { return o["연결상태"]; } }, { k: "낙찰건수", r: 1, fmt: num }, { k: "낙찰금액합", l: "낙찰금액 합(VAT 미확인)", r: 1, fmt: wonF }, { k: "금액미확인", l: "금액 미확인 건", r: 1, fmt: num }], rows: g, keys: ["낙찰시공사", "통합ID"], totals: { 낙찰건수: rows.length, 낙찰금액합: amt }, checks: checks, note: "5.POUR공고낙찰 탭 · 연도 " + y + " · 낙찰시공사 표기 기준 집계(확정·추정·미연결 상태는 연결상태 열)" }; }
        return { cols: [{ k: "공고일" }, { k: "현장명", wrap: 1 }, { k: "지역" }, { k: "도시" }, { k: "공종그룹" }, { k: "공종" }, { k: "낙찰시공사", raw: 1, f: VEND, csv: function (o) { return o["낙찰시공사"]; } }, { k: "통합ID" }, { k: "연결상태", raw: 1, f: function (o) { return st(o["연결상태"]); }, csv: function (o) { return o["연결상태"]; } }, { k: "낙찰금액", r: 1, fmt: wonF }, { k: "낙찰금액상태" }, { k: "POUR판정" }, { k: "공고관계" }, { k: "공고기록ID" }], rows: rows, keys: ["현장명", "낙찰시공사", "통합ID", "주소", "공사명", "공고기록ID", "지역", "도시"], totals: { 낙찰금액: amt }, checks: checks, note: "5.POUR공고낙찰 탭 · 연도 " + y + " 전체 행" }; } },
    notices: { title: "POUR 반영 공고", yearly: true, subs: [["list", "공고별"], ["month", "월별"], ["trade", "공종별"]], tabs: "5b.POUR반영공고",
      build: function (d) { var y = d.year; if (!has("5b.POUR반영공고")) return { missing: "현재 데이터에 5b.POUR반영공고 탭이 없습니다 (구글시트에 v8 워크북의 5b 탭을 추가하면 실시간 조회 가능). 집계값은 1.통합KPI 탭의 POUR반영공고_건수 입니다." };
        var all = objs("5b.POUR반영공고").filter(function (r) { return String(r["연도"]) === y; }); var rows = all.filter(function (r) { return r["집계대상"] === "Y"; }); var ex = all.length - rows.length; var card = kpiVal(y, "POUR반영공고_건수"); var check = chk("카드 공고 건수", card, "목록 건수", rows.length, num); var note = "5b.POUR반영공고 탭 · 연도 " + y + " · 집계대상 = Y (원천 파일 연도 = 공고일 연도)" + (ex ? " · 집계 제외 " + ex + "건은 연도 불일치로 별도" : "");
        if (d.sub === "month") { var g = group(rows, function (r) { return String(r["공고일"]).slice(0, 7); }, function (r) { return { 월: String(r["공고일"]).slice(0, 7), 공고건수: 0, 낙찰기록: 0 }; }, function (a, r) { a.공고건수++; if (r["낙찰시공사"]) a.낙찰기록++; }); return { cols: [{ k: "월" }, { k: "공고건수", r: 1, fmt: num }, { k: "낙찰기록", l: "낙찰 시공사 기록", r: 1, fmt: num }], rows: g, keys: ["월"], totals: { 공고건수: rows.length }, check: check, note: note }; }
        if (d.sub === "trade") { var g2 = group(rows, function (r) { return r["공종그룹"] || "미기재"; }, function (r) { return { 공종그룹: r["공종그룹"] || "미기재", 공고건수: 0 }; }, function (a) { a.공고건수++; }); return { cols: [{ k: "공종그룹" }, { k: "공고건수", r: 1, fmt: num }], rows: g2, keys: ["공종그룹"], totals: { 공고건수: rows.length }, check: check, note: note }; }
        return { cols: [{ k: "공고일" }, { k: "현장명", wrap: 1 }, { k: "공고구분" }, { k: "공종그룹" }, { k: "공종" }, { k: "상태" }, { k: "낙찰시공사", raw: 1, f: VEND, csv: function (o) { return o["낙찰시공사"]; } }, { k: "통합ID" }, { k: "낙찰금액", r: 1, fmt: wonF }, { k: "동일기간" }, { k: "공고기록ID" }, { k: "원본출처", wrap: 1 }], rows: rows, keys: ["현장명", "낙찰시공사", "공고기록ID", "공종", "원본출처"], check: check, note: note }; } },
    tech: { title: "기술자문 문의", yearly: true, subs: [["list", "문의별"], ["vendor", "업체별"]], tabs: "7.기술자문문의", inc: true,
      build: function (d) { var y = d.year, all = objs("7.기술자문문의").filter(function (r) { return String(r["연도"]) === y; }); var rows = d.inc ? all : all.filter(function (r) { return !INTERNAL.test(String(r["협력사명"])); }); var check = chk("카드 문의 건수", kpiVal(y, "기술자문문의_건수"), "목록 건수(내부 제외)", all.filter(function (r) { return !INTERNAL.test(String(r["협력사명"])); }).length, num); var note = "7.기술자문문의 탭 · 연도 " + y + " · 내부·테스트 업체(넷폼·포어솔루션·테스트사) 제외" + (d.inc ? " → 현재 내부 포함 표시(" + all.length + "건)" : "") + ". 문의 내용 원문은 플랫폼 문의ID로 확인(시트에는 현장·공종·상태만 있음)";
        if (d.sub === "vendor") { var g = group(rows, function (r) { return r["협력사명"]; }, function (r) { return { 협력사명: r["협력사명"], 통합ID: r["통합ID"], 문의건수: 0, 현장: {}, 최근문의일: "" }; }, function (a, r) { a.문의건수++; a.현장[r["현장명"]] = 1; if (String(r["접수일자"]) > a.최근문의일) a.최근문의일 = String(r["접수일자"]); }); g.forEach(function (a) { a.현장수 = Object.keys(a.현장).length; delete a.현장; }); return { cols: [{ k: "협력사명", raw: 1, f: VEND, csv: function (o) { return o["협력사명"]; } }, { k: "통합ID" }, { k: "문의건수", r: 1, fmt: num }, { k: "현장수", r: 1, fmt: num }, { k: "최근문의일" }], rows: g, keys: ["협력사명", "통합ID"], totals: { 문의건수: rows.length }, check: check, note: note }; }
        return { cols: [{ k: "접수일자", l: "문의일" }, { k: "협력사명", raw: 1, f: VEND, csv: function (o) { return o["협력사명"]; } }, { k: "통합ID" }, { k: "현장명", wrap: 1 }, { k: "지역" }, { k: "도시" }, { k: "공종" }, { k: "특허번호" }, { k: "상태" }, { k: "낙찰결과" }, { k: "문의ID" }], rows: rows, keys: ["협력사명", "통합ID", "현장명", "공종", "문의ID", "지역", "도시"], check: check, note: note }; } },
    mainVendors: { title: "메인 구매 거래처", yearly: true, subs: [["main", "메인 구매(A)"], ["sep", "별도자재만(C)"], ["all", "전체 거래처"]], tabs: "4.메인자재구매현황",
      build: function (d) { var y = d.year, all = objs("4.메인자재구매현황").filter(function (r) { return String(r["연도"]) === y; }); var rows = d.sub === "main" ? all.filter(function (r) { return r["메인유상구매"] === "Y"; }) : d.sub === "sep" ? all.filter(function (r) { return r["구매유형"] === "C"; }) : all; var checks = d.sub === "main" ? [chk("카드 메인 구매 거래처", kpiVal(y, "메인구매거래처수"), "목록 거래처 수", rows.length, num), chk("카드 메인 순매출", kpiVal(y, "메인자재순매출"), "구매금액 합", sum(rows, "메인자재순매출"), wonF)] : d.sub === "sep" ? [chk("카드 별도자재만 거래처", kpiVal(y, "별도자재만거래처수"), "목록 거래처 수", rows.length, num)] : [];
        return { cols: [{ k: "거래처명", raw: 1, f: VEND, csv: function (o) { return o["거래처명"]; } }, { k: "통합ID" }, { k: "구매유형" }, { k: "메인유상구매" }, { k: "메인자재순매출", l: "메인 구매금액", r: 1, fmt: wonF }, { k: "전체순매출", r: 1, fmt: wonF }, { k: "메인비중", r: 1, fmt: pc }, { k: "별도자재", r: 1, fmt: wonF }, { k: "기타자재", r: 1, fmt: wonF }, { k: "거래행수", r: 1, fmt: num }, { k: "비고", wrap: 1 }], rows: rows, keys: ["거래처명", "통합ID", "구매유형", "비고"], totals: { 메인자재순매출: sum(rows, "메인자재순매출"), 전체순매출: sum(rows, "전체순매출") }, checks: checks, note: "4.메인자재구매현황 탭 · 연도 " + y + " · " + (d.sub === "main" ? "메인유상구매 = Y (구매유형 A)" : d.sub === "sep" ? "구매유형 = C (별도자재만 유상 구매)" : "전체 거래처 (A·C·검토)") + (MAIN_UNVERIFIED[y] ? " · 2022~2023은 품목명 검증 전(참고)" : "") }; } },
    l2l3Rate: { title: "공식 L2→L3 전환율", yearly: false, subs: [["confirmed", "확정 전환 이력"], ["valid", "유효 L2 전체"], ["verdict", "판정 기준·집계"], ["vendor", "시공사별"]], tabs: "16.L2L3전환 · 16c.L2L3판정집계 · 16b.L2L3시공사별 · 18.선행지표요약",
      build: function (d) { var all = objs("16.L2L3전환"); var conf = all.filter(function (r) { return r["판정"] === "확정"; }); var valid = all.filter(function (r) { return !/^X/.test(String(r["판정코드"])); }); var Lc = leading("[공식] L3 전환 확정"), L2 = leading("L2 건수"), L = leading("[공식] L2→L3 전환율"); var checks = [chk("카드 확정 건수", Lc ? Lc["값"] : null, "확정 목록", conf.length, num), chk("카드 유효 L2", L2 ? L2["값"] : null, "유효 L2 목록", valid.length, num), chk("카드 전환율", L ? L["값"] : null, "확정 ÷ 유효 L2", valid.length ? +(conf.length / valid.length).toFixed(4) : null, pc)];
        var L2COLS = [{ k: "L2일자" }, { k: "시공사", raw: 1, f: VEND, csv: function (o) { return o["시공사"]; } }, { k: "통합ID" }, { k: "L2현장명", l: "현장", wrap: 1 }, { k: "판정", raw: 1, f: function (o) { return st(o["판정"]); }, csv: function (o) { return o["판정"]; } }, { k: "판정코드", l: "코드" }, { k: "판정근거", wrap: 1 }, { k: "L3일자" }, { k: "L3유형" }, { k: "전환소요일", r: 1 }, { k: "공식전환포함", l: "공식 포함" }, { k: "L2문의ID" }, { k: "L3문의ID" }];
        if (d.sub === "valid") return { cols: L2COLS, rows: valid, keys: ["시공사", "통합ID", "L2현장명", "판정", "판정코드", "판정근거"], checks: checks, note: "16.L2L3전환 탭 · 판정코드 X(일자 없음·기준일 이후·현장 없음) 제외 = 유효 L2 (공식 분모). 확정만 분자, 검토는 분모만 포함" };
        if (d.sub === "verdict") return { cols: [{ k: "판정코드" }, { k: "판정", wrap: 1 }, { k: "건수", r: 1, fmt: num }, { k: "공식전환율_반영" }, { k: "판단기준", wrap: 1 }], rows: objs("16c.L2L3판정집계"), keys: ["판정코드", "판정"], checks: checks, note: "16c.L2L3판정집계 탭 · 동일 시공사 + 동일 현장 + L2 이후 L3 · L2 1건당 최대 1회 · A1/A2 확정, R 검토, N 미전환, X 제외" };
        if (d.sub === "vendor") return { cols: [{ k: "시공사", raw: 1, f: VEND, csv: function (o) { return o["시공사"]; } }, { k: "통합ID" }, { k: "L2건수", r: 1 }, { k: "유효L2", r: 1 }, { k: "L3전환_확정", l: "확정", r: 1 }, { k: "검토", r: 1 }, { k: "미전환", r: 1 }, { k: "공식전환율", r: 1, fmt: pc }, { k: "검토포함시_전환율", l: "검토 포함 시(참고)", r: 1, fmt: pc }, { k: "평균소요일_확정", r: 1 }], rows: objs("16b.L2L3시공사별"), keys: ["시공사", "통합ID"], checks: checks, note: "16b.L2L3시공사별 탭" };
        return { cols: L2COLS, rows: conf, keys: ["시공사", "통합ID", "L2현장명", "판정근거", "L3유형"], checks: checks, note: "16.L2L3전환 탭 · 판정 = 확정 (A1 아파트ID 일치 1건 + A2 현장명·주소 일치·6항목 검증 통과 67건)" }; } },
    review: { title: "L2→L3 검토 대상 (공식 제외 · 별도 관리)", yearly: false, subs: [["list", "검토 건별 사유·증빙"], ["vendor", "업체별"]], tabs: "16.L2L3전환",
      build: function (d) { var rows = objs("16.L2L3전환").filter(function (r) { return r["판정"] === "검토"; }); var Lr = leading("검토 대상"); var check = chk("카드 검토 건수", Lr ? Lr["값"] : null, "목록 건수", rows.length, num);
        if (d.sub === "vendor") { var g = group(rows, function (r) { return r["시공사"]; }, function (r) { return { 시공사: r["시공사"], 통합ID: r["통합ID"], 검토건수: 0, 코드: {}, 현장: {} }; }, function (a, r) { a.검토건수++; a.코드[r["판정코드"]] = (a.코드[r["판정코드"]] || 0) + 1; a.현장[r["L2현장명"]] = 1; }); g.forEach(function (a) { a.판정코드 = Object.keys(a.코드).map(function (k) { return k + " " + a.코드[k]; }).join(", "); a.현장목록 = Object.keys(a.현장).join(" | "); delete a.코드; delete a.현장; }); return { cols: [{ k: "시공사", raw: 1, f: VEND, csv: function (o) { return o["시공사"]; } }, { k: "통합ID" }, { k: "검토건수", r: 1, fmt: num }, { k: "판정코드" }, { k: "현장목록", wrap: 1 }], rows: g, keys: ["시공사", "통합ID"], totals: { 검토건수: rows.length }, check: check, note: "16.L2L3전환 탭 · 판정 = 검토 · 업체별" }; }
        return { cols: [{ k: "판정코드", l: "코드" }, { k: "시공사", raw: 1, f: VEND, csv: function (o) { return o["시공사"]; } }, { k: "통합ID" }, { k: "L2현장명", l: "현장", wrap: 1 }, { k: "L2일자" }, { k: "L3일자" }, { k: "L3유형" }, { k: "판정근거", l: "검토 사유", wrap: 1 }, { k: "검증1_시공사동일성", wrap: 1 }, { k: "검증2_현장명주소", wrap: 1 }, { k: "검증3_공종충돌", wrap: 1 }, { k: "검증4_선후관계", wrap: 1 }, { k: "검증5_중복전환", wrap: 1 }, { k: "검증6_원본추적", wrap: 1 }, { k: "L2문의ID", l: "증빙 L2 문의ID" }, { k: "L3문의ID", l: "증빙 L3 문의ID" }, { k: "추가확인_L3공사범위", wrap: 1 }, { k: "추가확인_같은현장_POUR공고", wrap: 1 }, { k: "추가확인_상태" }, { k: "검토결정" }], rows: rows, keys: ["시공사", "통합ID", "L2현장명", "판정코드", "판정근거"], check: check, note: "16.L2L3전환 탭 · 판정 = 검토 (R2 주소 불일치 · R4 현장명 유사 · R6 공종 충돌 · R7 원본 미추적 · R9 공종 부분 일치). 확정·기각은 decisions/l2l3_reviews.jsonl 에 승인자·근거 기록 후 재계산" }; } },
    avgDays: { title: "평균 전환 소요일 (확정)", yearly: false, subs: [["list", "건별 소요일"], ["dist", "분포"]], tabs: "16.L2L3전환",
      build: function (d) { var rows = objs("16.L2L3전환").filter(function (r) { return r["판정"] === "확정"; }); var days = rows.map(function (r) { return r["전환소요일"]; }).filter(isNum); var avg = days.length ? +(days.reduce(function (a, b) { return a + b; }, 0) / days.length).toFixed(1) : null; var Ld = leading("[공식] 평균 전환 소요일"); var check = chk("카드 평균 소요일", Ld ? Ld["값"] : null, "건별 평균", avg, function (v) { return v == null ? null : v + "일"; });
        if (d.sub === "dist") { var b = { "0일(당일)": 0, "1~7일": 0, "8~30일": 0, "31일 이상": 0 }; days.forEach(function (x) { b[x === 0 ? "0일(당일)" : x <= 7 ? "1~7일" : x <= 30 ? "8~30일" : "31일 이상"]++; }); return { cols: [{ k: "구간" }, { k: "건수", r: 1, fmt: num }, { k: "비중", r: 1, fmt: pc }], rows: Object.keys(b).map(function (k) { return { 구간: k, 건수: b[k], 비중: days.length ? b[k] / days.length : null }; }), keys: ["구간"], check: check, note: "확정 " + days.length + "건의 L3 일자 − L2 일자 분포 · 중앙값 " + (days.length ? days.slice().sort(function (a, b2) { return a - b2; })[Math.floor(days.length / 2)] : "—") + "일" }; }
        return { cols: [{ k: "전환소요일", l: "소요일", r: 1 }, { k: "시공사", raw: 1, f: VEND, csv: function (o) { return o["시공사"]; } }, { k: "통합ID" }, { k: "L2현장명", l: "현장", wrap: 1 }, { k: "L2일자" }, { k: "L3일자" }, { k: "L3유형" }, { k: "판정코드" }, { k: "판정근거", wrap: 1 }], rows: rows, keys: ["시공사", "통합ID", "L2현장명", "L3유형"], check: check, note: "16.L2L3전환 탭 · 판정 = 확정 · 전환소요일 = L3 일자 − L2 일자 (당일 = 0)" }; } },
    inactive: { title: "장기 무활동 협력사", yearly: false, subs: [["inactive", "장기 무활동(90일+)"], ["never", "활동 이력 없음"], ["normal", "정상"], ["core", "핵심 협력사"]], tabs: "17.장기무활동",
      build: function (d) { var all = objs("17.장기무활동"); var rows = d.sub === "inactive" ? all.filter(function (r) { return r["판정"] === "장기 무활동"; }) : d.sub === "never" ? all.filter(function (r) { return r["판정"] === "활동 이력 없음"; }) : d.sub === "normal" ? all.filter(function (r) { return r["판정"] === "정상"; }) : all.filter(function (r) { return r["핵심협력사"] === "Y"; }); var In = leading("장기 무활동"), Ic = leading("핵심 협력사 중"); var checks = [chk("카드 장기 무활동", In ? In["값"] : null, "목록(장기 무활동)", all.filter(function (r) { return r["판정"] === "장기 무활동"; }).length, num)]; if (d.sub === "core") checks.push(chk("카드 핵심 중 무활동", Ic ? Ic["값"] : null, "핵심 목록 중 장기 무활동", rows.filter(function (r) { return r["판정"] === "장기 무활동"; }).length, num));
        return { cols: [{ k: "업체명", raw: 1, f: VEND, csv: function (o) { return o["업체명"]; } }, { k: "통합ID" }, { k: "핵심협력사", l: "핵심" }, { k: "판정", raw: 1, f: function (o) { return '<span class="st ' + (o["판정"] === "정상" ? "ok" : o["판정"] === "장기 무활동" ? "bad" : "na") + '">' + esc(o["판정"]) + "</span>"; }, csv: function (o) { return o["판정"]; } }, { k: "마지막활동일" }, { k: "무활동경과일", l: "무활동 일수", r: 1 }, { k: "마지막활동유형" }, { k: "활동건수_기록기간", l: "활동 건수", r: 1 }, { k: "기준일" }], rows: rows, keys: ["업체명", "통합ID", "마지막활동유형"], checks: checks, note: "17.장기무활동 탭 · 기준일 2026-10-20 · 마지막 영업활동(기술자문·컨설팅·샘플·설명회·기타) 이후 90일 이상 = 장기 무활동 · 기록은 2025-06-24부터 · 핵심 협력사 = 2025 POUR 낙찰 3건 이상(임시 정의)" }; } },
    activation: { title: "신규 협력사 활성화율", yearly: false, subs: [["active", "활동 업체"], ["idle", "미활동 업체"], ["joined", "가입(승인) 전체"], ["excluded", "집계 제외"]], tabs: "7b.플랫폼가입현황",
      build: function (d) { if (!has("7b.플랫폼가입현황")) return { missing: "현재 데이터에 7b.플랫폼가입현황 탭이 없습니다 (구글시트에 v8 워크북의 7b 탭을 추가하면 실시간 조회 가능). 집계값은 18.선행지표요약 탭의 '신규 협력사 활성화율' 입니다." }; var all = objs("7b.플랫폼가입현황"); var joined = all.filter(function (r) { return r["집계대상"] === "가입(승인)"; }); var active = joined.filter(function (r) { return r["활동여부"] === "Y"; }); var Na = leading("신규 협력사 활성화율"); var checks = [chk("카드 활성화율", Na ? Na["값"] : null, "활동 ÷ 가입", joined.length ? +(active.length / joined.length).toFixed(4) : null, pc), chk("비고 가입 수", Na ? Number((String(Na["비고"]).match(/가입\s*(\d+)/) || [])[1]) : null, "가입(승인) 목록", joined.length, num), chk("비고 활동 수", Na ? Number((String(Na["비고"]).match(/활동\s*(\d+)/) || [])[1]) : null, "활동 목록", active.length, num)]; var rows = d.sub === "active" ? active : d.sub === "idle" ? joined.filter(function (r) { return r["활동여부"] !== "Y"; }) : d.sub === "joined" ? joined : all.filter(function (r) { return r["집계대상"] !== "가입(승인)"; });
        return { cols: [{ k: "가입일자" }, { k: "업체명", raw: 1, f: VEND, csv: function (o) { return o["업체명"]; } }, { k: "통합ID" }, { k: "가입경로" }, { k: "집계대상" }, { k: "활동여부" }, { k: "활동건수_여정L2이상", l: "활동 건수(L2 이상)", r: 1 }, { k: "출처" }], rows: rows, keys: ["업체명", "통합ID", "가입경로", "집계대상"], checks: checks, note: "7b.플랫폼가입현황 탭 · 2026 플랫폼 가입(승인) 업체 중 여정 기록(L2 이상) 1건 이상 = 활동 · 내부·테스트·미승인은 집계 제외 · 전체 전환율과 분리 관리" }; } }
  };
  function chk(cardLabel, cardVal, listLabel, listVal, fmt) { var ok; if (typeof cardVal === "string" && !isNum(Number(cardVal))) return { cls: "na", text: cardLabel + " ‘" + cardVal + "’ — 카드에 수치가 없어 대조 대상 아님 (" + listLabel + " " + (listVal == null ? "—" : (fmt && fmt(listVal) != null ? fmt(listVal) : listVal)) + ")" }; if (cardVal == null || listVal == null) ok = null; else if (isNum(cardVal) && isNum(listVal)) ok = Math.abs(cardVal - listVal) < 0.5 || Math.abs(cardVal - listVal) <= 0.00005; else ok = String(cardVal) === String(listVal); var f = function (v) { if (v == null) return "확인 불가"; var t = fmt ? fmt(v) : null; return t == null ? String(v) : t; }; return { cls: ok === null ? "na" : ok ? "ok" : "bad", text: cardLabel + " " + f(cardVal) + (ok === null ? " · 대조 불가 (" + listLabel + " " + f(listVal) + ")" : ok ? " = " + listLabel + " " + f(listVal) + " · 일치" : " ≠ " + listLabel + " " + f(listVal) + " · 불일치") }; }
  var NEEDS = { salesTotal: ["1.통합KPI"], mainSales: ["4.메인자재구매현황"], awards: ["5.POUR공고낙찰"], notices: ["5b.POUR반영공고"], tech: ["7.기술자문문의"], mainVendors: ["4.메인자재구매현황"], l2l3Rate: ["16.L2L3전환", "16b.L2L3시공사별", "16c.L2L3판정집계", "18.선행지표요약"], review: ["16.L2L3전환", "18.선행지표요약"], avgDays: ["16.L2L3전환", "18.선행지표요약"], inactive: ["17.장기무활동", "18.선행지표요약"], activation: ["7b.플랫폼가입현황", "18.선행지표요약"] };
  function missingNeeds(id) { return (NEEDS[id] || []).filter(function (t) { return !has(t); }); }
  function openDetail(id) { var D = DETAILS[id]; if (!D) return; if (isPub()) { V.detail = { restricted: true, id: id }; return; } V.detail = { id: id, year: V.year, sub: D.subs[0][0], q: "", sort: null, inc: false }; V.page["detail"] = 0; }
  function detailModal() {
    var d = V.detail; if (!d) return ""; if (d.restricted) return restrictedModal(); var D = DETAILS[d.id]; var res;
    var mn = missingNeeds(d.id);
    if (mn.length) res = { missing: "시트 구조 경고 — 필요한 탭이 없거나 열 구조가 바뀌어 이 카드는 표시하지 않습니다(0으로 대체하지 않음): " + mn.join(", ") };
    else { try { res = D.build(d); } catch (e) { res = { missing: "목록 생성 오류: " + (e.message || e) }; } }
    var h = '<div class="ks-modal" data-kact="dclose-bg"><div class="box" role="dialog" aria-modal="true"><div class="hd"><h2>' + esc(D.title) + (D.yearly ? " · " + esc(d.year) + "년" : " · 전체 협력사 기준") + '</h2><span class="mini">출처 탭: ' + esc(D.tabs) + '</span><button class="x" data-kact="dclose">닫기 ✕</button></div><div class="bd">';
    if (D.yearly) h += '<div class="ks-chips">' + years().map(function (y) { return '<button data-kact="dyear" data-id="' + y + '"' + (d.year === y ? ' aria-current="true"' : "") + ">" + y + (y === "2026" ? " (~10/20)" : "") + "</button>"; }).join("") + "</div>";
    h += '<div class="ks-chips">' + D.subs.map(function (s) { return '<button data-kact="dsub" data-id="' + s[0] + '"' + (d.sub === s[0] ? ' aria-current="true"' : "") + ">" + esc(s[1]) + "</button>"; }).join("") + (D.inc ? '<button data-kact="dinc"' + (d.inc ? ' aria-current="true"' : "") + ">내부·테스트 포함</button>" : "") + "</div>";
    if (res.loading) { h += loadingBox(); return h + "</div></div></div>"; }
    if (res.missing) { h += '<div class="ks-warn">' + esc(res.missing) + "</div>"; return h + "</div></div></div>"; }
    var checks = res.checks || (res.check ? [res.check] : []);
    h += '<div class="src">' + esc(res.note || "") + "</div>";
    h += checks.map(function (c) { return '<span class="chk ' + c.cls + '">' + esc(c.text) + "</span> "; }).join("");
    var rows = res.rows.filter(function (o) { return match(o, d.q, res.keys || []); }); rows = sortRows(rows, d.sort);
    h += '<div class="ks-tools"><input data-kact="dq" placeholder="검색 (' + esc((res.keys || []).slice(0, 4).join(" · ")) + ') — Enter" value="' + esc(d.q) + '"><span class="cnt">' + num(rows.length) + (rows.length !== res.rows.length ? " / " + num(res.rows.length) : "") + '행</span><button class="btn ghost" data-kact="dcsv">엑셀(CSV) 다운로드</button></div>';
    var emptyMsg = d.q ? "검색어 ‘" + d.q + "’에 해당하는 행이 없습니다. 검색어를 지우면 전체 " + num(res.rows.length) + "행이 표시됩니다." : (res.empty || emptyReason(d, D));
    h += table("detail", res.cols, rows, { sort: d.sort || {}, totals: d.q ? null : res.totals, per: 50, empty: emptyMsg });
    h += '<div class="mini" style="margin-top:8px">열 머리글 클릭 = 정렬 · 업체명 클릭 = 해당 업체 통합 분석 화면 · 검색 중에는 합계 행을 표시하지 않습니다 · 상태 구분: 확정 / 추정 / 검토 / 미연결은 각 행의 연결상태·판정 열</div>';
    return h + "</div></div></div>";
  }
  function emptyReason(d, D) {
    var y = d.year; var act = /^(tech|activation)$/.test(d.id);
    if (act && y && y < "2025") return y + "년에는 영업활동 기록이 없습니다. 플랫폼 영업활동 기록은 2025-06-24부터 쌓였고, 그 이전 활동은 데이터가 없어 '데이터 없음'으로 둡니다(0건이 아님).";
    if (/^(mainSales|mainVendors)$/.test(d.id) && MAIN_UNVERIFIED[y]) return y + "년은 과거 품목명 검증 전이라 '핵심 메인' 분류가 없습니다. 카드에도 '미확인'으로 표시하며 0원이 아닙니다.";
    if (d.id === "notices" || d.id === "awards") return y + "년 조건(출처 " + D.tabs + ")에 해당하는 행이 없습니다.";
    return "조건(출처 " + D.tabs + (D.yearly ? " · 연도 " + y : "") + ")에 해당하는 행이 없습니다. 카드 값이 '데이터 없음'·'미확인'이면 원천에 기록이 없는 것이며 0으로 집계하지 않습니다.";
  }
  function detailCsv() { var d = V.detail; if (!d) return; var res = DETAILS[d.id].build(d); if (!res.rows) return; var rows = sortRows(res.rows.filter(function (o) { return match(o, d.q, res.keys || []); }), d.sort); csv(res.cols, rows, DETAILS[d.id].title + (DETAILS[d.id].yearly ? "_" + d.year : "") + "_" + d.sub); }

  /* ---------- 매출·원문 ---------- */
  function sales() {
    var h = '<div class="card"><div class="card-h"><h2>메인 자재 구매 현황 (4.메인자재구매현황 탭)</h2></div>' + yearChips(V.year, "year");
    var rows = objs("4.메인자재구매현황").filter(function (r) { return String(r["연도"]) === V.year && match(r, V.q, ["거래처명", "통합ID", "구매유형"]); });
    var tot = sum(rows, "전체순매출"), mainT = sum(rows, "메인자재순매출");
    h += '<div class="ks-tools"><input data-kact="q" placeholder="거래처명 · 통합ID · 구매유형 검색 (Enter)" value="' + esc(V.q) + '"><span class="cnt">' + num(rows.length) + "개 거래처 · 순매출 " + (won(tot) || "0") + (MAIN_UNVERIFIED[V.year] ? " · 메인 미확인" : " · 메인 " + (won(mainT) || "0")) + '</span><button class="btn ghost" data-kact="csv" data-id="main">CSV</button></div>';
    var cols = [{ k: "통합ID" }, { k: "거래처명", raw: 1, f: VEND }, { k: "구매유형" }, { k: "거래행수", r: 1, fmt: num }, { k: "전체순매출", r: 1, fmt: won }, { k: "메인자재순매출", r: 1, fmt: won }, { k: "메인비중", r: 1, fmt: pc }, { k: "별도자재", r: 1, fmt: won }, { k: "기타자재", r: 1, fmt: won }, { k: "비고", wrap: 1 }];
    h += table("main", cols, rows) + "</div>";
    h += ledgerCard();
    return h;
  }
  function ledgerCard() {
    var st2 = S.state; var h = '<div class="card"><div class="card-h"><h2>거래 원문 원장 (3.이카운트판매원문 탭)</h2><span class="badge">' + (st2.mode === "live" ? "구글시트 실시간" : "저장된 데이터") + "</span></div>";
    if (!ledgerRows) { h += '<p class="card-sub">판매·반품·회수·취소 원문 ' + num((st2.embeddedMeta && st2.embeddedMeta.tabs && st2.embeddedMeta.tabs[S.LEDGER] || {}).rows || 0) + "행. 전표번호·거래처·품목·현장(적요)으로 추적합니다." + (st2.mode === "live" ? " 실시간 모드에서는 5,000행씩 나눠 읽습니다." : "") + "</p>"; h += V.ledgerState === "loading" ? loadingBox() : V.ledgerState === "error" ? '<div class="ks-warn">원문 읽기 실패: ' + esc(V.ledgerErr) + "</div>" : '<button class="btn" data-kact="ledger">원문 불러오기</button>'; return h + "</div>"; }
    var yrs = {}; ledgerRows.forEach(function (r) { yrs[r["연도"]] = 1; });
    var rows = ledgerRows.filter(function (r) { return (V.ledgerYear === "all" || String(r["연도"]) === V.ledgerYear) && (V.ledgerKind === "all" || r["구분"] === V.ledgerKind) && (V.ledgerMain === "all" || r["메인자재분류"] === V.ledgerMain) && match(r, V.q, ["거래처명", "적요(현장명)", "품목명·규격", "전표번호", "통합ID"]); });
    var kinds = {}, mains = {}; ledgerRows.forEach(function (r) { if (r["구분"]) kinds[r["구분"]] = 1; if (r["메인자재분류"]) mains[r["메인자재분류"]] = 1; });
    h += '<div class="ks-tools"><input data-kact="q" placeholder="거래처 · 현장(적요) · 품목 · 전표번호 검색 (Enter)" value="' + esc(V.q) + '"><select data-kact="lyear"><option value="all">전체 연도</option>' + Object.keys(yrs).sort().map(function (y) { return '<option value="' + y + '"' + (V.ledgerYear === y ? " selected" : "") + ">" + y + "</option>"; }).join("") + '</select><select data-kact="lkind"><option value="all">전체 구분</option>' + Object.keys(kinds).map(function (k) { return '<option value="' + esc(k) + '"' + (V.ledgerKind === k ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") + '</select><select data-kact="lmain"><option value="all">전체 분류</option>' + Object.keys(mains).map(function (k) { return '<option value="' + esc(k) + '"' + (V.ledgerMain === k ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") + '</select><span class="cnt">' + num(rows.length) + "행 · 공급가액 합계 " + (won(sum(rows, "공급가액")) || "0") + '</span><button class="btn ghost" data-kact="csv" data-id="ledger">CSV</button></div>';
    var cols = [{ k: "거래일자" }, { k: "전표번호" }, { k: "거래처명", raw: 1, f: VEND }, { k: "통합ID" }, { k: "품목명·규격", wrap: 1 }, { k: "수량", r: 1, fmt: num }, { k: "공급가액", r: 1, fmt: wonF }, { k: "구분" }, { k: "메인자재분류" }, { k: "적요(현장명)", wrap: 1 }, { k: "레코드ID" }];
    return h + table("ledger", cols, rows) + "</div>";
  }

  /* ---------- 낙찰 ---------- */
  function awards() {
    var all = objs("5.POUR공고낙찰"); var trades = {}; all.forEach(function (r) { if (r["공종그룹"]) trades[r["공종그룹"]] = 1; });
    var rows = all.filter(function (r) { return (V.awardYear === "all" || String(r["연도"]) === V.awardYear) && (V.awardTrade === "all" || r["공종그룹"] === V.awardTrade) && match(r, V.q, ["현장명", "낙찰시공사", "통합ID", "주소", "공사명", "공고기록ID"]); });
    var amt = rows.filter(function (r) { return isNum(r["낙찰금액"]); }), amtSum = sum(amt, "낙찰금액");
    var h = '<div class="card"><div class="card-h"><h2>POUR 공고·낙찰 (5.POUR공고낙찰 탭)</h2><span class="badge">검증 기준 2022~2026-10-20</span></div>';
    h += '<div class="ks-chips"><button data-kact="ayear" data-id="all"' + (V.awardYear === "all" ? ' aria-current="true"' : "") + ">전체</button>" + years().map(function (y) { return '<button data-kact="ayear" data-id="' + y + '"' + (V.awardYear === y ? ' aria-current="true"' : "") + ">" + y + "</button>"; }).join("") + "</div>";
    h += '<div class="ks-tools"><input data-kact="q" placeholder="현장명 · 시공사 · 주소 · 공사명 검색 (Enter)" value="' + esc(V.q) + '"><select data-kact="atrade"><option value="all">전체 공종</option>' + Object.keys(trades).map(function (k) { return '<option value="' + esc(k) + '"' + (V.awardTrade === k ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") + '</select><span class="cnt">' + num(rows.length) + "건 · 금액 확인 " + num(amt.length) + "건 " + (won(amtSum) || "0") + " (VAT 미확인)" + '</span><button class="btn ghost" data-kact="csv" data-id="awards">CSV</button></div>';
    var cols = [{ k: "공고일" }, { k: "현장명", wrap: 1 }, { k: "지역" }, { k: "공종그룹" }, { k: "공종" }, { k: "낙찰시공사", raw: 1, f: VEND }, { k: "통합ID" }, { k: "연결상태", raw: 1, f: function (o) { return st(o["연결상태"]); } }, { k: "낙찰금액", r: 1, fmt: won }, { k: "낙찰금액상태" }, { k: "POUR판정" }, { k: "공고관계" }];
    h += table("awards", cols, rows) + "</div>";
    var other = objs("6.타사공법낙찰").filter(function (r) { return (V.awardYear === "all" || String(r["연도"]) === V.awardYear) && match(r, V.q, ["현장명", "낙찰업체", "공법명_특허권자"]); });
    h += '<div class="card"><div class="card-h"><h2>타사 공법 낙찰 (6.타사공법낙찰 탭)</h2><span class="mini">' + num(other.length) + "건</span></div>" + table("other", [{ k: "공고일" }, { k: "현장명", wrap: 1 }, { k: "공종" }, { k: "낙찰공법구분" }, { k: "공법명_특허권자", wrap: 1 }, { k: "낙찰업체", raw: 1, f: function (o) { return vlink(o["낙찰업체"], o["통합ID"]); } }, { k: "통합ID" }, { k: "낙찰금액", r: 1, fmt: won }], other, { per: 20 }) + "</div>";
    return h;
  }
  function st(v) { if (v == null) return '<span class="mini">—</span>'; var s = String(v); var c = /^확정/.test(s) ? "ok" : /검토/.test(s) ? "rev" : /추정/.test(s) ? "" : /전용|없음|불가|미/.test(s) ? "na" : ""; return '<span class="st ' + c + '">' + esc(s) + "</span>"; }

  /* ---------- 시공사 (통합 분석) ---------- */
  function vendors() {
    var rows = objs("2.시공사마스터").filter(function (r) { return match(r, V.q, ["통합ID", "대표업체명", "낙찰시공사_표기", "이카운트_거래처명", "플랫폼_업체명", "사업자등록번호", "마스터업체코드", "연결상태", "출처"]); });
    var h = "";
    if (V.vendor) h += vendorDetail(V.vendor);
    h += '<div class="card"><div class="card-h"><h2>시공사 마스터 (2.시공사마스터 탭)</h2><span class="mini">통합ID ' + num(objs("2.시공사마스터").length) + "개 · 원본 표기 보존 · 행 클릭 = 통합 분석</span></div>";
    h += '<div class="ks-tools"><input data-kact="q" placeholder="업체명 · 통합ID · 사업자번호 · 표기 · 연결상태(확정/추정/검토) 검색 (Enter)" value="' + esc(V.q) + '"><span class="cnt">' + num(rows.length) + '개</span><button class="btn ghost" data-kact="csv" data-id="vendors">CSV</button></div>';
    var cols = [{ k: "통합ID" }, { k: "대표업체명" }, { k: "연결상태", raw: 1, f: function (o) { return st(o["연결상태"]); } }, { k: "출처" }, { k: "마스터업체코드" }, { k: "사업자등록번호" }, { k: "협약일" }, { k: "낙찰시공사_표기", wrap: 1 }, { k: "이카운트_거래처명", wrap: 1 }, { k: "플랫폼_업체명", wrap: 1 }, { k: "검토사항", wrap: 1 }];
    h += table("vendors", cols, rows, { rowAct: "vrow", rowKey: "통합ID" }) + "</div>";
    return h;
  }
  function vendorDetail(id) {
    var m = objs("2.시공사마스터").filter(function (r) { return r["통합ID"] === id; })[0]; if (!m) return '<div class="card"><div class="ks-warn">통합ID ' + esc(id) + " 를 시공사 마스터에서 찾지 못했습니다(미연결 표기일 수 있음). 아래 검색으로 확인하세요.</div></div>";
    var byId = function (n) { return objs(n).filter(function (r) { return r["통합ID"] === id; }); };
    var aw = byId("5.POUR공고낙찰"), mm = byId("4.메인자재구매현황"), lb = byId("16b.L2L3시공사별")[0], ia = byId("17.장기무활동")[0], l2 = byId("16.L2L3전환"), nt = has("5b.POUR반영공고") ? byId("5b.POUR반영공고").filter(function (r) { return r["집계대상"] === "Y"; }) : [], ot = byId("6.타사공법낙찰"), sg = has("7b.플랫폼가입현황") ? byId("7b.플랫폼가입현황") : [];
    var acts = []; [["7.기술자문문의", "접수일자", "기술자문 문의", "현장명", "상태"], ["8.컨설팅요청", "등록일자", "컨설팅 요청", "현장명", "발송여부"], ["10.공법설명회이력", "등록일", "공법설명회", "현장명", "상태"], ["9.샘플카탈로그요청", "접수일시", "샘플·카탈로그", "주소", ""], ["11.기타문의답변", "등록일", "기타 문의", "문의내용", "답변완료일"]].forEach(function (d) { byId(d[0]).forEach(function (r) { acts.push({ 일자: String(r[d[1]] || "").slice(0, 10), 유형: d[2], 현장명: r[d[3]] || "", 공종: r["공종"] || r["공종별"] || "", 상태: d[4] ? r[d[4]] || "" : "", 문의ID: r["문의ID"] || "" }); }); }); acts.sort(function (a, b) { return b.일자.localeCompare(a.일자); });
    var led = ledgerRows ? ledgerRows.filter(function (r) { return r["통합ID"] === id; }) : null;
    var h = '<div class="card" id="ks-vendor"><div class="card-h"><h2>' + esc(m["대표업체명"]) + ' <span class="mini">' + esc(id) + " · 통합 분석</span></h2>" + st(m["연결상태"]) + '<button class="btn ghost rt" data-kact="vclose">닫기</button></div>';
    var cs = String(m["연결상태"] || "");
    if (/^추정/.test(cs)) h += '<div class="ks-warn" style="color:#92400E;background:#FFF4E5;border-color:#F5D9A8"><b>연결 상태 ' + esc(cs) + ':</b> 사업자등록번호로 확인되지 않은 후보 연결입니다(' + esc(m["연결근거"] || "업체명 정규화 일치") + '). 아래 낙찰·매출·활동 합산은 업체명 일치 기준의 <b>참고값</b>이며 공식 메인 구매율에는 포함되지 않습니다. 확정은 decisions/vendor_links.jsonl 승인으로만 합니다.</div>';
    else if (/검토/.test(cs)) h += '<div class="ks-warn"><b>연결 상태 검토:</b> ' + esc(m["검토사항"] || "") + ' — 자동 병합하지 않았습니다. 같은 회사로 확인되면 마스터에서 정리해 주세요.</div>';
    else if (/전용|없음/.test(cs)) h += '<div class="ks-note">이 업체는 B2B 협약 마스터에 없는 ' + esc(cs) + ' 업체입니다(협력사 아님 가능).</div>';
    h += '<div class="tiles">' + tile("POUR 낙찰", num(aw.length) + "건", "금액 " + (won(sum(aw, "낙찰금액")) || "확인 불가") + " · 공고 기록 " + nt.length + "건" + (ot.length ? " · 타사공법 " + ot.length : "")) + tile("자재 구매(연도 수)", num(mm.length), mm.map(function (r) { return r["연도"] + " " + (won(r["전체순매출"]) || "0") + (r["구매유형"] ? "(" + r["구매유형"] + ")" : ""); }).join(" · ") || "거래 없음") + tile("영업활동", num(acts.length) + "건", acts.length ? "최근 " + acts[0].일자 + " " + acts[0].유형 : "기록 없음") + tile("L2→L3", lb ? esc(lb["L3전환_확정"]) + "/" + esc(lb["유효L2"]) : "—", lb ? "공식 " + (pc(lb["공식전환율"]) || "—") + " · 검토 " + esc(lb["검토"]) : "L2 기록 없음") + tile("활동 상태", ia ? esc(ia["판정"]) : "마스터 외", ia ? (ia["마지막활동일"] ? "마지막 " + esc(ia["마지막활동일"]) + " · " + esc(ia["무활동경과일"]) + "일" : "기록 없음") + (ia["핵심협력사"] === "Y" ? " · 핵심 협력사" : "") : "") + tile("플랫폼 가입", sg.length ? esc(sg[0]["가입일자"]) : "—", sg.length ? esc(sg[0]["집계대상"]) + " · 활동 " + esc(sg[0]["활동여부"] || "—") : "7b 탭 기록 없음") + "</div>";
    h += '<div class="two"><div><div class="kv"><span>연결 근거</span><span>' + esc(m["연결근거"]) + "</span><span>출처</span><span>" + esc(m["출처"]) + "</span><span>사업자번호</span><span>" + esc(m["사업자등록번호"] || "—") + "</span><span>마스터 코드</span><span>" + esc(m["마스터업체코드"] || "—") + "</span><span>협약일</span><span>" + esc(m["협약일"] || "—") + "</span><span>주요 공종</span><span>" + esc(m["주요공종"] || "—") + "</span><span>표기(낙찰)</span><span>" + esc(m["낙찰시공사_표기"] || "—") + "</span><span>표기(이카운트)</span><span>" + esc(m["이카운트_거래처명"] || "—") + "</span><span>표기(플랫폼)</span><span>" + esc(m["플랫폼_업체명"] || "—") + "</span>" + (m["검토사항"] ? "<span>검토사항</span><span>" + esc(m["검토사항"]) + "</span>" : "") + "</div></div>";
    h += "<div>" + table("vmain", [{ k: "연도" }, { k: "구매유형" }, { k: "전체순매출", r: 1, fmt: won }, { k: "메인자재순매출", r: 1, fmt: won }, { k: "메인비중", r: 1, fmt: pc }, { k: "비고", wrap: 1 }], mm, { per: 10, empty: "이카운트 거래처로 연결된 자재 구매 기록이 없습니다(구매 기록 없음 ≠ 타사 제품 사용)" }) + "</div></div>";
    h += '<div class="card-h" style="margin-top:14px"><h2>POUR 낙찰 ' + aw.length + "건</h2></div>" + table("vaw", [{ k: "공고일" }, { k: "현장명", wrap: 1 }, { k: "공종그룹" }, { k: "낙찰시공사", l: "낙찰시공사 표기" }, { k: "연결상태", raw: 1, f: function (o) { return st(o["연결상태"]); } }, { k: "낙찰금액", r: 1, fmt: won }, { k: "낙찰금액상태" }, { k: "공고관계" }], aw, { per: 10, empty: "이 통합ID 로 연결된 POUR 낙찰 기록이 없습니다" });
    h += '<div class="card-h" style="margin-top:14px"><h2>영업활동 ' + acts.length + "건</h2></div>" + table("vact", [{ k: "일자" }, { k: "유형" }, { k: "현장명", wrap: 1 }, { k: "공종" }, { k: "상태" }, { k: "문의ID" }], acts, { per: 10, empty: "플랫폼 영업활동 기록(2025-06-24 이후)이 없습니다" });
    if (l2.length) h += '<div class="card-h" style="margin-top:14px"><h2>L2→L3 ' + l2.length + "건</h2></div>" + table("vl2", [{ k: "L2일자" }, { k: "L2현장명", l: "현장", wrap: 1 }, { k: "판정", raw: 1, f: function (o) { return st(o["판정"]); } }, { k: "판정코드" }, { k: "L3일자" }, { k: "L3유형" }, { k: "전환소요일", r: 1 }, { k: "판정근거", wrap: 1 }], l2, { per: 10 });
    h += '<div class="card-h" style="margin-top:14px"><h2>거래 원문' + (led ? " " + num(led.length) + "행 · 공급가액 " + (won(sum(led, "공급가액")) || "0") : "") + "</h2></div>" + (led ? table("vled", [{ k: "거래일자" }, { k: "전표번호" }, { k: "품목명·규격", wrap: 1 }, { k: "수량", r: 1, fmt: num }, { k: "공급가액", r: 1, fmt: wonF }, { k: "구분" }, { k: "메인자재분류" }, { k: "적요(현장명)", wrap: 1 }], led, { per: 10 }) : (V.ledgerState === "loading" ? loadingBox() : '<button class="btn ghost" data-kact="ledger">원문 불러오기</button>'));
    return h + "</div>";
  }

  /* ---------- 영업활동 ---------- */
  function activity() {
    var defs = [["7.기술자문문의", "접수일자", "협력사명", "기술자문 문의"], ["8.컨설팅요청", "등록일자", "업체", "컨설팅 요청"], ["10.공법설명회이력", "등록일", "시공사", "공법설명회"], ["9.샘플카탈로그요청", "접수일시", "업체", "샘플·카탈로그"], ["11.기타문의답변", "등록일", "업체명", "기타 문의"]];
    var months = {}; var recent = [];
    defs.forEach(function (d) { objs(d[0]).forEach(function (r) { var dt = String(r[d[1]] || ""); if (!/^\d{4}-\d{2}/.test(dt)) return; if (dt.slice(0, 4) !== V.actYear) return; var mo = dt.slice(0, 7); months[mo] = months[mo] || {}; months[mo][d[3]] = (months[mo][d[3]] || 0) + 1; recent.push({ 일자: dt.slice(0, 10), 유형: d[3], 업체: r[d[2]], 통합ID: r["통합ID"], 현장명: r["현장명"] || "", 상태: r["상태"] || r["발송여부"] || "" }); }); });
    var mrows = Object.keys(months).sort().map(function (mo) { var o = { 월: mo }; defs.forEach(function (d) { o[d[3]] = months[mo][d[3]] || 0; }); o["합계"] = defs.reduce(function (s, d) { return s + (months[mo][d[3]] || 0); }, 0); return o; });
    var h = '<div class="card"><div class="card-h"><h2>영업활동 월별 (7·8·9·10·11 탭)</h2></div>' + yearChips(V.actYear, "actyear");
    h += table("actm", [{ k: "월" }].concat(defs.map(function (d) { return { k: d[3], r: 1, fmt: num }; })).concat([{ k: "합계", r: 1, fmt: num }]), mrows, { per: 24 }) + "</div>";
    recent.sort(function (a, b) { return b.일자.localeCompare(a.일자); });
    var rows = recent.filter(function (r) { return match(r, V.q, ["업체", "통합ID", "현장명", "유형"]); });
    h += '<div class="card"><div class="card-h"><h2>활동 내역</h2></div><div class="ks-tools"><input data-kact="q" placeholder="업체 · 현장 · 유형 검색 (Enter)" value="' + esc(V.q) + '"><span class="cnt">' + num(rows.length) + '건</span><button class="btn ghost" data-kact="csv" data-id="acts">CSV</button></div>' + table("acts", [{ k: "일자" }, { k: "유형" }, { k: "업체", raw: 1, f: function (o) { return vlink(o["업체"], o["통합ID"]); } }, { k: "통합ID" }, { k: "현장명", wrap: 1 }, { k: "상태" }], rows) + "</div>";
    return h;
  }

  /* ---------- 선행지표 ---------- */
  function leadingView() {
    var h = '<div class="card"><div class="card-h"><h2>선행지표 요약 (18.선행지표요약 탭)</h2><span class="badge">[공식] 만 공식 KPI · [참고] 는 공식 아님</span></div>' + table("lead", [{ k: "지표" }, { k: "값", r: 1, fmt: function (v) { return isNum(v) && v < 1 && v > 0 ? pc(v) : num(v); } }, { k: "기준", wrap: 1 }, { k: "비고", wrap: 1 }], objs("18.선행지표요약"), { per: 30 }) + "</div>";
    h += '<div class="card"><div class="card-h"><h2>판정 집계 (16c.L2L3판정집계 탭)</h2></div>' + table("verd", [{ k: "판정코드" }, { k: "판정", wrap: 1 }, { k: "건수", r: 1, fmt: num }, { k: "공식전환율_반영" }, { k: "판단기준", wrap: 1 }], objs("16c.L2L3판정집계"), { per: 30 }) + "</div>";
    var rows = objs("16b.L2L3시공사별").filter(function (r) { return match(r, V.q, ["시공사", "통합ID"]); });
    h += '<div class="card"><div class="card-h"><h2>시공사별 L2→L3 (16b 탭)</h2></div><div class="ks-tools"><input data-kact="q" placeholder="시공사 검색 (Enter)" value="' + esc(V.q) + '"><span class="cnt">' + num(rows.length) + '개사</span><button class="btn ghost" data-kact="csv" data-id="l2l3c">CSV</button></div>' + table("l2l3c", [{ k: "시공사", raw: 1, f: VEND }, { k: "통합ID" }, { k: "L2건수", r: 1 }, { k: "유효L2", r: 1 }, { k: "L3전환_확정", l: "확정", r: 1 }, { k: "검토", r: 1 }, { k: "미전환", r: 1 }, { k: "공식전환율", r: 1, fmt: pc }, { k: "검토포함시_전환율", l: "검토 포함 시(참고)", r: 1, fmt: pc }, { k: "평균소요일_확정", r: 1 }], rows, { per: 25 }) + "</div>";
    var ia = objs("17.장기무활동").filter(function (r) { return (V.inactFilter === "all" || r["판정"] === V.inactFilter) && match(r, V.q, ["업체명", "통합ID"]); }); var cnts = {}; objs("17.장기무활동").forEach(function (r) { cnts[r["판정"]] = (cnts[r["판정"]] || 0) + 1; });
    h += '<div class="card"><div class="card-h"><h2>장기 무활동 (17.장기무활동 탭 · 기준일 2026-10-20)</h2></div><div class="ks-chips">' + [["all", "전체 " + num(objs("17.장기무활동").length)], ["정상", "정상 " + num(cnts["정상"] || 0)], ["장기 무활동", "장기 무활동 " + num(cnts["장기 무활동"] || 0)], ["활동 이력 없음", "활동 이력 없음 " + num(cnts["활동 이력 없음"] || 0)]].map(function (x) { return '<button data-kact="inact" data-id="' + esc(x[0]) + '"' + (V.inactFilter === x[0] ? ' aria-current="true"' : "") + ">" + x[1] + "</button>"; }).join("") + "</div>" + table("inact", [{ k: "통합ID" }, { k: "업체명", raw: 1, f: VEND }, { k: "핵심협력사", l: "핵심" }, { k: "판정", raw: 1, f: function (o) { return '<span class="st ' + (o["판정"] === "정상" ? "ok" : o["판정"] === "장기 무활동" ? "bad" : "na") + '">' + esc(o["판정"]) + "</span>"; } }, { k: "마지막활동일" }, { k: "무활동경과일", r: 1 }, { k: "마지막활동유형" }, { k: "활동건수_기록기간", l: "활동 건수", r: 1 }], ia, { per: 25 }) + "</div>";
    h += reviewCard();
    return h;
  }

  /* ---------- 연결 설정 ---------- */
  function link() { return modeCard() + link0(); }
  function link0() {
    var s = V.draft || S.settings() || {}; var stt = S.state; var m = stt.meta || {}, em = stt.embeddedMeta || {};
    var mode = (s.mode || "google") === "appsscript" ? "appsscript" : "google";
    var h = '<div class="card"><div class="card-h"><h2>상세 보기 연결 설정 (읽기 전용 · 시트를 공유받은 직원용)</h2><span class="badge">' + (S.configured(s) && !V.draft ? "설정 저장됨 · " + hhmm(s.savedAt) : V.draft ? "입력 중(미저장)" : "미설정") + "</span>" + (stt.signedIn ? '<span class="st ok">Google 로그인됨</span>' : "") + "</div>";
    h += '<div class="ks-chips"><button data-kact="lmode" data-id="google"' + (mode === "google" ? ' aria-current="true"' : "") + '>A. Google 로그인 (권장)</button><button data-kact="lmode" data-id="appsscript"' + (mode === "appsscript" ? ' aria-current="true"' : "") + ">B. Apps Script 공유 키 (내부 시험용)</button></div>";
    if (mode === "google") {
      h += '<p class="card-sub"><b>승인된 직원만 열람:</b> 시트를 공유받은 Google 계정으로 로그인해 Sheets API 로 직접 읽습니다. <b>단, 시트의 일반 액세스가 ‘링크가 있는 모든 사용자’이면 로그인 없이도 누구나 읽을 수 있어 이 통제가 무효입니다 — 반드시 ‘제한됨’으로 두세요.</b> 공유 키가 없고, 열람 회수는 시트 공유 해제로 끝납니다. 아래 값은 비밀이 아니며(클라이언트 ID·시트 ID) 이 브라우저에만 저장됩니다. 로그인 토큰은 탭을 닫으면 사라집니다.</p>';
      h += '<div class="form"><label>OAuth 클라이언트 ID (Google Cloud → 사용자 인증 정보 → 웹 애플리케이션)</label><input id="ks-cid" type="text" placeholder="xxxxxxxx.apps.googleusercontent.com" value="' + esc(s.clientId || "") + '"><label>스프레드시트 ID (시트 주소의 /d/ 와 /edit 사이)</label><input id="ks-sid" type="text" placeholder="1AbC…" value="' + esc(s.sheetId || "") + '">';
      h += '<div class="row"><button class="btn ghost" data-kact="ltest">Google 로그인 후 연결 테스트</button><button class="btn" data-kact="lsave">저장 후 로그인·새로고침</button>' + (stt.signedIn ? '<button class="btn ghost" data-kact="gsignout">로그아웃</button>' : "") + '<button class="btn warnb" data-kact="lclear">설정 지우기</button></div>';
    } else {
      h += '<p class="card-sub"><b>주의:</b> 공유 키를 아는 사람은 누구나 전체 데이터를 읽을 수 있어 직원별 승인·회수가 되지 않습니다. 내부 시험·임시용으로만 쓰고, 운영은 A 방식을 권장합니다. 키는 요청 본문(POST)으로만 전송되며 이 브라우저에만 저장됩니다.</p>';
      h += '<div class="form"><label>웹앱 주소 (…/exec)</label><input id="ks-ep" type="url" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(s.endpoint || "") + '"><label>액세스 키</label><input id="ks-key" type="password" placeholder="스크립트 속성 ACCESS_KEY 와 동일" value="' + esc(s.key || "") + '"><label>시트 ID (선택 — 비우면 운영 시트. 테스트 사본은 ALLOWED_SHEET_IDS 에 등록된 ID 만)</label><input id="ks-sid" type="text" placeholder="비워 두면 운영 시트" value="' + esc(s.sheetId || "") + '">';
      h += '<div class="row"><button class="btn ghost" data-kact="ltest">연결 테스트</button><button class="btn" data-kact="lsave">저장 후 새로고침</button><button class="btn warnb" data-kact="lclear">설정 지우기</button></div>';
    }
    if (V.linkMsg) h += '<div class="msg ' + V.linkMsg.cls + '">' + V.linkMsg.html + "</div>";
    h += "</div></div>";
    if (pubWanted()) return h + '<div class="card"><div class="card-h"><h2>상세 보기를 쓰려면</h2></div><ol class="ol"><li>시트 소유자가 내 Google 계정에 시트를 <b>뷰어</b>로 공유합니다.</li><li>관리자에게 OAuth 클라이언트 ID와 시트 ID를 받아 위에 입력합니다(이 브라우저에만 저장).</li><li>[저장 후 로그인·새로고침]을 누르면 상세 보기로 전환됩니다. 공개 보기로 돌아가려면 위 [공개 보기]를 누르세요.</li></ol><p class="mini">공개 보기만 필요하면 아무 설정도 필요 없습니다.</p></div>';
    h += syncInfoCard();
    h += '<div class="card"><div class="card-h"><h2>현재 데이터 상태</h2></div><div class="kv"><span>표시 중</span><span>' + (stt.mode === "live" ? "구글시트 실시간 (" + hhmm(stt.at) + ")" : stt.mode === "fallback" ? "저장된 데이터 — 연결 실패: " + esc(stt.error) : (S.noData() ? "연결 대기 (데이터 없음)" : "저장된 데이터 (연결 미설정)")) + "</span><span>저장된 데이터</span><span>" + (S.noData() ? "없음 — 이 파일에는 회사 데이터가 내장되어 있지 않습니다" : esc(em.version || "") + " · 기준일 " + esc(em.asOf || "") + " · 내보내기 " + hhmm(em.exportedAt) + " · " + esc(em.verified || "")) + "</span><span>연결 시트</span><span>" + (stt.mode === "live" ? esc(m.title || "") + " · " + (m.auth === "google" ? "Google 로그인 · " : "공유 키 · ") + (m.lastUpdated ? "수정 " + hhmm(m.lastUpdated) : "응답 " + hhmm(m.servedAt)) + " · ID " + esc(m.spreadsheetId || "") + (m.missingTabs && m.missingTabs.length ? " · 시트에 없는 탭 " + m.missingTabs.length + "개" : "") : "—") + "</span><span>확정 연도 대조</span><span>" + (stt.mode === "live" ? (stt.frozenDiff.length ? stt.frozenDiff.length + "건 차이 (요약 화면 경고 참고)" : "2022~2025 KPI 시트 값 = 검증본 값") : "실시간 연결 시 자동 대조") + "</span></div>";
    var tabs = Object.keys(em.tabs || {}); if (!tabs.length && stt.mode === "live" && m.tabs) tabs = Object.keys(m.tabs); if (tabs.length) h += '<div class="card-h" style="margin-top:14px"><h2>탭별 행 수 (저장된 데이터 ↔ 시트)</h2></div>' + table("tabs", [{ k: "탭" }, { k: "저장", r: 1, fmt: num }, { k: "시트", r: 1, fmt: num }, { k: "비고" }], tabs.map(function (t) { var a = em.tabs && em.tabs[t] ? em.tabs[t].rows : null, b = stt.mode === "live" && m.tabs && m.tabs[t] ? m.tabs[t].rows : null; return { 탭: t, 저장: a, 시트: b, 비고: b == null ? (stt.mode === "live" ? "시트에 탭 없음" : "") : a == null ? "시트에서 읽음" : a === b ? "일치" : "차이 " + (b - a) }; }), { per: 30 });
    h += "</div>";
    h += '<div class="card"><div class="card-h"><h2>설정 순서</h2></div><div class="two"><div><b>A. Google 로그인 (권장)</b><ol class="ol"><li>시트 소유자: 시트를 열람할 직원 계정에 <b>뷰어</b>로 공유</li><li>관리자: Google Cloud 콘솔에서 프로젝트 생성 → Google Sheets API 사용 설정 → OAuth 동의 화면(외부·테스트 사용자에 직원 이메일 추가) → 사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션, 승인된 JavaScript 원본 = 이 사이트 주소)</li><li>직원: 위 입력란에 클라이언트 ID·시트 ID 입력 → Google 로그인 후 연결 테스트 → 저장</li></ol></div><div><b>B. Apps Script 공유 키</b><ol class="ol"><li>시트 → 확장 프로그램 → Apps Script → Code.gs 붙여넣기</li><li>스크립트 속성 ACCESS_KEY(32자 이상)</li><li>배포 → 웹 앱 → 실행 사용자 "나" · 액세스 "모든 사용자" → URL 복사</li><li>URL·키 입력 → 연결 테스트 → 저장</li></ol></div></div><p class="mini">두 방식 모두 시트를 공개로 바꾸지 않으며 쓰기 기능이 없습니다. 어떤 ID·키도 HTML 에 들어가지 않습니다.</p></div>';
    return h;
  }

  /* ---------- 연결 대기·잠금 화면 (표시할 데이터 없음) ---------- */
  function waiting() {
    var items = ["① 전체 자재 순매출", "② POUR 낙찰", "③ POUR 반영 공고", "④ 메인 자재 순매출", "⑤ 공식 L2→L3 전환율", "⑥ 장기 무활동 협력사"], st = S.state, sy = st.sync;
    var kind = sy.status === "denied" ? "denied" : sy.status === "signedout" ? "signedout" : st.needSignIn ? "login" : st.mode === "live" ? "schema" : "wait";
    var badge = { denied: "접근 권한 없음", signedout: "로그아웃됨", login: "로그인 필요", schema: "시트 구조 경고", wait: "연결 대기" }[kind];
    var tileTxt = kind === "wait" ? "연결 대기" : kind === "login" ? "로그인 필요" : kind === "schema" ? "확인 불가" : "숨김";
    var h = '<div class="card core6"><div class="card-h"><h2>팀장 핵심 지표 6</h2><span class="badge rev">' + badge + '</span><span class="mini">조회한 데이터는 화면에 남기지 않습니다 · 임의 수치는 표시하지 않습니다</span></div><div class="tiles six">' + items.map(function (l) { return '<div class="tile"><div class="l">' + esc(l) + '</div><div class="v na">' + tileTxt + '</div><div class="s">' + (kind === "denied" ? "열람 권한이 필요합니다" : kind === "signedout" ? "다시 로그인하면 표시됩니다" : "비공개 구글시트에서 읽어옵니다") + "</div></div>"; }).join("") + "</div></div>";
    var title = { denied: "이 계정에는 시트 열람 권한이 없습니다", signedout: "로그아웃되었습니다", login: "Google 로그인이 필요합니다", schema: "1.통합KPI 탭을 읽을 수 없습니다", wait: "구글시트 연결이 필요합니다" }[kind];
    var body = kind === "schema" ? "시트에 1.통합KPI 탭이 없거나 열 구조가 바뀌어 핵심 지표를 계산할 수 없습니다. 위 경고의 탭·열을 복원하면 다음 동기화에서 자동으로 표시됩니다. 값을 0으로 대체하지 않습니다." : kind === "denied" ? "시트 소유자가 이 계정을 공유 목록에서 뺐거나, 처음부터 공유되지 않았습니다. 이전에 불러온 데이터는 화면에서 지웠고 다른 곳에 저장하지 않았습니다. 시트 소유자에게 '뷰어' 공유를 요청하거나 다른 계정으로 로그인하세요." : kind === "signedout" ? "조회한 데이터를 화면과 메모리에서 지웠습니다. 다시 로그인하면 최신 데이터를 불러옵니다." : kind === "login" ? "시트를 공유받은 직원 계정으로 로그인하면 최신 데이터를 자동으로 불러오고, 이후 5분마다 변경을 확인합니다." : "이 화면은 실제 회사 데이터를 파일에 담지 않습니다. [연결 설정]에서 OAuth 클라이언트 ID와 시트 ID를 입력하고 Google 로그인하면 25개 탭(매출·공고·낙찰·시공사·영업활동·선행지표)을 읽어 모든 카드와 상세 목록이 채워집니다. 연결 정보는 이 브라우저에만 저장됩니다.";
    h += '<div class="card"><div class="card-h"><h2>' + title + '</h2></div><p class="card-sub">' + esc(body) + " " + esc(kind === "denied" ? sy.message : "") + '</p><div class="ks-tools" style="margin:0"><button class="btn" data-kact="view" data-id="link">연결 설정 열기</button><button class="btn ghost" data-kact="vmode" data-id="public">공개 보기로 돌아가기</button>' + (kind === "login" ? '<button class="btn" data-kact="gsignin">' + ((S.settings() || {}).signedBefore ? "로그인 상태 재확인" : "Google 로그인으로 연결") + "</button>" : "") + (kind === "denied" || kind === "signedout" ? '<button class="btn" data-kact="gswitch">' + (kind === "denied" ? "다른 계정으로 로그인" : "다시 로그인") + "</button>" : "") + '</div></div>';
    return h;
  }
  /* ---------- 페이지 ---------- */
  function page() {
    try { return pageInner(); } catch (e) { return '<div class="kp ks"><div class="card"><div class="card-h"><h2>화면을 그리는 중 오류가 났습니다</h2><span class="badge rev">표시 오류</span></div><p class="card-sub">' + esc((e && e.message) || String(e)) + ' — 구글시트 연결과 저장된 업무 기록에는 영향이 없습니다. [다시 시도]로 새로 읽어 보세요.</p><div class="ks-tools" style="margin:0"><button class="btn" data-kact="refresh">다시 시도</button><button class="btn ghost" data-kact="diag">연결 진단</button><button class="btn ghost" data-kact="view" data-id="link">연결 설정</button></div></div></div>'; }
  }
  function pageInner() {
    OC = {}; var st0 = S.state;
    if (V.epoch !== st0.epoch) { ledgerRows = null; V.ledgerSrc = null; V.ledgerState = "idle"; V.detail = null; V.vendor = null; V.integrity = null; V.q = ""; V.page = {}; V.epoch = st0.epoch; }   /* 로그아웃·접근 취소 시 화면 쪽 사본도 지운다 */
    if (ledgerRows) { var lt = st0.tabs && st0.tabs[S.LEDGER]; if (!lt) { ledgerRows = null; V.ledgerSrc = null; if (V.ledgerState === "ready") V.ledgerState = "idle"; } else if (V.ledgerSrc !== lt) { ledgerRows = toObjs(lt); V.ledgerSrc = lt; } }   /* 새 스냅샷이 오면 원문 사본도 같은 버전으로 교체 */
    if (!S.state.ready) return '<div class="kp ks"><div class="card"><div class="loading">' + (S.state.decodeError ? "데이터를 열 수 없습니다: " + esc(S.state.decodeError) : "저장된 데이터 여는 중…") + "</div></div></div>";
    var ready = has("1.통합KPI");
    if (!ready && V.view !== "link") { V.detail = null; V.integrity = null; return '<div class="kp ks">' + statusBar() + nav() + (pubWanted() ? pubWaiting() : waiting()) + "</div>"; }
    if (isPub() && !/^(dash|growth|ops|data|link)$/.test(V.view)) V.view = "dash";
    var body = V.view === "dash" ? dash() : V.view === "data" ? dataView() : V.view === "growth" ? growthBody() : V.view === "ops" ? opsBody() : V.view === "home" ? home() : V.view === "sales" ? sales() : V.view === "awards" ? awards() : V.view === "vendors" ? vendors() : V.view === "activity" ? activity() : V.view === "leading" ? leadingView() : link();
    return '<div class="kp ks' + (V.view === "dash" ? ' is-dash' : '') + '">' + statusBar() + nav() + body + detailModal() + integrityModal() + "</div>";
  }
  /* 성장 분석 모듈(growth-page.js)에 넘기는 공용 도구 */
  var API = { years: years, kpiRow: kpiRow, kpiVal: kpiVal, leading: leading, pc: pc, isNum: isNum, S: S, V: V, esc: esc, won: won, num: num, hhmm: hhmm, has: has, objs: objs, csv: csv, ledger: function () { return ledgerRows; }, needLedger: needLedger, repaint: function (soft) { if (repaintRef) repaintRef(!!soft); }, goOldVendor: function (id, name) { goVendor(id, name); }, setView: function (v) { V.view = v; if (repaintRef) repaintRef(false); } };
  function opsBody() { var OV = window.B2BOpsView; if (!OV || !window.B2BOps) return '<div class="card"><div class="ks-warn">시공사 추적 모듈을 불러오지 못했습니다.</div></div>'; return OV.render(API); }
  function growthBody() { var GV = window.B2BGrowthView; if (!GV || !window.B2BGrowth) return '<div class="card"><div class="ks-warn">성장 분석 모듈을 불러오지 못했습니다.</div></div>'; return GV.render(API); }
  function goVendor(id, name) { V.detail = null; V.view = "vendors"; V.page = {}; if (id) { V.vendor = id; V.q = ""; } else { V.vendor = null; V.q = name || ""; } }
  function after(repaint) {
    repaintRef = repaint; var root = document.querySelector(".ks"); if (!root) return;
    root.addEventListener("keydown", function (e) { var a = e.target.getAttribute("data-kact"); var OVk = window.B2BOpsView; if (OVk && OVk.key && OVk.key(a, e, API)) return; var GVk = window.B2BGrowthView; if (GVk && GVk.key && GVk.key(a, e, API)) return; if (a === "q" && e.key === "Enter") { V.q = e.target.value.trim(); V.page = {}; repaint(true); } if (a === "dq" && e.key === "Enter") { V.detail.q = e.target.value.trim(); V.page["detail"] = 0; repaint(true); } if (a === "detail" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDetail(e.target.getAttribute("data-id")); repaint(true); } if (e.key === "Escape" && (V.detail || V.integrity)) { V.detail = null; V.integrity = null; repaint(true); } });
    root.addEventListener("input", function (e) { var GVi = window.B2BGrowthView; if (GVi && GVi.input && GVi.input(e.target.getAttribute("data-kact"), e, API)) return; if (/^ks-(ep|key|sid|cid)$/.test(e.target.id)) { V.draft = Object.assign({}, S.settings() || {}, V.draft || {}); V.draft.mode = V.draft.mode || (S.settings() || {}).mode || "google"; var g = function (id) { var el = document.getElementById(id); return el ? el.value : (V.draft[id === "ks-ep" ? "endpoint" : id === "ks-key" ? "key" : id === "ks-sid" ? "sheetId" : "clientId"] || ""); }; V.draft.endpoint = g("ks-ep"); V.draft.key = g("ks-key"); V.draft.sheetId = g("ks-sid"); V.draft.clientId = g("ks-cid"); return; } var a = e.target.getAttribute("data-kact"); if (a === "q" && !e.target.value) { V.q = ""; V.page = {}; repaint(true); } if (a === "dq" && !e.target.value) { V.detail.q = ""; repaint(true); } });
    root.addEventListener("change", function (e) { var a = e.target.getAttribute("data-kact"); if (!a) return; var DUc = window.B2BDashUI; if (DUc && DUc.change && DUc.change(a, e.target, API)) return; var OVc = window.B2BOpsView; if (OVc && OVc.change && OVc.change(a, e.target, API)) return; var GVc = window.B2BGrowthView; if (GVc && GVc.change && GVc.change(a, e.target, API)) return; if (a === "lyear") V.ledgerYear = e.target.value; if (a === "lkind") V.ledgerKind = e.target.value; if (a === "lmain") V.ledgerMain = e.target.value; if (a === "atrade") V.awardTrade = e.target.value; if (/^(lyear|lkind|lmain|atrade)$/.test(a)) { V.page = {}; repaint(true); } });
    root.addEventListener("click", function (e) {
      var el = e.target.closest("[data-kact]"); if (!el) return; var a = el.getAttribute("data-kact"), id = el.getAttribute("data-id");
      var DUh = window.B2BDashUI; if (DUh && DUh.handle && DUh.handle(a, el, id, API, e)) return; var OVh = window.B2BOpsView; if (OVh && OVh.handle && OVh.handle(a, el, id, API, e)) return;
      var GVh = window.B2BGrowthView; if (GVh && GVh.handle && GVh.handle(a, el, id, API, e)) return;
      if (a === "q" || a === "dq") return;
      if (a === "dclose-bg") { if (e.target === el) { V.detail = null; repaint(true); } return; }
      if (a === "dclose") { V.detail = null; repaint(true); return; }
      if (a === "integrity") { if (isPub()) { V.integrity = { pub: true }; repaint(true); return; } if (!has("1.통합KPI")) { if (S.state.needSignIn) { V.linkMsg = null; S.signIn().then(function () { repaint(true); }); return; } V.view = "link"; repaint(false); return; } var run = function () { V.integrity = verifyAll(); V.integrityBadOnly = false; repaint(true); }; if (!ledgerRows) { needLedger(); var wait = setInterval(function () { if (ledgerRows || V.ledgerState === "error") { clearInterval(wait); run(); } }, 300); V.integrity = {}; repaint(true); return; } run(); return; }
      if (a === "iclose-bg") { if (e.target === el) { V.integrity = null; repaint(true); } return; }
      if (a === "iclose") { V.integrity = null; repaint(true); return; }
      if (a === "ibad") { V.integrityBadOnly = !V.integrityBadOnly; repaint(true); return; }
      if (a === "icsv") { csv([{ k: "카드" }, { k: "보기" }, { k: "행수" }, { k: "결과" }, { k: "내용" }], V.integrityRows || [], "정합성점검_" + new Date().toISOString().slice(0, 10)); return; }
      if (a === "detail") { openDetail(id); var yy = el.getAttribute("data-year"); if (yy && V.detail && DETAILS[id].yearly) V.detail.year = yy; repaint(true); return; }
      if (a === "dyear") { V.detail.year = id; V.detail.q = ""; V.page["detail"] = 0; repaint(true); return; }
      if (a === "dsub") { V.detail.sub = id; V.detail.q = ""; V.detail.sort = null; V.page["detail"] = 0; repaint(true); return; }
      if (a === "dinc") { V.detail.inc = !V.detail.inc; V.page["detail"] = 0; repaint(true); return; }
      if (a === "sort") { var k = el.getAttribute("data-k"); var s0 = V.detail && V.detail.sort; V.detail.sort = s0 && s0.k === k ? (s0.dir === "asc" ? { k: k, dir: "desc" } : null) : { k: k, dir: "asc" }; repaint(true); return; }
      if (a === "dcsv") { detailCsv(); return; }
      if (a === "vendor") { e.preventDefault(); goVendor(id, el.getAttribute("data-name")); repaint(false); setTimeout(function () { var d = document.getElementById("ks-vendor"); if (d) d.scrollIntoView({ block: "start", behavior: "smooth" }); }, 30); return; }
      if (a === "vrow") { V.vendor = id; repaint(true); setTimeout(function () { var d = document.getElementById("ks-vendor"); if (d) d.scrollIntoView({ block: "start", behavior: "smooth" }); }, 30); return; }
      if (a === "view") { V.view = id; V.q = ""; V.page = {}; V.linkMsg = null; V.detail = null; repaint(false); return; }
      if (a === "year") { V.year = id; V.page = {}; repaint(true); return; }
      if (a === "actyear") { V.actYear = id; V.page = {}; repaint(true); return; }
      if (a === "ayear") { V.awardYear = id; V.page = {}; repaint(true); return; }
      if (a === "inact") { V.inactFilter = id; V.page = {}; repaint(true); return; }
      if (a === "pg") { V.page[id] = pageOf(id) + Number(el.getAttribute("data-d")); repaint(true); return; }
      if (a === "vclose") { V.vendor = null; repaint(true); return; }
      if (a === "cancelsync") { S.cancel(); return; }
      if (a === "copylog") { var tx = logText(); var okc = function () { V.linkMsg = { cls: "ok", html: "진단 결과를 복사했습니다(시트 내용·토큰 없음)." }; repaint(true); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(tx).then(okc, function () { window.prompt("복사하세요", tx); }); else window.prompt("복사하세요", tx); return; }
      if (a === "diag") { if (V.diagRunning) return; V.diagRunning = true; V.diag = null; V.view = "link"; repaint(false); S.diagnose(function (rep) { V.diag = rep; repaint(true); }).then(function (rep) { V.diag = rep; V.diagRunning = false; repaint(true); }, function (er) { V.diagRunning = false; V.diag = { steps: [{ name: "진단", ok: false, ms: 0, detail: String((er && er.message) || er) }], ok: false, totalMs: 0 }; repaint(true); }); return; }
      if (a === "refresh") { S.refresh().then(function () { repaint(true); }); repaint(true); return; }
      if (a === "gswitch") { V.linkMsg = null; S.signIn({ select: true }).then(function () { repaint(true); }).catch(function (err) { V.linkMsg = { cls: "bad", html: "로그인 실패: " + esc(err.message || err) }; repaint(true); }); return; }
      if (a === "ledger") { needLedger(); repaint(true); return; }
      if (a === "csv") { var def = csvDefs()[id]; if (def) csv(def.cols, def.rows, def.name); return; }
      if (a === "vmode") { V.linkMsg = null; if (id === "public") { S.setViewMode("public").then(function () { V.view = "growth"; ledgerRows = null; V.ledgerState = "idle"; repaint(false); }); repaint(true); return; } var sv = S.settings(); if (!S.configured(sv)) { V.view = "link"; V.linkMsg = { cls: "", html: "아래에 OAuth 클라이언트 ID와 시트 ID를 입력하고 [저장 후 로그인·새로고침]을 누르면 상세 보기로 전환됩니다." }; repaint(false); return; } S.setViewMode("detail").then(function () { repaint(true); }, function (er) { V.linkMsg = { cls: "bad", html: esc(er.message || er) }; repaint(true); }); repaint(true); return; }
      if (a === "lmode") { V.draft = Object.assign({}, S.settings() || {}, V.draft || {}); V.draft.mode = id; V.linkMsg = null; repaint(true); return; }
      if (a === "gsignin") { V.linkMsg = { cls: "", html: "Google 로그인 중…" }; S.signIn().then(function () { V.linkMsg = { cls: S.state.mode === "live" ? "ok" : "bad", html: S.state.mode === "live" ? "Google 로그인 · 구글시트 실시간 데이터로 전환했습니다." : "읽기 실패: " + esc(S.state.error || "로그인 필요") }; repaint(true); }).catch(function (err) { V.linkMsg = { cls: "bad", html: "로그인 실패: " + esc(err.message || err) }; repaint(true); }); repaint(true); return; }
      if (a === "gsignout") { S.signOut().then(function () { V.linkMsg = { cls: "ok", html: "로그아웃했습니다. 데이터는 연결 대기/저장된 데이터로 돌아갑니다." }; repaint(true); }); return; }
      if (a === "ltest" || a === "lsave") { var cur = Object.assign({ mode: "google" }, S.settings() || {}, V.draft || {}); var gv = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }; var s = cur.mode === "appsscript" ? { mode: "appsscript", endpoint: gv("ks-ep"), key: document.getElementById("ks-key") ? document.getElementById("ks-key").value : "", sheetId: gv("ks-sid") } : { mode: "google", clientId: gv("ks-cid"), sheetId: gv("ks-sid") }; V.draft = Object.assign({}, s);
        if (s.mode === "appsscript" && !s.endpoint) { V.linkMsg = { cls: "bad", html: "웹앱 주소를 입력하세요." }; repaint(true); return; } if (s.mode === "google" && (!s.clientId || !s.sheetId)) { V.linkMsg = { cls: "bad", html: "OAuth 클라이언트 ID 와 시트 ID 를 입력하세요." }; repaint(true); return; }
        V.linkMsg = { cls: "", html: s.mode === "google" ? "Google 로그인 창을 확인하세요… 연결 확인 중" : "연결 확인 중…" }; repaint(true);
        S.test(s).then(function (m) { var tabsN = Object.keys(m.tabs || {}).length; if (a === "lsave") { s.view = "detail"; S.saveSettings(s); V.draft = null; ledgerRows = null; V.ledgerState = "idle"; V.linkMsg = { cls: "ok", html: "연결 성공 · 저장됨: " + esc(m.title) + " (탭 " + tabsN + "개). 시트에서 읽는 중…" }; repaint(true); return S.refresh().then(function () { V.linkMsg = { cls: S.state.mode === "live" ? "ok" : "bad", html: S.state.mode === "live" ? "구글시트 실시간 데이터로 전환했습니다." : "읽기 실패: " + esc(S.state.error || "로그인 필요") }; repaint(true); }); } V.linkMsg = { cls: "ok", html: "연결 성공: " + esc(m.title) + " · 탭 " + tabsN + "개 · 응답 " + hhmm(m.servedAt || m.lastUpdated) + " (아직 저장 안 됨)" }; repaint(true); }).catch(function (err) { V.linkMsg = { cls: "bad", html: "연결 실패: " + esc(err.message || err) }; repaint(true); }); return; }
      if (a === "lclear") { S.clearSettings(); V.draft = null; ledgerRows = null; V.ledgerState = "idle"; V.linkMsg = { cls: "ok", html: "설정을 지웠습니다. 공개 보기로 돌아갑니다." }; S.refresh().then(function () { repaint(true); }); return; }
    });
  }
  function csvDefs() {
    var y = V.year; OC = {}; return {
      main: { name: "메인자재구매현황_" + y, cols: [{ k: "통합ID" }, { k: "거래처명" }, { k: "연도" }, { k: "구매유형" }, { k: "거래행수" }, { k: "전체순매출" }, { k: "메인자재순매출" }, { k: "메인비중" }, { k: "별도자재" }, { k: "기타자재" }, { k: "비고" }], rows: objs("4.메인자재구매현황").filter(function (r) { return String(r["연도"]) === y && match(r, V.q, ["거래처명", "통합ID", "구매유형"]); }) },
      ledger: { name: "거래원문", cols: (T(S.LEDGER) || { header: [] }).header.map(function (h) { return { k: h }; }), rows: (ledgerRows || []).filter(function (r) { return (V.ledgerYear === "all" || String(r["연도"]) === V.ledgerYear) && (V.ledgerKind === "all" || r["구분"] === V.ledgerKind) && (V.ledgerMain === "all" || r["메인자재분류"] === V.ledgerMain) && match(r, V.q, ["거래처명", "적요(현장명)", "품목명·규격", "전표번호", "통합ID"]); }) },
      awards: { name: "POUR공고낙찰", cols: (T("5.POUR공고낙찰") || { header: [] }).header.map(function (h) { return { k: h }; }), rows: objs("5.POUR공고낙찰").filter(function (r) { return (V.awardYear === "all" || String(r["연도"]) === V.awardYear) && (V.awardTrade === "all" || r["공종그룹"] === V.awardTrade) && match(r, V.q, ["현장명", "낙찰시공사", "통합ID", "주소", "공사명", "공고기록ID"]); }) },
      vendors: { name: "시공사마스터", cols: (T("2.시공사마스터") || { header: [] }).header.map(function (h) { return { k: h }; }), rows: objs("2.시공사마스터").filter(function (r) { return match(r, V.q, ["통합ID", "대표업체명", "낙찰시공사_표기", "이카운트_거래처명", "플랫폼_업체명", "사업자등록번호", "마스터업체코드"]); }) },
      l2l3c: { name: "시공사별L2L3", cols: (T("16b.L2L3시공사별") || { header: [] }).header.map(function (h) { return { k: h }; }), rows: objs("16b.L2L3시공사별") },
      acts: { name: "영업활동_" + V.actYear, cols: [{ k: "일자" }, { k: "유형" }, { k: "업체" }, { k: "통합ID" }, { k: "현장명" }, { k: "상태" }], rows: (function () { var out = []; [["7.기술자문문의", "접수일자", "협력사명", "기술자문 문의"], ["8.컨설팅요청", "등록일자", "업체", "컨설팅 요청"], ["10.공법설명회이력", "등록일", "시공사", "공법설명회"], ["9.샘플카탈로그요청", "접수일시", "업체", "샘플·카탈로그"], ["11.기타문의답변", "등록일", "업체명", "기타 문의"]].forEach(function (d) { objs(d[0]).forEach(function (r) { var dt = String(r[d[1]] || ""); if (dt.slice(0, 4) === V.actYear) out.push({ 일자: dt.slice(0, 10), 유형: d[3], 업체: r[d[2]], 통합ID: r["통합ID"], 현장명: r["현장명"] || "", 상태: r["상태"] || r["발송여부"] || "" }); }); }); return out; })() }
    };
  }
  /* 테스트·검증용: 모든 카드의 대조 결과를 반환 (화면 변경 없음) */
  function verifyAll() { OC = {}; var out = {}; Object.keys(DETAILS).forEach(function (id) { var D = DETAILS[id]; var yrs = D.yearly ? years() : [null]; out[id] = {}; yrs.forEach(function (y) { D.subs.forEach(function (s) { var r; var mn = missingNeeds(id); if (mn.length) r = { missing: "탭 없음/구조 변경: " + mn.join(", ") }; else { try { r = D.build({ id: id, year: y || V.year, sub: s[0], q: "", inc: false }); } catch (e) { r = { error: e.message }; } } out[id][(y ? y + "/" : "") + s[0]] = r.error ? { error: r.error } : r.loading ? { loading: true } : r.missing ? { missing: r.missing } : { rows: r.rows.length, checks: (r.checks || (r.check ? [r.check] : [])).map(function (c) { return c.cls + " " + c.text; }) }; }); }); }); return out; }
  var lastSig = "";
  function sig() { var s = S.state, y = s.sync; return [s.version, s.epoch, s.mode, s.needSignIn, s.loading, y.status, y.stale, y.lastOkAt, y.consistency.length, y.issues.missingTabs.length, y.issues.badTabs.length, y.progress ? y.progress.label : "", y.lastError ? y.lastError.code : ""].join("|"); }
  function softRepaint(n) { var a = document.activeElement; var typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest && a.closest(".ks") && String(a.value || "").length; if (typing && n < 8) { setTimeout(function () { softRepaint(n + 1); }, 1500); return; } if (document.querySelector(".ks")) repaintRef(true); }
  S.onChange(function () { if (!repaintRef || !document.querySelector(".ks")) return; var g = sig(); if (g === lastSig) return; lastSig = g; softRepaint(0); });
  setInterval(function () {
    var sy = S.state.sync, el = document.querySelector(".ks-prog");
    if (sy.status === "syncing") {
      var txt = progText(); document.querySelectorAll(".ks-prog").forEach(function (n) { n.textContent = txt; });
      var p = sy.progress, bar = document.querySelector(".ks-pbar i"); if (bar && p && p.total) bar.style.width = Math.min(100, Math.round(p.done / p.total * 100)) + "%";
      if (sy.startedAt && Date.now() - sy.startedAt > 30000 && !V.slowShown && repaintRef && document.querySelector(".ks")) { V.slowShown = true; softRepaint(0); }
    } else V.slowShown = false;
  }, 1000);
  if (window.B2BOpsView && window.B2BOpsView.attach) window.B2BOpsView.attach(API);
  window.B2BKPI = { page: page, after: after, state: V, verifyAll: verifyAll, DETAILS: DETAILS, go: function (view) { V.view = view; } };
})();
