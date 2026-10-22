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
  /* 참고값(보존): 기존 지표와 새 기준(L3 도달률 합산)은 분자·분모 정의가 달라 직접 비교하지 않는다. 값은 바꾸지 않고 출처와 함께 보여 준다 */
  var REFERENCE_VALUES = [{ key: "team", label: "팀장 회의 기준", value: "24.9%", calc: "231 ÷ 929", note: "2026-10-15 회의 표 · 고객관리카드 B2B KPI 탭 임시 고정값 · 929의 산출 규칙 미확인" }];
  var PERIOD_START = "2025-06-24";
  var PERIOD_NOTE = "시공사별 활동·전환·성과를 동일 기준으로 추적하기 위한 공통 분석 시작일입니다. 기준일 이전의 기록은 과거 참고자료로 분리하며, 기준일 이후의 검증된 데이터를 중심으로 집계합니다.";
  var PATHS = [
    { id: "p1", n: "L2 → L3 → L4", d: "영업보고 → 기술지원 → 공고·낙찰", needL2: true },
    { id: "p2", n: "L2 → L4", d: "L3 없이 공고·낙찰로 진행 · 별도 추적", needL2: true },
    { id: "p3", n: "L3 → L4", d: "L2 없이 L3 직접 진입 후 공고·낙찰", needL2: false },
    { id: "p4", n: "L2 → L3 (L4 미발생)", d: "영업보고 후 기술지원까지, 공고 전", needL2: true },
    { id: "p5", n: "L3 직접 진입 (L4 미발생)", d: "L2 없이 기술지원만 발생", needL2: false },
    { id: "p6", n: "L2만 발생", d: "영업보고만 있고 다음 단계 없음", needL2: true },
    { id: "p7", n: "다른 아파트 재사용", d: "같은 시공사가 다른 현장에서 L3 재이용", needL2: false }
  ];
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
      stats: [["advice", "기술자문문의", "건"], ["pt", "공법설명회(PT)", "건"], ["etc", "기타문의", "건"], ["consult", "컨설팅내역서 요청", "건"], ["vendors", "L3 경험 업체", "곳"], ["via", "L2 경유 L3 현장", "곳"], ["direct", "L3 직접 진입 현장", "곳"], ["reach", "L3 도달 업체×현장(합산)", "건"]],
      monthlyTitle: "월별 L3 활동 추이", breakdowns: [["vendor", "업체별 L3 이용 이력"], ["site", "현장별 L3 이용 이력"], ["type", "활동 유형별"]],
      cols: [["date", "활동일"], ["vendor", "업체명"], ["site", "아파트명"], ["trade", "공종"], ["type", "활동 유형"], ["route", "진입 경로(L2 경유/직접)"], ["status", "요청 상태"], ["source", "원본 출처"]], dedupe: ["date", "vendor", "site", "type"], filters: ["year", "month", "vendor", "trade", "type"] },
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
    var st = o.state || (o.ok ? "ok" : "wait"), okv = st === "ok", rv = st === "review";
    var pillT = okv ? "연결됨" : rv ? (o.pill || "검증 필요") : "데이터 연결 예정", pillC = okv ? "ok" : rv ? "rev" : "wait";
    return '<article class="du-kpi ' + o.cls + (okv ? "" : " pend") + (rv ? " rev" : "") + '"><div class="top"><span class="ic">' + ic(o.icon) + "</span><h3>" + esc(o.label) + '</h3><span class="du-pill ' + pillC + '">' + esc(pillT) + "</span></div>" +
      '<div class="val' + (okv ? "" : rv ? " rv" : " na") + '">' + (okv ? esc(o.value) : rv ? esc(o.vtext || "검증 필요") : "—") + "</div>" +
      '<p class="def">' + esc(o.def) + "</p>" + (o.goal ? goalBlock(o.goal) : "") + (o.dates ? '<div class="dfs"><span class="dl">기준 날짜</span>' + o.dates.map(function (x) { return "<i>" + esc(x) + "</i>"; }).join("") + "</div>" : "") +
      (o.parts ? '<div class="parts">' + o.parts.map(function (p) { return '<span><em>' + esc(p[0]) + "</em><b>" + esc(p[1]) + "</b></span>"; }).join("") + "</div>" : "") +
      '<div class="yoy"><span class="l">전년 대비</span><span class="v">' + o.yoy + "</span></div>" +
      '<div class="trend"><span class="l">추이</span>' + o.trend + "</div>" +
      (o.refs ? '<div class="refs"><span class="rh">' + esc(o.refHead || "참고값(보존)") + '</span>' + o.refs.map(function (r) { return '<div class="r"><span>' + esc(r.label) + "</span><b>" + esc(r.value) + "</b>" + (r.calc ? "<small>" + esc(r.calc) + "</small>" : "") + "</div>"; }).join("") + "</div>" : "") +
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
  /* KPI ③ L3 도달률(합산): L2 경유 L3 + L3 직접 진입. 분모 기준이 확정되기 전에는 비율을 만들지 않고 '검증 필요'로 표시한다.
     연결: B2BDashUI.connect("kpi3", function (api) { return { status: "verified" | "review", value: 0.123, numerator: n, denominator: n, basis: "분모 기준 설명", asOf: "YYYY-MM-DD",
            routes: { via: n, direct: n, l3l4: n, l2l4: n } }; });  — status 가 verified 이고 value 가 숫자일 때만 비율이 표시된다 */
  function kpi3Spec(api, L, Lc, L2n, okL) {
    var d = null; if (ADAPTERS.kpi3) { try { d = ADAPTERS.kpi3(api) || null; } catch (e) { d = null; } }
    var verified = !!(d && d.status === "verified" && isNum(d.value)), R = d && d.routes || {};
    var rf = []; if (okL) rf.push({ label: "기존 L2→L3 전환률(업무트래커)", value: api.pc(L["값"]), calc: Lc && L2n && isNum(Lc["값"]) && isNum(L2n["값"]) ? api.num(Lc["값"]) + " ÷ " + api.num(L2n["값"]) + " · 구 정의(L2=기술자문문의)" : "구 정의" });
    REFERENCE_VALUES.forEach(function (r) { rf.push({ label: r.label, value: r.value, calc: r.calc }); });
    var pv = function (v) { return isNum(v) ? api.num(v) + "곳" : "—"; };
    var PT3 = periodTab(api), cb = PT3 && PT3.get("L3 도달률", "L3 도달 업체×현장 조합(합산 분자 후보)"), cf = PT3 && PT3.get("L3 도달률", "└ 연결 확정 조합"), cr3 = PT3 && PT3.get("L3 도달률", "└ 연결 검토 조합"), dr = PT3 && PT3.get("L3 도달률", "L3 직접진입 확정");
    var out3 = { cls: "k3", icon: "flow", label: "L3 도달률", state: verified ? "ok" : "review", value: verified ? api.pc(d.value) : "",
      def: "L2(영업보고)를 거친 경우 + L3에 직접 진입한 경우를 합산 · L3 = 기술자문문의 · 공법설명회(PT) · 기타문의 · 컨설팅내역서 요청 · 분모는 업체×현장 고유 조합 등 후보를 검증한 뒤 확정",
      dates: ["L2 영업보고일", "L3 활동일"],
      parts: [["L2 경유 L3", pv(R.via)], ["L3 직접 진입", pv(R.direct)]], yoy: '<span class="du-dash">검증 필요</span>', trend: '<span class="du-dash">추이 — 검증 후 표시</span>', refs: rf,
      note: verified ? esc(d.basis || "") : "분모 기준이 확정되지 않았거나 데이터가 부족해 비율을 계산하지 않았습니다. 기존 9.56%·24.9%는 정의가 달라 참고값으로만 보존합니다.", to: "l3" };
    if (!verified && cb && isNum(cb["값"])) {
      out3.parts = [["L2 경유 L3", "구분 불가(영업보고 원천 없음)"], ["L3 직접 진입", (dr && isNum(dr["값"]) ? "확정 " + api.num(dr["값"]) : "—") + " · 경로 확인 필요"]];
      out3.note = "분자 후보: L3 도달 업체×현장 조합 " + api.num(cb["값"]) + "건(연결 확정 " + (cf ? api.num(cf["값"]) : "—") + " · 검토 " + (cr3 ? api.num(cr3["값"]) : "—") + "). 모든 L3가 영업보고 없이 확인되므로 직접진입으로 확정하지 않고 경로 확인 필요로 둡니다. L3만으로 분모를 만들면 100%가 되므로 분모는 확정 전입니다. 기존 9.56%·24.9%는 참고값.";
    }
    return out3;
  }
  /* KPI ①②: 신규 업체 사용률 · 재사용률. 운영 시트(25탭)·공개 집계(1.통합KPI, 18.선행지표요약)에는 계산값이 없어 '데이터 확인 필요'로 표시한다.
     연결: B2BDashUI.connect("kpi1" | "kpi2", function (api) { return { status: "verified", value: 0.123, basis: "분자·분모 설명", asOf: "YYYY-MM-DD" }; }) — verified + 숫자일 때만 비율 표시 */
  /* 20.기간KPI집계: 분석 기준일 이후 익명 집계(숫자·일반 라벨) — 공개·로그인 화면 공통. 없으면 null */
  function periodTab(api) {
    if (!api.has || !api.has("20.기간KPI집계")) return null; var rows = api.objs("20.기간KPI집계"); if (!rows.length) return null; var by = {};
    rows.forEach(function (r) { by[r["구분"] + "|" + r["지표"]] = r; });
    return { rows: rows, get: function (g, l) { return by[g + "|" + l] || null; }, val: function (g, l) { var r = by[g + "|" + l]; return r && isNum(r["값"]) ? r["값"] : null; }, list: function (g) { return rows.filter(function (r) { return r["구분"] === g; }); } };
  }
  function pMonth(x) { return String(x == null ? "" : x).replace(/^M/, ""); }          /* 시트에는 M2025-06 으로 적혀 있음(시트가 날짜로 자동 변환하지 않게) */
  function pFrac(api, r) { return r && isNum(r["분자"]) && isNum(r["분모"]) ? api.num(r["분자"]) + " / " + api.num(r["분모"]) + "곳" : "—"; }
  function kpi12Period(id, api, spec, verified) {
    var PT = periodTab(api); if (!PT || verified) return spec;
    if (id === "kpi1") {
      var g = "신규 업체 사용률", t = PT.get(g, "대상 신규 업체(협약일이 분석 시작일 이후)"), d = PT.get(g, "관측 완료(협약 후 1년 경과)"), n = PT.get(g, "관측 중(협약 후 1년 미만)"), u = PT.get(g, "협약일 미확인·L3 활동 있음(판정 제외)"), pr = PT.get(g, "분석 시작일 이전 협약·1년 이내(부분 관측 참고)");
      if (!t) return spec;
      var nd = PT.get(g, "협약일 없는 체결 확정 업체(판정 제외)"), nl = PT.get(g, "협약일 미확인·L3 활동 있음(판정 제외)");
      if (isNum(t["분자"]) && isNum(t["분모"]) && t["분모"] > 0 && isNum(t["값"]) && Math.abs(t["값"] - t["분자"] / t["분모"]) < 0.0005) {                        /* 카드 협약일 기준 집계(20.기간KPI집계의 분자·분모에서 읽음 — 코드에 숫자를 두지 않는다) */
        spec.state = "ok"; spec.value = p1(t["분자"] / t["분모"]);
        spec.def = "현재까지 확인된 사용률 · 2025.06.24 이후 협약 업체 기준";
        spec.parts = [["협약 후 1년 이내 L3 이용 / 대상", pFrac(api, t)], ["1년 관측 완료 업체 사용률", d && isNum(d["분모"]) && d["분모"] > 0 ? p1(d["분자"] / d["분모"]) + " (" + pFrac(api, d) + ")" : "—"]];
        spec.note = "협약 후 1년이 지나지 않은 업체" + (n && isNum(n["분모"]) ? " " + api.num(n["분모"]) + "곳" : "") + "이 포함되어 있어 <b>최종 1년 사용률이 아닙니다</b>(관측 중 이용 " + pFrac(api, n) + "). 이용 = 협약일 후 1년 이내 유효 L3 활동. 협약일은 고객관리카드 기준이며, 협약일이 없는 체결 확정 업체 " + (nd ? api.num(nd["값"]) : "—") + "곳은 이 지표의 분자·분모에서만 제외하고 다른 시공사 분석에는 포함합니다" + (nl ? "(그중 L3 활동 있음 " + api.num(nl["값"]) + "곳)" : "") + ".";
        spec.trend = '<span class="du-dash">추이 — 월별 집계 연결 후 표시</span>';
        return spec;
      }
      spec.vtext = d && isNum(d["분모"]) ? api.num(d["분자"]) + " / " + api.num(d["분모"]) + "곳 (관측 완료)" : "—";
      spec.parts = [["대상(협약 2025.06.24~) 중 이용", pFrac(api, t)], ["관측 중(1년 미만) 이용", pFrac(api, n)]];
      spec.note = "이용 = 협약일 후 1년 이내 L3 활동. 관측 중 업체는 아직 1년이 지나지 않아 확정 비율이 아닙니다. 협약일 미확인 L3 업체 " + (u ? api.num(u["값"]) : "—") + "곳은 판정에서 제외, 시작일 이전 협약(부분 관측 참고) " + pFrac(api, pr) + ". 작업본 계산 · 검증 필요.";
    } else if (id === "kpi2") {
      var r = PT.get("재사용률", "기간 내 관측 재사용률(첫 L3 이후 다른 아파트에서 다시 L3)"), sm = PT.get("재사용률", "같은 아파트 반복만 있는 업체(재사용 아님)");
      if (!r || !isNum(r["값"])) return spec;
      spec.vtext = api.pc(r["값"]); spec.parts = [["재사용 업체 / 대상", pFrac(api, r)], ["같은 아파트 반복만", sm ? api.num(sm["값"]) + "곳" : "—"]];
      spec.note = "기간 내 관측 재사용률: 분석 기간 내 첫 L3 이후 다른 아파트에서 다시 L3를 이용한 시공사 비율(같은 아파트 반복 문의 제외). 분석 시작일 이전 첫 이용은 알 수 없고, 잔디 기술문의는 업체 미기재라 하한값입니다. 작업본 계산 · 검증 필요.";
    }
    spec.pill = "검증 필요"; spec.trend = '<span class="du-dash">추이 — 월별 집계 연결 후 표시</span>';
    return spec;
  }
  /* ---------- 팀장 목표 달성 현황: 목표(설정 B2B_KPI_TARGETS)와 실적(시트 집계)을 분리해 화면에서 비교한다 ---------- */
  function TG() { return typeof window !== "undefined" && window.B2B_KPI_TARGETS || null; }
  function p1(v) { return (Math.round(v * 1000) / 10).toFixed(1) + "%"; }                     /* 0.6 → 60.0% */
  function pt(v) { return String(Math.round(v * 1000) / 10) + "%"; }                          /* 0.85 → 85% (목표 표기) */
  function goalCurrent(id, api) {
    var PT = periodTab(api); if (!PT && id !== "kpi3") return null;
    if (id === "kpi1") {
      var g = "신규 업체 사용률", t = PT.get(g, "대상 신규 업체(협약일이 분석 시작일 이후)"), d = PT.get(g, "관측 완료(협약 후 1년 경과)"), okR = function (r) { return r && isNum(r["분자"]) && isNum(r["분모"]) && r["분모"] > 0 && isNum(r["값"]) && Math.abs(r["값"] - r["분자"] / r["분모"]) < 0.0005; };
      if (!okR(t)) return null;
      return { value: t["분자"] / t["분모"], num: t["분자"], den: t["분모"], label: "현재까지 확인된 사용률(관측 진행 중 포함)", src: "20.기간KPI집계 · 신규 업체 사용률 · 대상 신규 업체", done: okR(d) ? { value: d["분자"] / d["분모"], num: d["분자"], den: d["분모"] } : null };
    }
    if (id === "kpi2") {
      var r = PT.get("재사용률", "기간 내 관측 재사용률(첫 L3 이후 다른 아파트에서 다시 L3)");
      return r && isNum(r["값"]) ? { value: r["값"], num: r["분자"], den: r["분모"], label: "기간 내 관측 재사용률(60일 제한 없음)", src: "20.기간KPI집계 · 재사용률" } : null;
    }
    if (id === "kpi3") {
      var d3 = null; if (ADAPTERS.kpi3) { try { d3 = ADAPTERS.kpi3(api) || null; } catch (e) { d3 = null; } }
      return d3 && d3.status === "verified" && isNum(d3.value) ? { value: d3.value, num: d3.numerator, den: d3.denominator, label: "L3 도달률", src: "연결된 L3 도달률 집계" } : null;
    }
    return null;
  }
  function goalModel(id, api) {
    var G = TG(), C = G && G.kpis && G.kpis[id]; if (!C || !C.targets || !isNum(C.targets.official)) return null;
    var V = G.verification && G.verification[id] || {}, cur = null; try { cur = goalCurrent(id, api); } catch (e) { cur = null; }
    var m = { id: id, name: C.name, T: C.targets, cur: cur, V: V, ok: !!(cur && isNum(cur.value) && V.match === true) };
    if (m.ok) { m.rate = cur.value / C.targets.official * 100; m.gap = (C.targets.official - cur.value) * 100; m.reached = cur.value >= C.targets.official - 1e-9; m.bar = Math.max(0, Math.min(100, m.rate)); }
    return m;
  }
  function rateT(x) { return (Math.round(x * 10) / 10).toFixed(1) + "%"; }
  function goalWhy(m) {
    if (!m.cur) return "현재 실적이 확인되지 않아 달성률을 계산하지 않았습니다.";
    if (m.V.match === false) return "현재 값은 목표와 정의가 달라(예: 기간 조건) 달성률을 계산하지 않았습니다.";
    return "정의 확인 전이라 달성률을 계산하지 않았습니다.";
  }
  function goalBlock(m) {
    var T = m.T, sm = [["기준", T.base], ["도전", T.challenge]]; if (isNum(T.long)) sm.push(["장기", T.long]);
    var st = m.ok ? (m.reached ? "ok" : "gap") : "vf";
    var h = '<div class="du-goal ' + st + '"><div class="gn">목표 지표 · ' + esc(m.name) + '</div><div class="gt"><span class="gk">상향 공식 목표</span><b class="gv">' + esc(pt(T.official)) + "</b>" +
      '<span class="gp">' + (m.ok ? (m.reached ? "목표 달성" : "목표까지 " + (Math.round(m.gap * 10) / 10).toFixed(1) + "%p") : "검증 필요") + "</span></div>" +
      '<div class="gbar' + (m.ok ? "" : " na") + '" role="progressbar" aria-valuemin="0" aria-valuemax="100"' + (m.ok ? ' aria-valuenow="' + Math.round(m.bar) + '"' : "") + "><i" + (m.ok ? ' style="width:' + m.bar.toFixed(1) + '%"' : "") + "></i></div>" +
      '<div class="gm"><span>공식 목표 달성률 <b>' + (m.ok ? esc(rateT(m.rate)) : "검증 필요") + "</b></span>" + (m.ok ? "" : "") + "</div>" +
      '<div class="gs">' + sm.map(function (x) { return "<span>" + esc(x[0]) + " " + esc(pt(x[1])) + "</span>"; }).join("") + "</div>";
    if (!m.ok) h += '<p class="gw">' + esc(goalWhy(m)) + " 자세한 내용은 상세 보기에서 확인합니다.</p>";
    return h + "</div>";
  }
  function goalDetail(ids, api) {
    var G = TG(); if (!G) return ""; var h = "";
    ids.forEach(function (id) {
      var m = goalModel(id, api); if (!m) return; var T = m.T, V = m.V, cur = m.cur;
      var tiers = [["기준 목표", T.base], ["상향 공식 목표", T.official], ["도전 목표", T.challenge]]; if (isNum(T.long)) tiers.push(["장기 목표", T.long]);
      var rows = tiers.map(function (x) { var ach = m.ok ? cur.value / x[1] * 100 : null; return "<tr" + (x[0] === "상향 공식 목표" ? ' class="of"' : "") + '><th>' + esc(x[0]) + "</th><td>" + esc(pt(x[1])) + "</td><td>" + (m.ok ? esc(rateT(ach)) : "검증 필요") + "</td><td>" + (m.ok ? (cur.value >= x[1] - 1e-9 ? "달성" : "−" + (Math.round((x[1] - cur.value) * 1000) / 10).toFixed(1) + "%p") : "—") + "</td></tr>"; }).join("");
      var calc = m.ok ? "공식 목표 달성률 = " + p1(cur.value) + " ÷ " + pt(T.official) + " × 100 = " + rateT(m.rate) + " · 목표까지 차이 = " + pt(T.official) + " − " + p1(cur.value) + " = " + (Math.round(m.gap * 10) / 10).toFixed(1) + "%p" + (m.reached ? " (목표 달성 — 진행 막대는 100%에서 멈추고 달성률은 실제 값으로 표시)" : "") : goalWhy(m);
      var dm = V.match === true ? "확인됨" : V.match === false ? "다름" : "미확정";
      h += '<section class="du-card du-gdet"><header><h3>목표 달성 계산 · ' + esc(m.name) + "</h3>" + pill(V.match === true ? "ok" : V.match === false ? "bad" : "wait", "정의 " + dm) + "</header>" +
        '<p class="gl">현재 실적: <b>' + (cur ? esc(p1(cur.value)) : "—") + "</b>" + (cur ? " · " + esc(cur.label) + (isNum(cur.num) && isNum(cur.den) ? " · " + api.num(cur.num) + " / " + api.num(cur.den) + "곳" : "") : " · 확인된 값 없음") + (cur && cur.src ? '<span class="src"> 출처 ' + esc(cur.src) + "</span>" : "") + "</p>" +
        '<div class="du-tw"><table class="du-tbl du-gt"><thead><tr><th>목표</th><th>목표값</th><th>달성률</th><th>차이</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
        '<p class="gc">' + esc(calc) + "</p>" +
        (cur && cur.done ? '<p class="gc">참고 · 1년 관측 완료 업체 기준: ' + esc(p1(cur.done.value)) + " (" + api.num(cur.done.num) + " / " + api.num(cur.done.den) + "곳, 표본이 작음) — 같은 정의의 일부 모집단입니다. 상향 공식 목표 대비 " + esc(rateT(cur.done.value / T.official * 100)) + ".</p>" : "") +
        '<p class="gd"><b>정의 확인</b> ' + esc(V.basis || "") + (V.caution ? " " + esc(V.caution) : "") + (V.checkedAt ? " (확인일 " + esc(V.checkedAt) + ")" : "") + "</p>" +
        '<p class="gd">업체별 목록은 공개 화면에 포함하지 않으며, 로그인 상세 보기의 시공사 추적에서 확인합니다. 목표 출처: ' + esc(G.source || "") + " · 설정 버전 " + esc(G.version || "") + ".</p></section>";
    });
    return h;
  }
  function withGoal(spec, id, api) { var m = goalModel(id, api); if (m) spec.goal = m; return spec; }
  function kpi12Spec(id, api) {
    var d = null; if (ADAPTERS[id]) { try { d = ADAPTERS[id](api) || null; } catch (e) { d = null; } }
    var verified = !!(d && d.status === "verified" && isNum(d.value)), one = id === "kpi1";
    var act = api.leading("신규 협력사 활성화율(별도)"), rf = null;
    if (one && act && isNum(act["값"])) rf = [{ label: "신규 협력사 활성화율(별도 지표)", value: api.pc(act["값"]), calc: String(act["비고"] || "") + " · 플랫폼 가입 기준·L2 이상 활동 — 신규 업체 사용률(협약일 1년·L3)과 정의가 달라 참고용" }];
    var spec = { cls: one ? "k1" : "k2", icon: one ? "user" : "repeat", label: one ? "신규 업체 사용률" : "재사용률", state: verified ? "ok" : "review", pill: "데이터 확인 필요", vtext: "데이터 확인 필요", value: verified ? api.pc(d.value) : "",
      def: one ? "실제 MOU 협약일 기준 신규 업체 중 협약 후 1년 이내 L3를 이용한 비율 · 협약일 없는 업체는 미확인으로 분리, 관측 1년 미만은 '관측 중'" : "기존·신규 업체 전체 · 기간 내 관측된 첫 L3 이후 같은 시공사가 다른 아파트에서 다시 L3를 이용한 비율(기간 내 관측 재사용률) · 같은 아파트 반복 문의 제외",
      dates: one ? ["협약일", "L3 활동일"] : ["L3 활동일"],
      yoy: "—", trend: '<span class="du-dash">추이 — 확인 후 표시</span>', refs: rf, refHead: "참고(정의 다름)",
      note: verified ? esc(d.basis || "") : (one ? "분석 기간(2025.06.24~) 협약 업체와 업체별 L3 이력이 공개 집계에 아직 반영되지 않아 계산하지 않았습니다." : "분석 기간 내 업체·아파트 단위 L3 이력(현장 연결 확정 포함)이 공개 집계에 아직 반영되지 않아 계산하지 않았습니다."), to: one ? "mou" : "l3" };
    return kpi12Period(id, api, spec, verified);
  }
  /* ---------- 통합 KPI 모니터링 ---------- */
  function mcard(o) {
    var st = o.state || "need", pill_ = st === "ok" ? pill("ok", "집계 확인") : st === "cand" ? pill("rev", "검증 필요") : st === "ref" ? pill("rev", "경로 확인 필요") : pill("wait", "데이터 확인 필요");
    return '<button class="du-mc ' + st + '" data-kact="dgo" data-id="' + (o.to || "l3") + '"><div class="mh"><span class="ml">' + esc(o.label) + "</span>" + pill_ + '</div><div class="mv' + (st === "ok" || o.num ? "" : " na") + '">' + esc(o.value) + "</div>" +
      '<p class="mb">' + esc(o.basis) + '</p><div class="mt"><span><em>전월 대비</em>' + esc(o.mom || "비교 불가") + "</span><span><em>최근 3개월</em>" + esc(o.m3 || "비교 불가") + "</span></div></button>";
  }
  function opsModel(api) { var V = window.B2BOpsView; return V && V.model ? V.model(api) : null; }
  function gMetric(api) { try { var GV = window.B2BGrowthView; if (!GV || !GV.modelFor) return null; var gm = GV.modelFor(api); if (!gm || gm.error || !gm.years || !gm.years.length) return null; return { gm: gm, m: gm.metrics("ytd", gm.lastY), y: gm.lastY }; } catch (e) { return null; } }
  function opsBlock(api, L, Lc, L2n, okL, last, asOf) {
    var om = opsModel(api), S = om && om.summary, G = gMetric(api), mv = G && G.m, coh = mv && mv.cohort;
    var tot = api.leading("전체 협력사"), inact = api.leading("장기 무활동"), core = api.leading("핵심 협력사 수"), coreIn = api.leading("핵심 협력사 중 장기 무활동");
    var tv = tot && isNum(tot["값"]) ? tot["값"] : null, ia = inact && isNum(inact["값"]) ? inact["값"] : null, nm = inact && inact["비고"] ? Number(String(inact["비고"]).replace(/[^0-9]/g, "")) : null;
    var nmv = nm != null && isNum(nm) && nm > 0 ? nm : (S ? S.active : null);
    var cs = [];
    cs.push({ label: "관리 시공사", state: tv != null ? "ok" : "need", num: 1, value: tv != null ? api.num(tv) + "곳" : "—", basis: "B2B 마스터 등록 기준(18.선행지표요약 · 2.시공사마스터). 기준일 2026-10-20", to: "mou" });
    cs.push({ label: "활성 시공사", state: nmv != null ? "ok" : "need", num: 1, value: nmv != null ? api.num(nmv) + "곳" : "—", basis: "마지막 영업활동이 90일 이내인 시공사(17.장기무활동 판정 '정상')", to: "l3" });
    cs.push({ label: "L2 → L3 전환율", state: "need", value: "데이터 확인 필요", basis: "영업보고(L2) 원천이 없어 새 기준으로 계산할 수 없습니다." + (okL ? " 참고(구 정의): " + api.pc(L["값"]) : ""), to: "l2" });
    var PT0 = periodTab(api), pdr = PT0 && PT0.val("L3 도달률", "L3 직접진입 확정");
    cs.push({ label: "직접진입 시공사", state: S || pdr != null ? "ref" : "need", value: S ? "확정 " + S.direct + " · 확인 필요 " + api.num(S.pathUnknown) + "곳" : pdr != null ? "확정 " + api.num(pdr) + " · 경로 확인 필요" : "데이터 확인 필요", basis: S || pdr != null ? "L3 활동은 있으나 L2 기록이 없는 시공사. 영업보고 원천이 없어 '직접진입'으로 확정하지 않고 '경로 확인 필요'로 분류" : "시공사 단위 정보는 로그인 상세 보기에서만 계산합니다", to: "l3" });
        var bR = S && S.result && isNum(S.result.buyRate) ? S.result : null;
    cs.push({ label: "낙찰 후 구매 연결률", state: (coh && isNum(coh.buyRate)) || bR ? "cand" : "need", num: 1, value: coh && isNum(coh.buyRate) ? api.pc(coh.buyRate) : bR ? api.pc(bR.buyRate) : "데이터 확인 필요", basis: coh && isNum(coh.buyRate) ? G.y + "년 동일기간 · 낙찰 시공사 " + api.num(coh.n) + "곳 중 자재 구매 " + api.num(coh.buyN) + "곳 · 연결 후보(법인 확정 아님) · 연도별 집계" : bR ? "기준일 이후 낙찰 시공사 중 관찰 종료 " + api.num(bR.buyDen) + "곳 기준 · 연 단위 자재 순매출 확인(연결 후보, 법인 확정 아님)" : "낙찰 시공사와 자재 구매 연결을 계산할 수 없습니다", to: "sales" });
    cs.push({ label: "장기 무활동 시공사", state: ia != null ? "ok" : "need", num: 1, value: ia != null ? api.num(ia) + "곳" : "—", basis: "마지막 영업활동 이후 90일 이상(17탭)" + (coreIn && isNum(coreIn["값"]) ? " · 핵심 시공사(임시 정의) 중 " + api.num(coreIn["값"]) + "곳" : ""), to: "act" });
    var h = '<div class="du-t"><h2>통합 KPI 모니터링</h2><span>B2B 운영팀 KPI · 시공사 성장 및 선행지표 · 카드를 누르면 근거 화면으로 이동합니다</span></div><div class="du-mcs">' + cs.map(mcard).join("") + "</div>";
    /* 시공사 전환 퍼널 */
    var PT = periodTab(api);
    var l3 = S ? S.l3Vendors : PT ? PT.val("팀 행동", "L3 활동 시공사 수(업체 확인·하한)") : null, aw = S ? S.awardVendors : PT ? PT.val("결과 성과", "기준일 이후 낙찰 시공사") : null, both = S ? S.l3AndAward : PT ? PT.val("결과 성과", "└ 그중 같은 기간 L3 활동이 있는 시공사") : null;
    var fb = function (n, lbl, v, sub, cls) { return '<div class="fn ' + (cls || "") + '"><span class="fl">' + esc(n) + '</span><b>' + esc(v) + '</b><small>' + esc(sub) + "</small></div>"; };
    h += '<div class="du-t"><h2>시공사 전환 퍼널</h2><span>L1 접점 확보 → L2 관심·문의 → L3 직접경험 → 결과 성과 · 같은 시공사의 반복 활동은 1곳으로 셉니다</span></div><section class="du-card du-funnel"><div class="fns">' +
      fb("L1 접점 확보", "", tv != null ? api.num(tv) + "곳" : "—", "관리 시공사(마스터) · L1 정의 확인 필요", "") + '<i class="ar">→</i>' +
      fb("L2 관심·문의", "", "—", "영업보고 원천 대기 · 전 단계 대비 전환율 확인 필요", "na") + '<i class="ar">→</i>' +
      fb("L3 직접경험", "", l3 != null ? api.num(l3) + "곳" : "—", l3 != null ? "기준일 이후 L3 활동 시공사(업체 확인·하한" + (S ? ", 시트 기록 기준" : ", 잔디 포함 작업본 · 검증 필요") + ") · 전 단계 대비 전환율 확인 필요" : "로그인 상세 보기에서 계산", l3 != null ? "" : "na") + '<i class="ar">→</i>' +
      fb("결과 성과", "", aw != null ? api.num(aw) + "곳" : "—", aw != null ? "기준일 이후 POUR 낙찰 시공사" + (both != null ? " · 그중 L3 활동 " + api.num(both) + "곳(L3 대비 " + (l3 ? api.pc(both / l3) : "—") + ", 인과 아님)" : "") : "로그인 상세 보기에서 계산", aw != null ? "" : "na") + "</div>" +
      '<div class="fsub"><span><em>평균 전환 소요일</em>' + (S && S.oldDays != null ? "구 정의 참고 " + S.oldDays + "일 (새 기준 확인 필요)" : "확인 필요") + "</span><span><em>직접진입</em>" + (S ? "확정 " + S.direct + " · 경로 확인 필요 " + api.num(S.pathUnknown) : "확인 필요") + "</span><span><em>이탈·정체</em>" + (ia != null ? "장기 무활동 " + api.num(ia) + "곳" : "확인 필요") + "</span></div></section>";
    /* 선행지표 3 */
    var cr = om && om.lead.core, tr = om && om.lead.trades;
    var li = [];
    li.push({ t: "① 핵심 시공사 이용률 변화", s: cr ? (cr.comparable ? "ok" : "rev") : "wait", sl: cr ? (cr.comparable ? "비교 가능" : "비교 불가(이전 기간 원천 미비)") : "데이터 확인 필요",
      b: cr ? "핵심 시공사(임시 정의 " + api.num(cr.n) + "곳) 중 최근 90일 활동 " + api.num(cr.cur) + "곳(" + api.pc(cr.n ? cr.cur / cr.n : null) + ") · 직전 90일 " + api.num(cr.prev) + "곳 · 활동 증가 " + cr.up.length + " · 감소 " + cr.down.length + " · 무활동 " + cr.none.length : "핵심 시공사" + (core && isNum(core["값"]) ? " " + api.num(core["값"]) + "곳(임시 정의 · 팀장 확정 필요)" : "") + "의 기간별 활동은 로그인 상세 보기에서 계산합니다",
      n: cr && !cr.comparable ? "직전 90일(" + cr.prevFrom + "~)은 시트 기술문의가 본격 적재(" + (om.summary.reliableFrom || "—") + ") 이전이라 증감을 판단하지 않습니다." : "" });
    li.push({ t: "② L2→L3 전환율 변화", s: "wait", sl: "데이터 확인 필요", b: "새 기준(L2 = 영업보고)은 원천이 없어 계산 불가. 구 정의 참고 " + (okL ? api.pc(L["값"]) + "(" + api.num(Lc && Lc["값"]) + "÷" + api.num(L2n && L2n["값"]) + ")" : "—") + (S ? " · 직접진입 확정 " + S.direct + " · 경로 확인 필요 " + api.num(S.pathUnknown) : ""), n: "분자·분모·관찰 기간은 영업보고 연결 후 표시합니다. 관찰이 끝나지 않은 업체와 미전환 확정 업체를 구분합니다." });
    li.push({ t: "③ 공법별 사용·요청량 변화", s: tr ? (om.lead.tradesComparable ? "ok" : "rev") : "wait", sl: tr ? (om.lead.tradesComparable ? "요청 건수 기준" : "비교 불가") : "데이터 확인 필요",
      b: tr ? om.lead.mons.join(" · ") + " 요청 건수(기술자문·컨설팅·설명회·기타): " + tr.slice(0, 4).map(function (x) { return x.trade + " " + x.series.join("/"); }).join(" · ") : "공법별 요청·사용 변화는 로그인 상세 보기에서 계산합니다", n: "문의(요청)와 실제 사용(낙찰·구매)은 구분합니다. 공종이 비어 있으면 '공법 미분류'로 둡니다." });
    h += '<div class="du-t"><h2>핵심 선행지표</h2><span>실제 근거가 있는 값만 표시 · 판단할 수 없으면 사유를 적습니다</span></div><div class="du-leads">' + li.map(function (x) { return '<section class="du-card"><header><h3>' + esc(x.t) + "</h3>" + pill(x.s, x.sl) + '</header><p class="s2">' + esc(x.b) + "</p>" + (x.n ? '<p class="s2 mut">' + esc(x.n) + "</p>" : "") + "</section>"; }).join("") + "</div>";
    /* 결과 KPI */
    var R = S && S.result, yl = G ? G.y + "년 1/1~" + String(G.gm.endMD || "").replace("-", "/") : "";
    var rr = function (name, a, b, note, st) { return "<tr><td><b>" + esc(name) + '</b></td><td class="n">' + (a == null ? '<span class="du-dash">로그인 상세 보기</span>' : esc(a)) + '</td><td class="n">' + (b == null ? '<span class="du-dash">확인 필요</span>' : esc(b)) + "</td><td>" + esc(note) + (st ? " " + pill(st[0], st[1]) : "") + "</td></tr>"; };
    h += '<div class="du-t"><h2>결과 KPI</h2><span>분석 기준일 이후(시트 기록)와 연도별 집계(공개)는 기간이 달라 합산·혼합하지 않습니다</span></div><section class="du-card"><div class="du-rtw"><table class="du-rt2"><thead><tr><th>지표</th><th>기준일 이후<small>2025.06.24~(로그인 상세 보기)</small></th><th>연도별 집계<small>' + esc(yl || "공개 집계") + "</small></th><th>기준</th></tr></thead><tbody>" +
      rr("POUR 반영 공고", R ? api.num(R.notices) + "건" : null, mv && isNum(mv.notices) ? api.num(mv.notices) + "건" : null, "공고일 기준(집계대상=Y)") +
      rr("POUR 낙찰", R ? api.num(R.awards) + "건" : null, mv && isNum(mv.awards) ? api.num(mv.awards) + "건" : null, "공고일 기준 · 낙찰일 자료 없음(공고일과 혼동하지 않음)") +
      rr("낙찰금액", R ? api.won(R.awardAmt) : null, mv && isNum(mv.awardAmt) ? api.won(mv.awardAmt) : null, "VAT 포함 여부 미확인" + (R && R.awardAmtMissing ? " · 금액 미기재 " + R.awardAmtMissing + "건 제외" : "")) +
      rr("낙찰 후 구매 연결률", R && isNum(R.buyRate) ? api.pc(R.buyRate) + " (" + S.buyCand + "/" + R.buyDen + ")" : null, coh && isNum(coh.buyRate) ? api.pc(coh.buyRate) : null, "연결 후보(연 단위 자재 순매출>0) · 관찰 중 제외", ["rev", "검증 필요"]) +
      rr("메인자재 구매 연결률", null, coh && isNum(coh.mainRate) ? api.pc(coh.mainRate) : null, coh && isNum(coh.mainRate) ? "연결 후보(메인 유상 구매)" : "메인자재 값 미확인 연도는 계산하지 않음", ["rev", "검증 필요"]) +
      rr("시공사별 재구매율", "정의 확정 필요", "정의 확정 필요", "재구매 기간·구매 인정 기준이 정해지면 계산", ["wait", "확인 필요"]) +
      rr("시공사별 지속 이용률", "정의 확정 필요", "정의 확정 필요", "지속 이용 기준(기간·최소 활동)이 정해지면 계산", ["wait", "확인 필요"]) +
      "</tbody></table></div></section>";
    return h;
  }
  /* 추가 관리 대상(추천) — 기존 장기 무활동·이력 없음 수치는 그대로 두고, 여러 조건에 걸린 시공사는 1곳으로 센다 */
  function mgmtExtra(api, S) {
    var PT = periodTab(api), v = function (l) { return PT ? PT.val("관리 대상", l) : null; };
    var cnt = S ? S.recCounts : PT ? { A: v("추천 대상: 전환 미완(구 정의 16탭)"), B: v("추천 대상: 낙찰 후 구매 미확인"), D: v("추천 대상: 컨설팅 후속 미확인"), E: v("추천 대상: 협약일 미확인"), F: v("추천 대상: 핵심 시공사 활동 감소") } : null;
    if (!cnt || cnt.A == null) return '<p class="s2 mut">추가 관리 대상(전환 미완·낙찰 후 구매 미확인·협약일 미확인 등)은 집계가 연결되면 표시됩니다.</p>';
    var uq = S ? S.mgmtUnique : v("추천 대상 시공사(중복 제거)"), mt = S ? S.mgmtMulti : null;
    return '<div class="du-mg"><span><em>전환 미완(구 정의)</em>' + api.num(cnt.A) + '</span><span><em>낙찰 후 구매 미확인</em>' + api.num(cnt.B) + '</span><span><em>컨설팅 후속</em>' + api.num(cnt.D) + '</span><span><em>협약일 미확인</em>' + api.num(cnt.E) + '</span><span><em>활동 감소(핵심)</em>' + (cnt.F ? api.num(cnt.F) : "비교 불가") + '</span></div><p class="s2 mut">추천 대상 시공사 ' + (uq == null ? "—" : api.num(uq)) + "곳(중복 제거" + (mt != null ? " · 복수 사유 " + api.num(mt) + "곳" : "") + ") · 기준·관찰 기간은 기본값이며 검증 필요. 후속 조치 미완료는 #팀 업무의 추천 업무 등록 후 추적합니다.</p>";
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
    h += '<section class="du-period" aria-label="분석 기간"><div class="pm"><span class="pi">' + ic("doc") + '</span><b>분석 기준일: 2025.06.24</b><span class="pt">조회 기간 2025.06.24 ~ 현재</span></div><p>' + esc(PERIOD_NOTE) + '</p><div class="pf"><span class="pl">기간 필터</span><button class="on" aria-pressed="true">전체</button><button disabled title="월·연도 단위 집계가 공개 집계에 추가되면 제공합니다">연도</button><button disabled title="월·연도 단위 집계가 공개 집계에 추가되면 제공합니다">월</button><button disabled title="월·연도 단위 집계가 공개 집계에 추가되면 제공합니다">최근 3개월</button><span class="ph">연도·월 필터는 월 단위 집계가 연결되면 제공됩니다 · 마지막 동기화와 정합성 점검은 위 상태줄에서 확인</span></div></section>';
    h += '<header class="du-head"><div><h1>B2B 업무 성과 대시보드</h1><p>' + esc(ys[0]) + "~" + esc(last) + "년 · " + esc(last) + "년은 " + esc(asOf || "기준일") + "까지 누계(*) · 값이 없는 항목은 0 이 아니라 '—' 로 표시</p></div></header>";
    h += '<div class="du-kpis">' +
            kpiCard(withGoal(kpi12Spec("kpi1", api), "kpi1", api)) +
            kpiCard(withGoal(kpi12Spec("kpi2", api), "kpi2", api)) +
      kpiCard(withGoal(kpi3Spec(api, L, Lc, L2n, okL), "kpi3", api)) + "</div>";

    /* 2-0) 통합 KPI 모니터링: 운영 6지표 · 시공사 전환 퍼널 · 선행지표 3 · 결과 KPI — 근거가 없는 값은 만들지 않는다 */
    h += opsBlock(api, L, Lc, L2n, okL, last, asOf);

    /* 2) 현황 요약 4 */
    var tot = api.leading("전체 협력사"), inact = api.leading("장기 무활동"), none = api.leading("활동 이력 없음"), core = api.leading("핵심 협력사 수");
    var tv = tot && isNum(tot["값"]) ? tot["값"] : null, ia = inact && isNum(inact["값"]) ? inact["값"] : null, nb = none && isNum(none["값"]) ? none["값"] : null, nm = inact && inact["비고"] ? Number(String(inact["비고"]).replace(/[^0-9]/g, "")) : null;
    var seg = nm && ia != null && nb != null && tv != null && nm + ia + nb === tv ? [["정상", nm, "c1"], ["장기 무활동", ia, "c2"], ["이력 없음", nb, "c3"]] : null;
    var stack = seg ? '<div class="du-stack">' + seg.map(function (x) { return '<i class="' + x[2] + '" style="flex:' + x[1] + '" title="' + esc(x[0] + " " + api.num(x[1])) + '곳"></i>'; }).join("") + '</div><div class="du-lg">' + seg.map(function (x) { return '<span><i class="du-dot ' + x[2] + '"></i>' + esc(x[0]) + " <b>" + api.num(x[1]) + "</b></span>"; }).join("") + "</div>" : "";
    var won = api.won, l3sum = null; ["기술자문문의_건수", "컨설팅요청_건수", "공법설명회_건수", "기타문의_건수"].forEach(function (c) { if (isNum(kL[c])) l3sum = (l3sum || 0) + kL[c]; });
    h += '<div class="du-t"><h2>시공사별 영업·기술지원·성과 요약</h2><span>' + esc(last) + "년 " + esc(asOf) + " 누계(연도별 집계) · 2025.06.24 기준 합산은 집계 확장 후 표시</span></div><div class=\"du-sum\">" +
      '<section class="du-card"><header><h3>업체 현황</h3><button class="btn ghost du-go" data-kact="dgo" data-id="mou">자세히 →</button></header><p class="df">기준 날짜: 협약일 · 활동일</p>' + stat("전체 협력사", tv, "B2B 마스터 기준", api.num, true) + stack + '<p class="s2">핵심 협력사 ' + esc(dv(core ? core["값"] : null, api.num).t) + "곳(임시 정의)</p></section>" +
      '<section class="du-card"><header><h3>L2 · L3 활동 현황</h3><button class="btn ghost du-go" data-kact="dgo" data-id="l3">자세히 →</button></header><p class="df">기준 날짜: 활동일(접수·등록일)</p><div class="du-pair"><div>' + stat("L2 영업보고", null, "데이터 연결 예정", null, true) + "</div><div>" + stat("L3 활동(시트 기준)", l3sum, "기술자문·컨설팅·설명회·기타", api.num, true) + '</div></div><p class="s2">기술자문 ' + esc(dv(kL["기술자문문의_건수"], api.num).t) + " · 컨설팅 " + esc(dv(kL["컨설팅요청_건수"], api.num).t) + " · 설명회 " + esc(dv(kL["공법설명회_건수"], api.num).t) + " · 기타 " + esc(dv(kL["기타문의_건수"], api.num).t) + "</p></section>" +
      '<section class="du-card"><header><h3>공고 · 낙찰 현황</h3><button class="btn ghost du-go" data-kact="view" data-id="growth">자세히 →</button></header><p class="df">기준 날짜: 공고일 (낙찰일 자료 없음)</p>' + stat("POUR 낙찰", kL["POUR낙찰_건수"], "공고 " + esc(dv(kL["POUR반영공고_건수"], api.num).t) + "건 · 낙찰금액 " + esc(dv(kL["POUR낙찰금액_VAT미확인"], won).t), function (v) { return api.num(v) + "건"; }, true) + mini(col("POUR낙찰_건수"), cats, { fmt: api.num }) + "</section>" +
      '<section class="du-card"><header><h3>메인자재 매출</h3><button class="btn ghost du-go" data-kact="dgo" data-id="sales">자세히 →</button></header><p class="df">기준 날짜: 매출일(거래일)</p>' + stat("메인자재 순매출", kL["메인자재순매출"], "전체 " + esc(dv(kL["전체자재순매출"], won).t) + " · 비중 " + esc(dv(kL["메인비중"], api.pc).t), won, true) + mini(col("메인자재순매출"), cats, { fmt: won }) + "</section></div>";

    /* 4) L2·L3·L4 경로 분석 */
    var l2v = L2n && isNum(L2n["값"]) ? L2n["값"] : null, lcv = Lc && isNum(Lc["값"]) ? Lc["값"] : null;
    var PD = null; if (ADAPTERS.paths) { try { PD = ADAPTERS.paths(api) || null; } catch (e) { PD = null; } }
    h += '<div class="du-t"><h2>L2 · L3 · L4 경로 분석</h2><span>실제 날짜 순서와 업체·현장 연결이 확인된 기록만 확정 집계 · 불명확한 연결은 검토 대상으로 분리</span></div>';
    h += '<div class="du-paths">' + PATHS.map(function (p) {
      var x = PD && PD[p.id] || null, ok = !!(x && x.verify === "ok"), cell = function (v) { return ok && isNum(v) ? api.num(v) : "—"; };
      var st = ok ? pill("ok", "확인 완료") : x ? pill("rev", "검증 필요") : p.needL2 ? pill("wait", "영업보고 원천 대기") : pill("rev", "데이터 확인 필요");
      return '<button class="du-path' + (p.needL2 ? " l2" : "") + (p.id === "p2" ? " sep" : "") + '" data-kact="dgo" data-id="' + (p.needL2 ? "l2" : "l3") + '"><div class="ph"><b>' + esc(p.n) + "</b>" + st + '</div><span class="pd">' + esc(p.d) + '</span><div class="pn"><span><em>업체</em><b>' + cell(x && x.vendors) + "</b></span><span><em>현장</em><b>" + cell(x && x.sites) + "</b></span><span><em>활동</em><b>" + cell(x && x.acts) + "</b></span></div></button>";
    }).join("") + "</div>";
    h += '<section class="du-card du-reach"><header><h3>L3 도달 경로 (L2 경유 + L3 직접 진입)</h3>' + pill("rev", "검증 필요") + '</header><div class="du-flow"><div class="n"><span>L2 경유 L3</span><b>—</b></div><i class="ar">+</i><div class="n"><span>L3 직접 진입</span><b>—</b></div></div><p class="s2">두 경로는 각각 구분해 보관하고 메인에는 합산만 표시합니다. 개별 건수와 비율은 L3 자료 화면에서 확인합니다. ' + (okL ? "참고: 기존 L2→L3 전환률 " + esc(api.pc(L["값"])) + " (" + esc(dv(lcv, api.num).t) + " ÷ " + esc(dv(l2v, api.num).t) + ", 구 정의)" : "") + "</p>" + go("l3", "L3 자료 화면") + "</section>";

    /* 5) 월별 활동 추이 */
    var PTm = periodTab(api), ml = PTm ? PTm.list("월별 L3") : [];
    if (ml.length) {
      var mons = ml.map(function (r) { return pMonth(r["지표"]); }), cats = mons.map(function (m) { return { l: m, s: m.slice(2).replace("-", "/"), cur: false }; });
      var ser = function (g) { var mp = {}; PTm.list(g).forEach(function (r) { mp[pMonth(r["지표"])] = r["값"]; }); return mons.map(function (m) { return isNum(mp[m]) ? mp[m] : null; }); };
      h += '<div class="du-t"><h2>월별 활동 추이</h2><span>월 기준은 활동일·공고일 · ' + esc(mons[0]) + " ~ " + esc(mons[mons.length - 1]) + " · 작업본 집계(검증 필요) · 마지막 달은 진행 중</span></div><section class=\"du-card wide\"><header><h3>월별 활동 및 성과 추이</h3>" + pill("rev", "검증 필요") + "</header>" +
        '<div class="du-mser"><h4>L3 활동 (건)</h4>' + mini(ser("월별 L3"), cats, { fmt: api.num }) + '</div><div class="du-mser"><h4>자사 공고 (건)</h4>' + mini(ser("월별 공고"), cats, { fmt: api.num }) + '</div><div class="du-mser"><h4>낙찰 (건)</h4>' + mini(ser("월별 낙찰"), cats, { fmt: api.num }) + "</div>" +
        '<p class="s2">L2 영업보고는 원천이 없어 표시하지 않습니다. 2025-06은 24일부터, 낙찰은 공고일 기준입니다. 같은 흐름의 컨설팅 요청·발행 등이 함께 세어져 L3 건수가 부풀 수 있습니다.</p></section>';
    } else {
      h += '<div class="du-t"><h2>월별 활동 추이</h2><span>월 기준은 각 지표의 날짜 필드(활동일·공고일·매출일)를 따릅니다</span></div><section class="du-card wide"><header><h3>월별 활동 및 성과 추이</h3>' + pending() + "</header>" + ghostMonths(3) + '<div class="du-lg"><span><i class="du-dot c1"></i>L2 영업보고</span><span><i class="du-dot c2"></i>L3 활동</span><span><i class="du-dot c3"></i>공고·낙찰</span></div><div class="du-empty"><b>월별 데이터가 아직 연결되지 않았습니다</b><span>연결되면 2025.06부터 월별 L2·L3·L4 추이가 이 자리에 표시됩니다. 임의 수치는 넣지 않습니다.</span></div></section>';
    }

    /* 6) 업체별 상세 분석 · 관리 대상 */
    var iaV = inact && isNum(inact["값"]) ? inact["값"] : null, nbV = none && isNum(none["값"]) ? none["값"] : null, coreIn = api.leading("핵심 협력사 중 장기 무활동"), coreInV = coreIn && isNum(coreIn["값"]) ? coreIn["값"] : null;
    h += '<div class="du-t"><h2>업체별 상세 분석 · 관리 대상</h2><span>시공사 한 곳을 선택하면 이력을 시간순으로 봅니다(상세 보기)</span></div><div class="du-mgmt"><section class="du-card"><header><h3>관리 대상 업체</h3><button class="btn ghost du-go" data-kact="dgo" data-id="act">관리 이력 →</button></header><div class="du-pair"><div>' + stat("장기 무활동(90일+)", iaV, "마지막 영업활동 기준", api.num, true) + "</div><div>" + stat("활동 이력 없음", nbV, "2025.06.24 이후 기록 기준", api.num, true) + '</div></div><p class="s2">핵심 협력사 중 장기 무활동 ' + esc(dv(coreInV, api.num).t) + "곳(핵심 협력사 정의는 임시)</p>" + mgmtExtra(api, (opsModel(api) || {}).summary || null) + "</section>" +
      '<section class="du-card"><header><h3>시공사별 상세 이력</h3>' + pill("part", "상세 보기(로그인)") + "</header><p class=\"s2\">시공사를 검색하면 협약일 · 영업보고(L2) · 기술지원(L3) · 현장별 재사용 · 공고·낙찰(L4) · 자재 구매를 시간순으로 확인합니다. 업체 단위 정보는 공개 화면에 싣지 않고 로그인 상세 보기에서만 보입니다.</p>" + '<button class="btn ghost du-go" data-kact="view" data-id="growth">성장 분석에서 시공사 검색 →</button></section></div>';

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
  function periodBuiltin(id, PT) {
    var v = function (g, l) { return PT.val(g, l); };
    if (id === "mou") {
      var dif = v("협약일", "마스터와 협약일 불일치(검증 대상)"), nb = v("협약일", "사업자번호가 없어 대조하지 못한 목록 업체");
      return { status: "partial", asOf: "2026-10-20", source: v("협약일", "고객관리카드에 협약일이 입력된 업체") != null ? "고객관리카드 협약일(신규 업체 사용률 계산에 사용) · 시공사 마스터 파일 협약일·협약 체결 업체 목록(2026-10-14)과 대조" : "시공사 마스터 파일 협약일 · 협약 체결 업체 목록(2026-10-14) 대조 · 고객관리카드 협약일은 연동 전", stats: { total: { v: v("협약일", "협약일 보유 시공사"), sub: "협약일이 있는 시공사" }, fresh: { v: v("협약일", "협약일이 분석 기간 내인 시공사"), sub: "신규 판정 대상(협약일 2025.06.24 이후)" }, dated: v("협약일", "협약일 보유 시공사"), undated: { v: v("관리 대상", "추천 대상: 협약일 미확인"), sub: "관리 시공사 중 협약일 없음 · 신규·기존 판정 안 함" } }, note: "원천 대조: 일치 " + (v("협약일", "마스터와 협약일 일치(사업자번호 기준)") == null ? "—" : v("협약일", "마스터와 협약일 일치(사업자번호 기준)")) + "곳 · 불일치 " + (dif == null ? "—" : dif) + "곳(검증 대상) · 사업자번호 없어 대조 못함 " + (nb == null ? "—" : nb) + "곳" };
    }
    var typ = PT.list("팀 행동").filter(function (r) { return String(r["지표"]).indexOf("└ 유형: ") === 0; }), sum = function (re) { var t = 0, any = false; typ.forEach(function (r) { if (re.test(r["지표"]) && isNum(r["값"])) { t += r["값"]; any = true; } }); return any ? t : null; };
    return { status: "partial", asOf: "2026-10-20", source: "플랫폼 활동 시트 + 잔디 기술문의·PT + 컨설팅 발행현황 통합 작업본(익명 집계) · 검증 필요", stats: { advice: sum(/기술자문/), pt: sum(/PT|공법설명회/), etc: sum(/기타 문의/), consult: sum(/컨설팅/), vendors: { v: v("팀 행동", "L3 활동 시공사 수(업체 확인·하한)"), sub: "업체 미기재 제외 · 하한" }, via: { v: null, sub: "영업보고 원천 없음 — 구분 불가" }, direct: { v: v("L3 도달률", "L3 직접진입 확정"), sub: "확정 0 · 전부 경로 확인 필요" }, reach: { v: v("L3 도달률", "L3 도달 업체×현장 조합(합산 분자 후보)"), sub: "업체×현장 조합(분모 확정 전)" } },
      monthly: PT.list("월별 L3").map(function (r) { return { m: pMonth(r["지표"]), v: r["값"] }; }), note: "유형 합계는 컨설팅 요청·발행, PT 요청·실시처럼 같은 흐름의 단계별 기록을 함께 세므로 고유 활동 수보다 클 수 있습니다." };
  }
  function builtin(id) {                               /* 이미 연결된 값만 쓰는 일부 연결(이카운트 매출: 1.통합KPI 연도별 값) */
    if (A && (id === "mou" || id === "l3")) { var PT = periodTab(A); if (PT) return periodBuiltin(id, PT); }
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
    if (ST.ds === "mou") h += goalDetail(["kpi1"], api); else if (ST.ds === "l3") h += goalDetail(["kpi2", "kpi3"], api);
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
