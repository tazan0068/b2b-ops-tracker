/* ============================================================
   공개용 집계 포장 모듈 — 시트 25탭(원본) → 공개 가능한 집계값(JSON) · 브라우저/Node/Apps Script 공용 (화면 없음)
   · 원본은 읽기만 한다. 결과는 새 객체이며 원본·시트·업무 기록을 바꾸지 않는다.
   · 공개 범위: 1.통합KPI(연도별 집계) · 18.선행지표요약(집계) · 성장 분석 집계(연도·기간별 건수·금액·비율·증감 근거)
     공개하지 않음: 거래처(시공사)·현장·거래 명세, 사업자번호, 판매 원문, 연결 후보 목록, 영업활동 목록
   · 게시 전 검증: 필수 탭·열 구조 → 기존 KPI 대조(불일치면 게시 중단) → 행 수 급감 → 업체·현장명 누출 검사
   · 없는 값은 0 으로 채우지 않는다(null + 사유는 growth-core 규칙 그대로).
   ============================================================ */
(function (root) {
  "use strict";
  var SCHEMA_VER = "b2b-public-kpi/1";
  var LEDGER = "3.이카운트판매원문";
  var NEED = ["1.통합KPI", "2.시공사마스터", LEDGER, "4.메인자재구매현황", "5.POUR공고낙찰", "5b.POUR반영공고", "18.선행지표요약"];
  /* 선택 탭(분석 기준일 이후 KPI 익명 집계). 있으면 검증해 그대로 공개, 없으면 건너뜀 — 숫자·일반 라벨만 허용 */
  var PERIOD_TAB = "20.기간KPI집계";
  var PERIOD_HEADER = ["구분", "지표", "값", "분자", "분모", "단위", "기간", "검증상태", "근거"];
  var PERIOD_GROUPS = ["신규 업체 사용률", "재사용률", "L3 도달률", "팀 행동", "월별 L3", "월별 공고", "월별 낙찰", "협약일", "관리 대상", "핵심 시공사", "결과 성과"];
  var PERIOD_BAD = /@|https?:\/\/|www\.|\d{2,3}-\d{3,4}-\d{4}|\d{3}-\d{2}-\d{5}/i;
  function checkPeriod(t) {
    var errs = [];
    if (!t || !Array.isArray(t.header) || !Array.isArray(t.rows)) return { errs: ["기간 KPI 탭 형식 오류"], tab: null };
    if (t.header.join("|") !== PERIOD_HEADER.join("|")) errs.push("기간 KPI 탭 열 머리글이 약속과 다름");
    if (t.rows.length > 400) errs.push("기간 KPI 탭 행이 너무 많음(" + t.rows.length + ")");
    if (errs.length) return { errs: errs, tab: null };
    var rows = [];
    t.rows.forEach(function (r, i) {
      if (PERIOD_GROUPS.indexOf(r[0]) < 0) { errs.push("기간 KPI " + (i + 2) + "행: 허용되지 않은 구분"); return; }
      var o = [];
      for (var c = 0; c < PERIOD_HEADER.length; c++) {
        var v = r[c]; if (v === undefined || v === "") v = null;
        if (c === 2 || c === 3 || c === 4) { if (v !== null && !isNum(v)) { errs.push("기간 KPI " + (i + 2) + "행: 숫자 열에 숫자가 아닌 값"); return; } }
        else if (v !== null) { v = String(v); if (v.length > 200 || PERIOD_BAD.test(v)) { errs.push("기간 KPI " + (i + 2) + "행: 공개할 수 없는 문자열"); return; } }
        o.push(v);
      }
      rows.push(o);
    });
    return { errs: errs, tab: errs.length ? null : { header: PERIOD_HEADER.slice(), rows: rows } };
  }
  var KEEP_NOTE = /^(장기 무활동|신규 협력사 활성화율|핵심 협력사 중 장기 무활동)/;       /* 18.선행지표요약 에서 비고를 공개하는 행(숫자만 있는 집계) */
  var NAME_COLS = { "2.시공사마스터": ["대표업체명", "낙찰시공사_표기", "이카운트_거래처명", "플랫폼_업체명"], "5.POUR공고낙찰": ["낙찰시공사", "현장명"], "5b.POUR반영공고": ["현장명"] };
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function nz(s) { return String(s == null ? "" : s).replace(/\s|아파트|단지|\(|\)|㈜|주식회사/g, ""); }
  function toObjs(t) { var h = t.header; return t.rows.map(function (r) { var o = {}; for (var i = 0; i < h.length; i++) o[h[i]] = r[i]; return o; }); }
  /* 안정 해시(변경 감지용 · 보안용 아님) */
  function hash53(str) { var h1 = 0xdeadbeef, h2 = 0x41c6ce57; for (var i = 0; i < str.length; i++) { var ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36); }

  /* tabs: { 탭이름: { header:[…], rows:[[…]] } }  opt: { schema, prev, now, sourceModified, extraDeny:[문자열], maxShrink }
     반환: { ok, errors[], warnings[], payload|null, stats } — ok=false 이면 payload 는 null 이고 게시하지 않는다 */
  function pack(tabs, opt) {
    opt = opt || {}; var errors = [], warnings = [], GC = root.B2BGrowth;
    if (!GC || !GC.build) return { ok: false, errors: ["계산 모듈(growth-core)이 없습니다"], warnings: [], payload: null, stats: {} };
    /* 1) 구조 검사 */
    var schema = opt.schema || null;
    if (schema) Object.keys(schema).forEach(function (n) { var t = tabs[n]; if (!t || !t.header || !t.rows) { errors.push("탭 없음: " + n); return; } var miss = schema[n].filter(function (c) { return t.header.indexOf(c) < 0; }); if (miss.length) errors.push("열 구조 변경: " + n + " (누락 열 " + miss.join(", ") + ")"); });
    NEED.forEach(function (n) { if (!tabs[n] || !tabs[n].header || !tabs[n].rows) { if (!schema) errors.push("탭 없음: " + n); } });
    if (errors.length) return { ok: false, errors: errors, warnings: warnings, payload: null, stats: {} };
    var cache = {}; function O(n) { return cache[n] || (cache[n] = toObjs(tabs[n])); }
    var led = O(LEDGER), stats = { tabs: Object.keys(tabs).length, ledgerRows: led.length };
    if (opt.prev && isNum(opt.prev.ledgerRows) && opt.prev.ledgerRows > 0) { var shrink = opt.maxShrink == null ? 0.05 : opt.maxShrink; if (led.length < opt.prev.ledgerRows * (1 - shrink)) errors.push("판매 원문 행 수가 이전 게시본(" + opt.prev.ledgerRows + ")보다 " + Math.round(shrink * 100) + "% 넘게 줄었습니다(" + led.length + ") — 시트 편집 중이거나 데이터가 사라졌을 수 있어 게시를 보류합니다"); }
    /* 2) 집계 (기본 정의 — 사용자 화면의 이름 변경은 브라우저에서만 적용) */
    var src = { has: function (n) { return !!tabs[n]; }, objs: O, ledger: function () { return led; } };
    var model; try { model = GC.build(src, {}); } catch (e) { return { ok: false, errors: ["집계 중 오류: " + (e && e.message || e)], warnings: warnings, payload: null, stats: stats }; }
    if (model.missing && model.missing.length) errors.push("집계에 필요한 탭 없음: " + model.missing.join(", "));
    /* 3) 기존 KPI 대조 — 불일치면 게시하지 않는다 */
    var rec = model.reconcile(), bad = rec.filter(function (r) { return r.결과 === "불일치" && r.항목 !== "낙찰 시공사 수(표기 기준)"; }), okN = rec.filter(function (r) { return r.결과 === "일치"; }).length;
    bad.forEach(function (r) { errors.push("KPI 대조 불일치: " + r.연도 + " " + r.항목 + " (집계 " + r.새집계 + " ≠ KPI " + r.KPI + ")"); });
    stats.reconcile = { ok: okN, bad: bad.length, na: rec.filter(function (r) { return r.결과 === "대조 대상 아님"; }).length };
    if (!model.ledgerReady) errors.push("판매 원문이 비어 있어 게시하지 않습니다");
    if (errors.length) return { ok: false, errors: errors, warnings: warnings, payload: null, stats: stats };
    /* 4) 공개 payload (허용 목록 방식: 아래에 적은 것만 나간다) */
    var kpi = tabs["1.통합KPI"];
    var lead = O("18.선행지표요약").map(function (r) { var lab = String(r["지표"] == null ? "" : r["지표"]); return [lab, r["값"] == null ? null : r["값"], r["기준"] == null ? null : r["기준"], KEEP_NOTE.test(lab) && r["비고"] != null ? r["비고"] : null]; });
    var periodTab = null; if (tabs[PERIOD_TAB]) { var pc = checkPeriod(tabs[PERIOD_TAB]); if (pc.errs.length) return { ok: false, errors: pc.errs, warnings: warnings, payload: null, stats: stats }; periodTab = pc.tab; stats.periodRows = periodTab.rows.length; }
    var pub = model.exportPublic();
    var body = { tabs: { "1.통합KPI": { header: kpi.header.slice(), rows: kpi.rows.map(function (r) { return r.slice(); }) }, "18.선행지표요약": { header: ["지표", "값", "기준", "비고"], rows: lead } }, growth: pub };
    if (periodTab) body.tabs[PERIOD_TAB] = periodTab;
    var bodyStr = JSON.stringify(body), h = hash53(bodyStr);
    var payload = { schema: SCHEMA_VER, meta: { hash: h, generatedAt: opt.now || new Date().toISOString(), asOf: model.asOf, sourceModified: opt.sourceModified || null, source: "구글시트 25개 탭 → 자동 집계(공개용 집계값)", scope: "연도·기간별 집계값만 공개 · 시공사·현장·거래 명세, 사업자번호, 판매 원문은 비공개", calc: "growth-core v1", tabsRead: stats.tabs, ledgerRows: led.length, kpiCheck: { match: okN, mismatch: 0 }, bytes: bodyStr.length }, tabs: body.tabs, growth: body.growth };
    var text = JSON.stringify(payload);
    /* 5) 누출 검사: 업체·현장명(정규화 4자 이상)·내부 금지어가 한 글자라도 나오면 게시하지 않는다 */
    var hay = nz(text), leaks = [], seen = {};
    Object.keys(NAME_COLS).forEach(function (n) { if (!tabs[n]) return; O(n).forEach(function (r) { NAME_COLS[n].forEach(function (c) { var v = nz(r[c]); if (v.length >= 4 && !seen[v]) { seen[v] = 1; if (hay.indexOf(v) >= 0) leaks.push(n + "." + c); } }); }); });
    (opt.extraDeny || []).forEach(function (w) { var v = nz(w); if (v.length >= 2 && hay.indexOf(v) >= 0) leaks.push("금지어"); });
    if (leaks.length) return { ok: false, errors: ["공개 데이터에 업체·현장명이 포함되어 게시를 중단했습니다(" + leaks.slice(0, 5).join(", ") + (leaks.length > 5 ? " 외 " + (leaks.length - 5) + "건" : "") + ")"], warnings: warnings, payload: null, stats: stats };
    stats.bytes = text.length; stats.hash = h;
    if (text.length > 120000) warnings.push("공개 데이터가 " + text.length + "자 — Apps Script 저장 한도(15만 자)에 가깝습니다");
    return { ok: true, errors: [], warnings: warnings, payload: payload, stats: stats };
  }

  /* 받은 JSON 이 우리 형식인지 확인(브라우저·테스트 공용). 실패 시 사유 문자열, 통과 시 null */
  function validate(p) {
    if (!p || typeof p !== "object") return "형식 오류(객체 아님)";
    if (p.schema !== SCHEMA_VER) return "지원하지 않는 형식 버전: " + String(p.schema);
    if (!p.meta || typeof p.meta.hash !== "string" || !p.meta.generatedAt) return "메타 정보 누락";
    var k = p.tabs && p.tabs["1.통합KPI"], l = p.tabs && p.tabs["18.선행지표요약"];
    if (!k || !Array.isArray(k.header) || !Array.isArray(k.rows) || !k.rows.length) return "1.통합KPI 누락";
    if (!l || !Array.isArray(l.rows)) return "18.선행지표요약 누락";
    if (p.tabs[PERIOD_TAB]) { var pt = p.tabs[PERIOD_TAB]; if (!Array.isArray(pt.header) || !Array.isArray(pt.rows) || pt.header.join("|") !== PERIOD_HEADER.join("|")) return "기간 KPI 탭 형식 오류"; }
    var g = p.growth; if (!g || !Array.isArray(g.years) || !g.years.length || !g.metrics || !g.metrics.ann || !g.metrics.ytd) return "성장 분석 집계 누락";
    for (var i = 0; i < g.years.length; i++) { var y = g.years[i]; if (!g.metrics.ann[y] || !g.metrics.ytd[y]) return "연도별 집계 누락: " + y; }
    if (!/^\d{2}-\d{2}$/.test(String(g.endMD || ""))) return "기준일 형식 오류";
    return null;
  }

  root.B2BPublicPack = { PERIOD_TAB: PERIOD_TAB, PERIOD_HEADER: PERIOD_HEADER, SCHEMA_VER: SCHEMA_VER, pack: pack, validate: validate, hash53: hash53, NEED: NEED };
  if (typeof module !== "undefined" && module.exports) module.exports = root.B2BPublicPack;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
