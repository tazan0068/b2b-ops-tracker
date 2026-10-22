/* ============================================================
   B2B 업무 대시보드 — 화면 모듈 (kpi-sheet-page.js 의 '대시보드'·'데이터' 보기)
   · 이 파일은 화면(UI)만 만든다. 구글시트·Apps Script·공개 집계 API·동기화·KPI 계산 코드는 읽기만 하고 수정하지 않는다.
   · 실제로 연결된 값(1.통합KPI · 18.선행지표요약)만 표시하고, 없는 값은 0 이 아니라 '—' / '데이터 연결 예정' 으로 표시한다.
   · 추가 데이터 5종(잔디 영업보고 L2 · 고객관리카드 협약일 · 잔디 L3 · 이카운트 매출 · 행동 이력)은
     '데이터 어댑터' 한 곳만 연결하면 화면이 채워지도록 분리했다:

       B2BDashUI.connect("l2" | "mou" | "l3" | "sales" | "act", function (api, filters) { return {
         status: "connected" | "partial", asOf: "2026-10-23", source: "구글시트 탭 이름 등 원본 출처",
         stats:  { <통계 키>: 값 | { v: 값, sub: "보조 문구" } },            // 키 목록은 아래 DATASETS[*].stats
         monthly:[ { m: "2026-05", v: 12 }, … ],                           // 월별 추이
         breakdowns: { <키>: [ { name: "…", v: 12 }, … ] },                // 업체별·현장별·공종별 등
         rows:   [ { <DATASETS[*].cols 의 k 와 같은 키>: 값, verify: "ok" | "review" } , … ]   // 상세 표
       }; });

   · 같은 업체·현장·활동이 두 번 들어오면(중복 키 = DATASETS[*].dedupe) 표에서 '중복 의심'으로 표시하고 집계 건수에서 제외해 보여 준다.
   · 이 모듈은 브라우저 저장소를 쓰지 않는다(필터 상태는 메모리).
   ============================================================ */
(function () {
  "use strict";
  var U = {}; window.B2BDashUI = U;
  var MIN_SAMPLE = 30;                               /* 전년 대비를 보여 주기 위한 전년 표본(건수) 최소값 — 표시 기준일 뿐 계산식이 아님 */
  var ST = { ds: "l2", F: { year: "all", month: "all", vendor: "", trade: "all" }, page: 0 };
  var ADAPTERS = {};

  /* ---------- 데이터 5종 정의(화면 구성) ---------- */
  var DATASETS = {
    l2: { id: "l2", short: "영업보고(L2)", title: "잔디 영업보고 (L2)", icon: "note", blurb: "잔디 영업보고(L2) 건수·업체·현장·L3 연결을 봅니다.", source: "잔디 추출 엑셀 → 구글시트", desc: "영업보고 = L2. 이후 같은 업체·현장에서 L3 활동으로 이어졌는지 확인합니다.",
      stats: [["total", "전체 영업보고", "건"], ["vendors", "영업보고 업체", "곳"], ["sites", "아파트·현장", "곳"], ["linked", "L3 연결", "건"], ["unlinked", "L3 미연결", "건"]],
      monthlyTitle: "월별 영업보고 추이", breakdowns: [["vendor", "업체별 영업보고"], ["site", "아파트·현장별 영업보고"], ["trade", "공종별 영업보고"]],
      cols: [["date", "영업보고일"], ["vendor", "업체명"], ["site", "아파트명"], ["trade", "공종"], ["link", "L3 연결 여부"], ["source", "원본 출처"], ["state", "연결 상태"]], dedupe: ["date", "vendor", "site"], filters: ["year", "month", "vendor", "trade"] },
    mou: { id: "mou", short: "협약일", title: "고객관리카드 협약일", icon: "doc", blurb: "실제 MOU 협약일 기준 신규·기존 업체 구분을 봅니다.", source: "고객관리카드 → 구글시트", desc: "실제 MOU 협약 체결일 기준으로 신규 업체(협약일부터 1년)를 구분합니다.",
      stats: [["total", "전체 협약 업체", "곳"], ["fresh", "신규 업체(협약 1년 이내)", "곳"], ["dated", "협약일 등록", "곳"], ["undated", "협약일 미등록", "곳"]],
      monthlyTitle: "월별 신규 협약 현황", breakdowns: [["month", "월별 신규 협약"], ["kind", "신규·기존 구분"]],
      cols: [["vendor", "업체명"], ["code", "B2B 고유코드"], ["date", "실제 협약 체결일"], ["kind", "신규·기존 구분"], ["source", "원본 출처"]], dedupe: ["code"], filters: ["year", "month", "vendor"] },
    l3: { id: "l3", short: "L3 자료", title: "잔디 L3 자료", icon: "chat", blurb: "기술자문·공법설명회·기타문의·컨설팅내역서 요청 이력을 봅니다.", source: "잔디 추출 엑셀 → 구글시트", desc: "L3 = 기술자문문의(기술자문) · 공법설명회(PT) · 기타문의 · 컨설팅내역서 요청.",
      stats: [["advice", "기술자문문의", "건"], ["pt", "공법설명회(PT)", "건"], ["etc", "기타문의", "건"], ["consult", "컨설팅내역서 요청", "건"], ["vendors", "L3 경험 업체", "곳"]],
      monthlyTitle: "월별 L3 활동 추이", breakdowns: [["vendor", "업체별 L3 이용 이력"], ["site", "현장별 L3 이용 이력"], ["type", "활동 유형별"]],
      cols: [["date", "활동일"], ["vendor", "업체명"], ["site", "아파트명"], ["trade", "공종"], ["type", "활동 유형"], ["status", "요청 상태"], ["source", "원본 출처"]], dedupe: ["date", "vendor", "site", "type"], filters: ["year", "month", "vendor", "trade", "type"] },
    sales: { id: "sales", short: "매출(이카운트)", title: "이카운트 매출", icon: "box", blurb: "전체·메인자재 매출과 낙찰 현장 연결 현황을 봅니다.", source: "이카운트 원본 → 구글시트(3.이카운트판매원문)", desc: "전체 자재 매출과 메인자재 매출, 낙찰 현장과 자재 구매의 연결 현황을 봅니다.",
      stats: [["total", "전체 자재 매출", "원"], ["main", "메인자재 매출", "원"], ["share", "메인자재 매출 비중", "%"], ["linked", "낙찰 현장↔구매 연결", "곳"]],
      monthlyTitle: "월별 매출 추이", breakdowns: [["trade", "공종별 메인자재 매출"], ["vendor", "업체별 구매 현황"], ["site", "낙찰 현장↔구매 연결"]],
      cols: [["vendor", "업체명"], ["site", "현장명"], ["item", "품목"], ["date", "매출일"], ["amount", "금액"], ["kind", "구매 유형"]], dedupe: ["date", "vendor", "item", "amount"], filters: ["year", "month", "vendor", "trade"] },
    act: { id: "act", short: "행동 이력", title: "팀 행동 이력 관리", icon: "check", blurb: "KPI 개선을 위한 팀의 실제 행동을 기록·관리합니다.", source: "팀 입력(관리 대상)", desc: "KPI 개선을 위해 팀이 실제로 한 행동을 기록·관리합니다. 행동 유형과 운영 기준은 확정되는 대로 반영하며, 기록을 자동 생성하지 않습니다.",
      stats: [["total", "등록된 행동", "건"], ["targets", "활동 대상 업체", "곳"], ["done", "실행 완료", "건"], ["open", "진행·예정", "건"], ["follow", "후속 결과 기록", "건"]],
      monthlyTitle: "월별 실행 횟수", breakdowns: [["type", "행동 유형별"], ["owner", "담당자별"], ["kpi", "관련 KPI별"]],
      cols: [["vendor", "활동 대상 업체"], ["owner", "담당자"], ["type", "행동 유형"], ["date", "실행일"], ["count", "실행 횟수"], ["status", "실행 상태"], ["result", "후속 결과"], ["kpi", "관련 KPI"]], dedupe: ["vendor", "type", "date"], filters: ["year", "month", "vendor"],
      examples: ["신규 업체에 기술지원 안내를 했는가", "L2(영업보고) 이후 후속 자료를 제공했는가", "첫 L3 이후 재접촉했는가"] }
  };
  var ORDER = ["l2", "mou", "l3", "sales", "act"];

  /* ---------- 작은 도구 ---------- */
  var A = null;
  function esc(s) { return A.esc(s); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function ic(n) {
    var p = { note: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 13h8M8 17h6"/>', doc: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>', chat: '<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z"/>', box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>', check: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>', user: '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9.5" cy="7" r="3.5"/><path d="M19 8v6M16 11h6"/>', repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>', flow: '<circle cx="5" cy="12" r="2.5"/><circle cx="19" cy="12" r="2.5"/><path d="M8 12h8M13 8l4 4-4 4"/>', biz: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>', award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14.5L7 22l5-3 5 3-1.5-7.5"/>', bar: '<path d="M5 20V10M12 20V4M19 20v-7"/>' }[n] || "";
    return '<svg class="du-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>";
  }
  function dv(v, fmt) { if (isNum(v)) return { ok: true, t: fmt ? fmt(v) : String(v) }; return { ok: false, t: v == null || v === "" ? "—" : String(v) }; }
  function pill(kind, t) { return '<span class="du-pill ' + kind + '">' + esc(t) + "</span>"; }
  function pending() { return pill("wait", "데이터 연결 예정"); }
  function go(id, text) { return '<button class="btn ghost du-go" data-kact="dgo" data-id="' + id + '">' + esc(text || "자세히") + " →</button>"; }
  function stat(label, v, sub, fmt, big) { var r = dv(v, fmt); return '<div class="du-stat' + (r.ok ? "" : " na") + (big ? " big" : "") + '"><span class="l">' + esc(label) + "</span><b>" + esc(r.t) + "</b>" + (sub ? '<span class="s">' + sub + "</span>" : "") + "</div>"; }
  function mini(vals, labels, opt) {              /* 작은 막대(연도별) — 값이 없는 연도는 빗금 */
    var max = 0; vals.forEach(function (v) { if (isNum(v) && v > max) max = v; });
    return '<div class="du-mini" style="--n:' + vals.length + '">' + vals.map(function (v, i) { return '<div class="c"><i class="' + (isNum(v) ? "" : "na") + (labels[i].cur ? " cur" : "") + '"' + (isNum(v) ? ' style="height:' + Math.max(6, Math.round(v / max * 100)) + '%"' : "") + ' title="' + esc(labels[i].l + " · " + (isNum(v) ? (opt && opt.fmt ? opt.fmt(v) : v) : (v == null ? "—" : v))) + '"></i><span>' + esc(labels[i].s) + "</span></div>"; }).join("") + "</div>";
  }
  function ghostMonths(cols) { var h = ""; for (var i = 1; i <= 12; i++) h += '<div class="c"><i class="ghost" style="height:' + (22 + (i * 29 + (cols || 0)) % 44) + '%"></i><span>' + i + "월</span></div>"; return '<div class="du-mini big" style="--n:12" aria-hidden="true">' + h + "</div>"; }
  function monthBars(rows, fmt) {
    var max = 0; rows.forEach(function (r) { if (r.v > max) max = r.v; });
    return '<div class="du-mini big" style="--n:' + rows.length + '">' + rows.map(function (r) { return '<div class="c"><i style="height:' + Math.max(6, Math.round(r.v / max * 100)) + '%" title="' + esc(r.m + " · " + (fmt ? fmt(r.v) : r.v)) + '"></i><span>' + esc(String(r.m).slice(5) + "월") + "</span></div>"; }).join("") + "</div>";
  }

  /* ---------- 메인 대시보드 ---------- */
  function kpiCard(o) {
    var okv = !!o.ok;
    return '<article class="du-kpi ' + o.cls + (okv ? "" : " pend") + '"><div class="top"><span class="ic">' + ic(o.icon) + "</span><h3>" + esc(o.label) + '</h3><span class="du-pill ' + (okv ? "ok" : "wait") + '">' + esc(okv ? "시트 연결됨" : "데이터 연결 예정") + "</span></div>" +
      '<div class="val' + (okv ? "" : " na") + '">' + (okv ? esc(o.value) : "—") + "</div>" +
      '<p class="def">' + esc(o.def) + "</p>" +
      '<div class="yoy"><span class="l">전년 대비</span><span class="v">' + o.yoy + "</span></div>" +
      '<div class="trend"><span class="l">추이</span>' + o.trend + "</div>" +
      (o.note ? '<p class="kn">' + o.note + "</p>" : "") +
      '<div class="foot">' + go(o.to, "상세 보기") + "</div></article>";
  }
  function trendSpark(vals, labels) {
    var pts = []; vals.forEach(function (v, i) { if (isNum(v)) pts.push([i, v]); });
    if (pts.length < 2) return '<span class="du-dash">추이 — 연결 예정</span>';
    var max = Math.max.apply(null, pts.map(function (p) { return p[1]; })), min = Math.min.apply(null, pts.map(function (p) { return p[1]; })), W = 120, H = 30, n = vals.length - 1 || 1;
    var d = pts.map(function (p, i) { var x = p[0] / n * (W - 6) + 3, y = H - 4 - (max === min ? 0.5 : (p[1] - min) / (max - min)) * (H - 8); return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); }).join(" ");
    return '<svg class="du-spark" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="연도별 추이"><path d="' + d + '"/></svg>';
  }
  function render(api) {
    A = api; var ys = api.years(); if (!ys.length) return "";
    var last = ys[ys.length - 1], prev = ys[ys.length - 2], kL = api.kpiRow(last) || {}, asOf = String(kL["기준"] || "").replace(/^~/, "");
    var cats = ys.map(function (y) { return { l: y + "년" + (y === last ? " (" + asOf + "까지)" : ""), s: y.slice(2) + (y === last ? "*" : ""), cur: y === last }; });
    var col = function (c) { return ys.map(function (y) { return api.kpiVal(y, c); }); };
    var L = api.leading("[공식] L2→L3 전환율"), Lc = api.leading("[공식] L3 전환 확정"), L2n = api.leading("L2 건수"), Lr = api.leading("검토 대상");
    var okL = !!(L && isNum(L["값"]));
    /* KPI ③ 전년 대비: 전년 표본이 충분하고 값이 있을 때만(아니면 '비교 불가') */
    var pv = prev ? api.kpiVal(prev, "L2L3전환율_공식") : null, pn = prev ? api.kpiVal(prev, "L2건수_유효") : null, yoy3;
    if (!okL) yoy3 = "—"; else if (isNum(pv) && isNum(pn) && pn >= MIN_SAMPLE) { var dd = (L["값"] - pv) * 100; yoy3 = (dd >= 0 ? "▲ +" : "▼ −") + Math.abs(dd).toFixed(1) + "%p"; } else yoy3 = '<span class="du-dash">비교 불가</span><span class="s">' + esc(prev || "전년") + "년 표본 " + (isNum(pn) ? api.num(pn) + "건" : "—") + "</span>";
    var rate = ys.map(function (y) { var n = api.kpiVal(y, "L2건수_유효"), v = api.kpiVal(y, "L2L3전환율_공식"); return isNum(v) && isNum(n) && n >= MIN_SAMPLE ? v : null; });
    var h = '<div class="du">';
    h += '<header class="du-head"><div><h1>B2B 업무 성과 대시보드</h1><p>' + esc(ys[0]) + "~" + esc(last) + "년 · " + esc(last) + "년은 " + esc(asOf || "기준일") + "까지 누계(*) · 값이 없는 항목은 0 이 아니라 '—' 로 표시</p></div></header>";
    h += '<div class="du-kpis">' +
      kpiCard({ cls: "k1", icon: "user", label: "신규 업체 사용률", ok: false, def: "실제 MOU 협약일부터 1년 · 신규 업체 중 L3 활동이 발생한 업체 비율", yoy: "—", trend: '<span class="du-dash">추이 — 연결 예정</span>', note: "협약일 데이터 반영 후 표시됩니다", to: "mou" }) +
      kpiCard({ cls: "k2", icon: "repeat", label: "재사용률", ok: false, def: "기존·신규 업체 전체 · 첫 L3 이후 다른 아파트 현장에서 L3 활동이 다시 발생한 업체 비율", yoy: "—", trend: '<span class="du-dash">추이 — 연결 예정</span>', note: "L3 이력 데이터 반영 후 표시됩니다", to: "l3" }) +
      kpiCard({ cls: "k3", icon: "flow", label: "L2 → L3 전환률", ok: okL, value: okL ? api.pc(L["값"]) : "", def: "영업보고(L2) 이후 같은 업체·현장에서 L3(기술자문·공법설명회·기타문의·컨설팅내역서 요청)로 이어진 비율", yoy: yoy3, trend: trendSpark(rate, cats), note: okL ? "현재 시트 기준값" + (Lc && L2n && isNum(Lc["값"]) && isNum(L2n["값"]) ? " · " + api.num(Lc["값"]) + " ÷ " + api.num(L2n["값"]) : "") + ' · <b class="warnt">정의 정리 예정</b>' : "시트에서 값을 읽지 못했습니다", to: "l2" }) + "</div>";

    /* 2) 현황 요약 4 */
    var tot = api.leading("전체 협력사"), inact = api.leading("장기 무활동"), none = api.leading("활동 이력 없음"), core = api.leading("핵심 협력사 수");
    var tv = tot && isNum(tot["값"]) ? tot["값"] : null, ia = inact && isNum(inact["값"]) ? inact["값"] : null, nb = none && isNum(none["값"]) ? none["값"] : null, nm = inact && inact["비고"] ? Number(String(inact["비고"]).replace(/[^0-9]/g, "")) : null;
    var seg = nm && ia != null && nb != null && tv != null && nm + ia + nb === tv ? [["정상", nm, "c1"], ["장기 무활동", ia, "c2"], ["이력 없음", nb, "c3"]] : null;
    var stack = seg ? '<div class="du-stack">' + seg.map(function (x) { return '<i class="' + x[2] + '" style="flex:' + x[1] + '" title="' + esc(x[0] + " " + api.num(x[1])) + '곳"></i>'; }).join("") + '</div><div class="du-lg">' + seg.map(function (x) { return '<span><i class="du-dot ' + x[2] + '"></i>' + esc(x[0]) + " <b>" + api.num(x[1]) + "</b></span>"; }).join("") + "</div>" : "";
    var won = api.won, l3sum = null; ["기술자문문의_건수", "컨설팅요청_건수", "공법설명회_건수", "기타문의_건수"].forEach(function (c) { if (isNum(kL[c])) l3sum = (l3sum || 0) + kL[c]; });
    h += '<div class="du-t"><h2>현황 요약</h2><span>' + esc(last) + "년 " + esc(asOf) + " 누계 기준</span></div><div class=\"du-sum\">" +
      '<section class="du-card"><header><h3>업체 현황</h3><button class="btn ghost du-go" data-kact="dgo" data-id="mou">자세히 →</button></header>' + stat("전체 협력사", tv, "B2B 마스터 기준", api.num, true) + stack + '<p class="s2">핵심 협력사 ' + esc(dv(core ? core["값"] : null, api.num).t) + "곳(임시 정의)</p></section>" +
      '<section class="du-card"><header><h3>L2 · L3 활동 현황</h3><button class="btn ghost du-go" data-kact="dgo" data-id="l3">자세히 →</button></header><div class="du-pair"><div>' + stat("L2 영업보고", null, "데이터 연결 예정", null, true) + "</div><div>" + stat("L3 활동(시트 기준)", l3sum, "기술자문·컨설팅·설명회·기타", api.num, true) + '</div></div><p class="s2">기술자문 ' + esc(dv(kL["기술자문문의_건수"], api.num).t) + " · 컨설팅 " + esc(dv(kL["컨설팅요청_건수"], api.num).t) + " · 설명회 " + esc(dv(kL["공법설명회_건수"], api.num).t) + " · 기타 " + esc(dv(kL["기타문의_건수"], api.num).t) + "</p></section>" +
      '<section class="du-card"><header><h3>공고 · 낙찰 현황</h3><button class="btn ghost du-go" data-kact="view" data-id="growth">자세히 →</button></header>' + stat("POUR 낙찰", kL["POUR낙찰_건수"], "공고 " + esc(dv(kL["POUR반영공고_건수"], api.num).t) + "건 · 낙찰금액 " + esc(dv(kL["POUR낙찰금액_VAT미확인"], won).t), function (v) { return api.num(v) + "건"; }, true) + mini(col("POUR낙찰_건수"), cats, { fmt: api.num }) + "</section>" +
      '<section class="du-card"><header><h3>메인자재 매출</h3><button class="btn ghost du-go" data-kact="dgo" data-id="sales">자세히 →</button></header>' + stat("메인자재 순매출", kL["메인자재순매출"], "전체 " + esc(dv(kL["전체자재순매출"], won).t) + " · 비중 " + esc(dv(kL["메인비중"], api.pc).t), won, true) + mini(col("메인자재순매출"), cats, { fmt: won }) + "</section></div>";

    /* 3) 추이·흐름·경로 */
    var l2v = L2n && isNum(L2n["값"]) ? L2n["값"] : null, lcv = Lc && isNum(Lc["값"]) ? Lc["값"] : null, lrv = Lr && isNum(Lr["값"]) ? Lr["값"] : null;
    h += '<div class="du-t"><h2>추이 · 흐름</h2><span>월별 값은 데이터 연결 후 표시됩니다</span></div><div class="du-flowrow">' +
      '<section class="du-card wide"><header><h3>월별 활동 및 성과 추이</h3>' + pending() + "</header>" + ghostMonths(3) + '<div class="du-lg"><span><i class="du-dot c1"></i>L2 영업보고</span><span><i class="du-dot c2"></i>L3 활동</span><span><i class="du-dot c3"></i>낙찰·매출</span></div><div class="du-empty"><b>월별 데이터가 아직 연결되지 않았습니다</b><span>연결되면 월별 L2·L3 활동과 성과 추이가 이 자리에 표시됩니다. 임의 수치는 넣지 않습니다.</span></div></section>' +
      '<section class="du-card"><header><h3>L2 → L3 흐름</h3>' + pill(okL ? "ok" : "wait", okL ? "현재 시트 기준" : "데이터 연결 예정") + '</header><div class="du-flow"><div class="n"><span>L2 영업보고</span><b>' + esc(dv(l2v, api.num).t) + '</b></div><i class="ar">→</i><div class="n"><span>L3 전환 확정</span><b>' + esc(dv(lcv, api.num).t) + '</b></div></div><div class="du-rate"><span>전환률</span><b>' + (okL ? esc(api.pc(L["값"])) : "—") + '</b></div><p class="s2">검토 대상 ' + esc(dv(lrv, api.num).t) + '건은 공식 계산에서 제외 · <b class="warnt">L2·L3 정의 정리 예정</b></p></section></div>';
    h += '<div class="du-routes"><div class="du-rt-h"><h3>경로별 결과 비교</h3><span>L4 정의가 확정되면 연결됩니다</span></div>' +
      [["L2 → L3 → L4", "영업보고 후 L3를 거쳐 L4로"], ["L2 → L4", "영업보고에서 바로 L4로"], ["L3 → L4", "L3에서 L4로 (영업보고 없이)"]].map(function (r) { return '<div class="du-rt"><b>' + esc(r[0]) + "</b><span>" + esc(r[1]) + '</span><em>—</em>' + pill("wait", "데이터 연결 예정") + "</div>"; }).join("") + "</div>";

    /* 4) 추가 데이터 5종 */
    h += '<div class="du-t"><h2>추가 데이터</h2><span>화면에서 바로 확인하거나 상세 분석으로 이동합니다</span></div><div class="du-data">' +
      ORDER.map(function (id) { var d = DATASETS[id], st = statusOf(id); return '<button class="du-dcard" data-kact="dgo" data-id="' + id + '"><span class="ic">' + ic(d.icon) + '</span><b>' + esc(d.short) + "</b><span class=\"s\">" + esc(d.blurb) + "</span>" + pill(st === "connected" ? "ok" : st === "partial" ? "part" : "wait", st === "connected" ? "연결됨" : st === "partial" ? "일부 연결" : "데이터 연결 예정") + "</button>"; }).join("") + "</div>";

    /* 5) 행동 이력 */
    h += '<div class="du-t"><h2>팀 행동 이력 · 관리 대상</h2><span>KPI 개선을 위해 팀이 실제로 한 행동</span></div><section class="du-card du-act"><div class="du-actg">' +
      stat("등록된 행동", null, "", null) + stat("관리 대상 업체", null, "", null) + stat("실행 완료", null, "", null) + stat("진행·예정", null, "", null) + stat("후속 결과 기록", null, "", null) + '</div><div class="du-actb">' + pill("wait", "데이터 연결 예정") + '<p class="s2">행동 유형과 운영 기준이 확정되면 기록을 시작합니다. 기록은 자동 생성하지 않습니다.</p>' + go("act", "행동 이력 관리") + "</div></section>";
    h += '<p class="du-note">공고·낙찰·메인자재의 증감과 동일기간 비교는 <a class="vlink" data-kact="view" data-id="growth">성장 분석</a>에서 볼 수 있습니다. 데이터는 구글시트에서 자동 집계된 값이며 시공사·현장·거래 명세는 포함하지 않습니다.</p>';
    return h + "</div>";
  }

  /* ---------- 데이터 연결 상태 ---------- */
  function builtin(id) {                               /* 이미 연결된 값만 쓰는 일부 연결(이카운트 매출: 1.통합KPI 연도별 값) */
    if (id !== "sales" || !A) return null;
    var ys = A.years(); if (!ys.length) return null; var last = ys[ys.length - 1], k = A.kpiRow(last) || {};
    if (!isNum(k["전체자재순매출"])) return null;
    return { status: "partial", asOf: String(k["기준"] || ""), source: "1.통합KPI (연도별 집계) — 월별·업체별·상세는 연결 예정", stats: { total: k["전체자재순매출"], main: k["메인자재순매출"], share: k["메인비중"] }, builtin: true };
  }
  function adapterData(id, api) {
    var fn = ADAPTERS[id]; if (fn) { try { return fn(api, ST.F) || null; } catch (e) { return { error: String(e && e.message || e) }; } }
    return builtin(id);
  }
  function statusOf(id) { var d = (ADAPTERS[id] ? adapterData(id, A) : builtin(id)); if (!d || d.error) return "pending"; return d.status === "connected" ? "connected" : "partial"; }

  /* ---------- 데이터 화면(5종 공통 컴포넌트) ---------- */
  function filtersBar(d, spec, enabled, rows) {
    var yrs = {}, trades = {}, types = {};
    (rows || []).forEach(function (r) { var dt = String(r.date || "").slice(0, 4); if (/^\d{4}$/.test(dt)) yrs[dt] = 1; if (r.trade) trades[r.trade] = 1; if (r.type) types[r.type] = 1; });
    var sel = function (k, label, opts) { return '<label class="f"><span>' + esc(label) + '</span><select data-kact="dfil" data-id="' + k + '"' + (enabled ? "" : " disabled") + '><option value="all">전체</option>' + opts.map(function (o) { return '<option value="' + esc(o) + '"' + (ST.F[k] === o ? " selected" : "") + ">" + esc(o) + "</option>"; }).join("") + "</select></label>"; };
    var months = []; for (var m = 1; m <= 12; m++) months.push(String(m).padStart(2, "0"));
    var h = '<div class="du-filters">' + (spec.filters.indexOf("year") >= 0 ? sel("year", "연도", Object.keys(yrs).sort()) : "") + (spec.filters.indexOf("month") >= 0 ? sel("month", "월", months) : "") +
      (spec.filters.indexOf("vendor") >= 0 ? '<label class="f grow"><span>업체</span><input type="search" data-kact="dfilv" placeholder="업체명 검색" value="' + esc(ST.F.vendor) + '"' + (enabled ? "" : " disabled") + "></label>" : "") +
      (spec.filters.indexOf("trade") >= 0 ? sel("trade", "공종", Object.keys(trades).sort()) : "") + (spec.filters.indexOf("type") >= 0 ? sel("type", "활동 유형", Object.keys(types).sort()) : "") + "</div>";
    return h + (enabled ? "" : '<p class="du-hint">필터는 데이터가 연결되면 활성화됩니다.</p>');
  }
  function dedupe(rows, keys) {
    var seen = {}, dup = 0; rows.forEach(function (r) { var k = r.key || keys.map(function (c) { return String(r[c] == null ? "" : r[c]).trim().toLowerCase(); }).join("|"); if (seen[k]) { r._dup = true; dup++; } else seen[k] = 1; });
    return dup;
  }
  function applyFilters(rows) {
    var F = ST.F; return rows.filter(function (r) { var dt = String(r.date || ""); return (F.year === "all" || dt.slice(0, 4) === F.year) && (F.month === "all" || dt.slice(5, 7) === F.month) && (!F.vendor || String(r.vendor || "").toLowerCase().indexOf(F.vendor.toLowerCase()) >= 0) && (F.trade === "all" || r.trade === F.trade) && (F.type === undefined || F.type === "all" || r.type === F.type); });
  }
  function verifyChip(r) { if (r._dup) return pill("bad", "중복 의심"); if (r.verify === "ok") return pill("ok", "확인 완료"); if (r.verify === "review") return pill("part", "검증 필요"); return pill("wait", "미검증"); }
  function renderData(api) {
    A = api; if (!DATASETS[ST.ds]) ST.ds = "l2"; var spec = DATASETS[ST.ds], d = adapterData(ST.ds, api), err = d && d.error, connected = d && !err, hasRows = connected && d.rows && d.rows.length;
    var h = '<div class="du"><header class="du-head"><div><h1>데이터</h1><p>추가 데이터 5종 · 연결되면 이 화면이 그대로 채워집니다. 없는 값은 0 이 아니라 \'—\' 로 표시합니다.</p></div></header>';
    h += '<div class="du-tabs" role="tablist">' + ORDER.map(function (id) { var s = DATASETS[id], on = id === ST.ds; return '<button role="tab" aria-selected="' + on + '" data-kact="dds" data-id="' + id + '"' + (on ? ' aria-current="true"' : "") + '><span class="ic">' + ic(s.icon) + "</span>" + esc(s.short) + "</button>"; }).join("") + "</div>";
    var st = statusOf(ST.ds);
    h += '<section class="du-card du-dhead"><div><h2>' + esc(spec.title) + "</h2><p>" + esc(spec.desc) + '</p><p class="src"><b>원본 출처</b> ' + esc(connected && d.source ? d.source : spec.source) + (connected && d.asOf ? " · 기준일 " + esc(d.asOf) : "") + "</p></div>" + pill(st === "connected" ? "ok" : st === "partial" ? "part" : "wait", st === "connected" ? "연결됨" : st === "partial" ? "일부 연결" : "데이터 연결 예정") + "</section>";
    if (err) h += '<div class="ks-warn"><b>데이터를 표시하지 못했습니다.</b> ' + esc(d.error) + "</div>";
    if (spec.examples) h += '<section class="du-card"><h3 class="du-h3">기록할 수 있는 행동 예시</h3><ul class="du-ex">' + spec.examples.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + '</ul><p class="du-hint">행동 유형과 운영 기준이 확정되면 반영합니다. 기록을 자동으로 만들지 않습니다.</p></section>';
    /* 통계 */
    h += '<div class="du-stats">' + spec.stats.map(function (s) { var raw = connected && d.stats ? d.stats[s[0]] : null, sub = raw && typeof raw === "object" ? raw.sub : "", v = raw && typeof raw === "object" ? raw.v : raw, fmt = s[2] === "원" ? api.won : s[2] === "%" ? api.pc : api.num; var r = dv(v, fmt); return '<div class="du-stat big' + (r.ok ? "" : " na") + '"><span class="l">' + esc(s[1]) + "</span><b>" + esc(r.t) + (r.ok && s[2] !== "원" && s[2] !== "%" ? "<small>" + esc(s[2]) + "</small>" : "") + "</b>" + (sub ? '<span class="s">' + esc(sub) + "</span>" : (r.ok ? "" : '<span class="s">데이터 연결 예정</span>')) + "</div>"; }).join("") + "</div>";
    /* 필터 */
    var rowsAll = hasRows ? d.rows.map(function (r) { var c = {}; for (var k in r) c[k] = r[k]; return c; }) : [];
    var dupN = hasRows ? dedupe(rowsAll, spec.dedupe) : 0, rows = hasRows ? applyFilters(rowsAll) : [];
    h += filtersBar(d, spec, !!hasRows, rowsAll);
    /* 월별 + 분석 */
    h += '<div class="du-dgrid"><section class="du-card wide"><header><h3>' + esc(spec.monthlyTitle) + "</h3>" + (connected && d.monthly && d.monthly.length ? "" : pending()) + "</header>" + (connected && d.monthly && d.monthly.length ? monthBars(d.monthly, ST.ds === "sales" ? api.won : api.num) : ghostMonths(ORDER.indexOf(ST.ds)) + '<div class="du-empty"><b>월별 데이터가 아직 연결되지 않았습니다</b><span>연결되면 월별 추이가 이 자리에 표시됩니다.</span></div>') + "</section>";
    spec.breakdowns.forEach(function (b) {
      var list = connected && d.breakdowns && d.breakdowns[b[0]] ? d.breakdowns[b[0]] : null, max = 0; if (list) list.forEach(function (x) { if (x.v > max) max = x.v; });
      h += '<section class="du-card"><header><h3>' + esc(b[1]) + "</h3>" + (list ? "" : pending()) + "</header>" + (list ? '<ol class="du-rank">' + list.slice(0, 8).map(function (x) { return '<li><span class="n">' + esc(x.name) + '</span><i><u style="width:' + Math.max(3, Math.round(x.v / max * 100)) + '%"></u></i><b>' + esc(ST.ds === "sales" ? api.won(x.v) : api.num(x.v)) + "</b></li>"; }).join("") + "</ol>" : '<ol class="du-rank ghost" aria-hidden="true"><li><span class="n"></span><i><u style="width:70%"></u></i><b></b></li><li><span class="n"></span><i><u style="width:52%"></u></i><b></b></li><li><span class="n"></span><i><u style="width:36%"></u></i><b></b></li></ol><p class="du-hint">연결되면 상위 항목이 표시됩니다.</p>') + "</section>";
    });
    h += "</div>";
    /* 검증 상태 + 상세 표 */
    var okN = rows.filter(function (r) { return !r._dup && r.verify === "ok"; }).length, revN = rows.filter(function (r) { return !r._dup && r.verify === "review"; }).length, unN = rows.filter(function (r) { return !r._dup && r.verify !== "ok" && r.verify !== "review"; }).length;
    h += '<section class="du-card"><header><h3>상세 목록</h3><div class="du-vs">' + (hasRows ? pill("ok", "확인 완료 " + okN) + pill("part", "검증 필요 " + revN) + pill("wait", "미검증 " + unN) + pill(dupN ? "bad" : "wait", "중복 의심 " + dupN) : pill("wait", "검증 상태 — 데이터 연결 예정")) + "</div></header>";
    var PER = 25, pages = Math.max(1, Math.ceil(rows.length / PER)); if (ST.page >= pages) ST.page = pages - 1; if (ST.page < 0) ST.page = 0;
    h += '<div class="du-tw"><table class="du-tbl"><thead><tr>' + spec.cols.map(function (c) { return "<th>" + esc(c[1]) + "</th>"; }).join("") + "<th>검증</th></tr></thead><tbody>";
    if (hasRows) rows.slice(ST.page * PER, ST.page * PER + PER).forEach(function (r) { h += "<tr" + (r._dup ? ' class="dup"' : "") + ">" + spec.cols.map(function (c) { var v = r[c[0]]; var t = c[0] === "amount" ? dv(v, api.won).t : v == null || v === "" ? "—" : String(v); return '<td class="' + (c[0] === "amount" ? "r" : "") + '" data-l="' + esc(c[1]) + '">' + esc(t) + "</td>"; }).join("") + '<td data-l="검증">' + verifyChip(r) + "</td></tr>"; });
    else h += '<tr><td class="empty" colspan="' + (spec.cols.length + 1) + '"><b>데이터 연결 예정</b><span>' + esc(spec.title) + " 데이터가 구글시트에 반영되면 이 표에 행이 표시됩니다. 기록은 자동으로 만들지 않습니다.</span></td></tr>";
    h += "</tbody></table></div>";
    h += '<div class="du-pg"><span>' + (hasRows ? api.num(rows.length) + "건" + (rows.length !== rowsAll.length ? " (필터 적용)" : "") : "0건") + '</span><span class="sp"></span><button class="btn ghost" data-kact="dpg" data-id="-1"' + (hasRows && ST.page > 0 ? "" : " disabled") + '>이전</button><span>' + (ST.page + 1) + " / " + pages + '</span><button class="btn ghost" data-kact="dpg" data-id="1"' + (hasRows && ST.page < pages - 1 ? "" : " disabled") + '>다음</button></div></section>';
    h += '<p class="du-note">같은 업체·현장·활동(' + esc(spec.dedupe.map(function (k) { var c = spec.cols.filter(function (x) { return x[0] === k; })[0]; return c ? c[1] : k; }).join(" · ")) + ')이 두 번 들어오면 \'중복 의심\'으로 표시하고 집계 건수에서 제외합니다. 각 행에는 검증 상태(확인 완료·검증 필요·미검증)가 표시됩니다.</p>';
    return h + "</div>";
  }

  /* ---------- 상호작용 ---------- */
  U.render = render; U.renderData = renderData; U.connect = function (id, fn) { ADAPTERS[id] = fn; };
  U.datasets = DATASETS; U.state = ST;
  U.handle = function (a, el, id, api, e) {
    if (a.charAt(0) !== "d") return false; A = api;
    if (a === "dgo") { if (id === "growth-none") return true; ST.ds = id; ST.page = 0; api.V.view = "data"; api.V.page = {}; api.repaint(false); try { window.scrollTo(0, 0); } catch (x) {} return true; }
    if (a === "dds") { ST.ds = id; ST.page = 0; ST.F = { year: "all", month: "all", vendor: "", trade: "all" }; api.repaint(true); return true; }
    if (a === "dpg") { ST.page += Number(id) || 0; api.repaint(true); return true; }
    return false;
  };
  U.change = function (a, t, api) {
    A = api; if (a === "dfil") { ST.F[t.getAttribute("data-id")] = t.value; ST.page = 0; api.repaint(true); return true; }
    if (a === "dfilv") { ST.F.vendor = String(t.value || "").trim(); ST.page = 0; api.repaint(true); return true; }
    return false;
  };
})();
