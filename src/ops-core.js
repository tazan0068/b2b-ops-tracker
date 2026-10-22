/* ============================================================
   시공사별 활동·성과 추적 — 계산 모듈 (window.B2BOps)
   · 입력: src = { has(tab), objs(tab) } — B2BSheet 가 읽은 운영 시트 25탭(읽기 전용). 업무 기록 저장소·시트 원본은 쓰지 않는다.
   · 공통 분석 시작일 2025-06-24 — 기준일 이후 유효 활동만 KPI 집계, 이전 기록은 삭제하지 않고 이력으로 보존
   · 단계 정의(팀 확정): L2 = 영업보고(원천 없음) · L3 = 기술자문문의·공법설명회(PT)·기타문의·컨설팅내역서 요청 · L4 = 공고·낙찰
     시트 16탭의 L2→L3 는 '구 정의(L2 = 기술자문 여정)'로 참고·전환 관리 후보에만 쓴다(정의 충돌은 확인 필요 항목)
   · 근거가 없는 값은 만들지 않는다: 값 없음 = null → 화면에서 '미확인·집계 불가·검증 필요'
   ============================================================ */
(function (root) {
  "use strict";
  var START = "2025-06-24";
  var OBS_DAYS_DEFAULT = 180;                 /* 낙찰 후 구매 관찰 기간(기본값 · 화면에서 변경, 확정 필요) */
  var FUP_DAYS_DEFAULT = 14;                  /* 컨설팅 요청 후 발행 확인 대기일(기본값 · 화면에서 변경, 확정 필요) */
  /* L3 활동 원천: [탭, 날짜열, 업체열, 유형, 현장열, 주소열, 공종열] — 샘플·카탈로그(9)는 L3 분류 미확정이라 참고 */
  var ACT = [
    ["7.기술자문문의", "접수일자", "협력사명", "기술자문 문의", "L3", "현장명", "주소", "공종"],
    ["8.컨설팅요청", "등록일자", "업체", "컨설팅내역서 요청", "L3", "현장명", "주소", "공종별"],
    ["10.공법설명회이력", "등록일", "시공사", "공법설명회(PT)", "L3", "현장명", "주소", "공종"],
    ["11.기타문의답변", "등록일", "업체명", "기타 문의", "L3", null, null, null],
    ["9.샘플카탈로그요청", "접수일시", "업체", "샘플·카탈로그 요청", "참고", null, "주소", null]
  ];
  function ymd(s) { return String(s == null ? "" : s).slice(0, 10); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function addDays(d, n) { var t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000); }
  function norm(s) { return String(s == null ? "" : s).replace(/[\s·.,()\[\]]/g, "").toLowerCase(); }

  function build(src, opt) {
    opt = opt || {}; var obsDays = opt.obsDays || OBS_DAYS_DEFAULT, fupDays = opt.fupDays || FUP_DAYS_DEFAULT;
    var need = ["17.장기무활동", "2.시공사마스터", "7.기술자문문의"]; var miss = need.filter(function (t) { return !src.has(t); });
    if (miss.length) return { error: true, missing: miss };
    var O = function (t) { return src.has(t) ? src.objs(t) : []; };
    var life = O("17.장기무활동"), master = O("2.시공사마스터");
    var asOf = (life[0] && ymd(life[0]["기준일"])) || ymd((O("1.통합KPI").slice(-1)[0] || {})["기준"]).replace(/^~/, "") || START;
    var V = {}, order = [];
    function vend(id, name) { if (!id) return null; if (!V[id]) { V[id] = { id: id, name: name || id, managed: false, mou: "", mouStatus: "협약일 미확인", core: false, joined: "", acts: [], l3: [], awards: [], buys: {}, verdict: "", lastActDt: "", lastActType: "", firstContact: "", flags: [] }; order.push(id); } if (name && V[id].name === id) V[id].name = name; return V[id]; }
    life.forEach(function (r) { var v = vend(r["통합ID"], r["업체명"]); v.managed = true; v.verdict = r["판정"] || ""; v.lastActDt = ymd(r["마지막활동일"]); v.lastActType = r["마지막활동유형"] || ""; v.core = r["핵심협력사"] === "Y"; v.cardId = r["B2B고유번호"] || ""; });
    master.forEach(function (r) { var id = r["통합ID"]; if (!id) return; var v = V[id] || null; if (!v && !(r["B2B고유번호"] || r["연결상태"])) { return; } v = vend(id, r["대표업체명"]); var m = ymd(r["협약일"]); if (m) { v.mou = m; v.mouStatus = "협약"; } v.cardId = v.cardId || r["B2B고유번호"] || ""; });
    O("7b.플랫폼가입현황").forEach(function (r) { var v = vend(r["통합ID"], r["업체명"]); if (v) { var d = ymd(r["가입일자"]); if (d && (!v.joined || d < v.joined)) v.joined = d; } });
    /* 활동 */
    var tradeRows = [];
    ACT.forEach(function (d) { O(d[0]).forEach(function (r) { var id = r["통합ID"]; var dt = ymd(r[d[1]]); if (!dt) return; var v = id ? vend(id, r[d[2]]) : null; var a = { dt: dt, type: d[3], stage: d[4], src: d[0], site: d[5] ? r[d[5]] || "" : "", addr: d[6] ? r[d[6]] || "" : "", trade: d[7] ? r[d[7]] || "" : "" }; if (v) { v.acts.push(a); if (!v.firstContact || dt < v.firstContact) v.firstContact = dt; } if (a.stage === "L3") tradeRows.push({ dt: dt, id: id || "", trade: a.trade || "" }); }); });
    /* 21.잔디등_L3활동: 플랫폼 이전 L3(잔디 기술문의·잔디 PT·컨설팅 발행현황·PT 실적보고서) — 플랫폼 탭과 겹치지 않는 원천만 들어 있다. 대표 기록·유효 L3(확정+요청)만 쓰고 업체 미기재는 시공사에 붙이지 않는다 */
    O("21.잔디등_L3활동").forEach(function (r) {
      if (r["단계"] !== "L3" || r["대표여부"] !== "Y" || r["내부테스트"] === "Y" || !(r["L3인정"] === "확정" || r["L3인정"] === "요청")) return;
      var id = r["통합ID"], dt = ymd(r["활동일"]); if (!id || !dt) return; var v = vend(id, r["업체명"]);
      var a = { dt: dt, type: r["활동유형"] || "L3", stage: "L3", src: "21.잔디등_L3활동 · " + (r["출처"] || ""), site: r["현장원문"] || "", addr: r["주소"] || "", trade: r["공종그룹"] || "", siteId: r["현장ID"] || "" };
      v.acts.push(a); if (!v.firstContact || dt < v.firstContact) v.firstContact = dt; tradeRows.push({ dt: dt, id: id, trade: a.trade });
    });
    /* 23.경로전환_시공사별: 업체×현장×공종 조합 기준 L3 → L4 도달(영업보고 원천이 없으면 경로 미확정) */
    var PV = {}; O("23.경로전환_시공사별").forEach(function (r) { var id = r["통합ID"]; if (!id) return; var n = function (k) { var x = Number(r[k]); return isFinite(x) ? x : 0; }; PV[id] = { n: n("조합 수(업체×현장×공종)"), l2: n("L2 건수"), l3: n("L3 건수"), pub: n("L4 공고 도달 조합"), win: n("L4 낙찰 도달 조합(누구든)"), winSame: n("같은 업체 낙찰 조합"), text: r["경로 구분(조합 수)"] || "" }; });
    /* 낙찰(5) · 반영공고(5b) */
    var awardsAll = O("5.POUR공고낙찰");
    awardsAll.forEach(function (r) { var id = r["통합ID"]; var v = id ? vend(id, r["낙찰시공사"]) : null; var dt = ymd(r["공고일"]); if (!v || !dt) return; v.awards.push({ dt: dt, site: r["현장명"] || "", trade: r["공종그룹"] || "", amt: isNum(r["낙찰금액"]) ? r["낙찰금액"] : null }); });
    /* 구매(4) 연 단위 */
    O("4.메인자재구매현황").forEach(function (r) { var id = r["통합ID"]; var v = id ? V[id] : null; if (!v) return; var y = String(r["연도"]); var b = v.buys[y] = v.buys[y] || { net: 0, main: null, mainOK: false }; if (isNum(r["전체순매출"])) b.net += r["전체순매출"]; if (isNum(r["메인자재순매출"])) { b.main = (b.main || 0) + r["메인자재순매출"]; b.mainOK = true; } });
    /* 16b: 구 정의 L2→L3 시공사별 */
    var old = {}; O("16b.L2L3시공사별").forEach(function (r) { old[r["통합ID"]] = r; });
    var oldL2Last = {}; O("16.L2L3전환").forEach(function (r) { var id = r["통합ID"], d = ymd(r["L2일자"]); if (id && d && (!oldL2Last[id] || d > oldL2Last[id])) oldL2Last[id] = d; });
    var hasL2Source = src.has("영업보고") || (src.has("22.영업보고") && O("22.영업보고").length > 0);      /* 현재 25탭에는 영업보고 탭이 없다 */
    /* 시공사별 파생 */
    var obsEnd = function (dt) { return addDays(dt, obsDays); };
    var rows = order.map(function (id) {
      var v = V[id]; v.acts.sort(function (a, b) { return a.dt.localeCompare(b.dt); });
      v.l3 = v.acts.filter(function (a) { return a.stage === "L3" && a.dt >= START && a.dt <= asOf; });
      var anyAct = v.acts.filter(function (a) { return a.dt <= asOf; }), last = anyAct.length ? anyAct[anyAct.length - 1] : null;
      var lastDt = last ? last.dt : v.lastActDt;
      var sites = {}; v.l3.forEach(function (a) { var k = a.addr ? norm(a.addr) : a.site ? "n:" + norm(a.site) : ""; if (k) sites[k] = 1; });
      var winAw = v.awards.filter(function (a) { return a.dt >= START && a.dt <= asOf; });
      var pastAw = v.awards.filter(function (a) { return a.dt < START; });
      var stage = v.l3.length ? "L3" : "확인 필요";
      var entry = !v.l3.length ? "—" : hasL2Source ? "확인 필요" : "경로 확인 필요";
      var d = (v.verdict === "정상") ? "활성" : v.verdict === "장기 무활동" ? "이탈 위험" : v.verdict === "활동 이력 없음" ? "활동 이력 없음" : "확인 필요";
      var mgmt = d; if (d === "활성" && old[id] && old[id]["미전환"] > 0 && !(old[id]["L3전환_확정"] > 0)) mgmt = "전환 관리";
      /* 낙찰 후 구매: 연 단위 순매출(4탭) — 낙찰 연도 이후 구매 확인 여부(연결 후보) */
      var buyState = "해당 없음", buyNote = "";
      if (winAw.length) {
        var firstAw = winAw.map(function (a) { return a.dt; }).sort()[0], y0 = firstAw.slice(0, 4);
        var bought = Object.keys(v.buys).some(function (y) { return y >= y0 && v.buys[y].net > 0; });
        var obsDone = obsEnd(firstAw) <= asOf;
        buyState = bought ? "구매 연결 후보" : obsDone ? "낙찰 후 구매 미확인" : "관찰 중";
        buyNote = "첫 낙찰(공고일) " + firstAw + " · 관찰 " + obsDays + "일 " + (obsDone ? "종료" : "~" + obsEnd(firstAw)) + " · 연 단위 자재 순매출 기준";
      }
      var mainBuy = Object.keys(v.buys).some(function (y) { return y >= "2024" && v.buys[y].mainOK && v.buys[y].main > 0; }) ? "Y" : (Object.keys(v.buys).some(function (y) { return y >= "2024" && v.buys[y].mainOK; }) ? "N" : "미확인");
      var inactDays = lastDt ? diffDays(lastDt, asOf) : null;
      return { id: id, name: v.name, managed: v.managed, core: v.core, mou: v.mou, mouStatus: v.mouStatus, joined: v.joined, firstContact: v.firstContact || "", lastActDt: lastDt, lastActType: last ? last.type : v.lastActType, inactDays: inactDays,
        stage: stage, entry: entry, l3n: v.l3.length, sites: Object.keys(sites).length, types: uniq(v.l3.map(function (a) { return a.type; })), trades: uniq(v.l3.map(function (a) { return a.trade; }).filter(Boolean)),
        preN: v.acts.filter(function (a) { return a.dt < START; }).length,
        awardN: winAw.length, awardPre: pastAw.length, awardAmt: winAw.reduce(function (s, a) { return s + (a.amt || 0); }, 0), awardLast: winAw.length ? winAw.map(function (a) { return a.dt; }).sort().pop() : "", buyState: buyState, buyNote: buyNote, mainBuy: mainBuy, path: PV[id] || null,
        verdict: v.verdict, mgmt: mgmt, core: v.core, cardId: v.cardId || "", oldL2: old[id] ? old[id]["유효L2"] : null, oldConv: old[id] ? old[id]["L3전환_확정"] : null, oldUnconv: old[id] ? old[id]["미전환"] : null, oldL2Last: oldL2Last[id] || "" };
    });
    function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
    var managed = rows.filter(function (r) { return r.managed; });
    var rowBy = {}; rows.forEach(function (r) { rowBy[r.id] = r; });
    /* 데이터 신뢰 구간: 기술문의(7탭)가 월 20건 이상 쌓이기 시작한 달 — 그 이전은 비교하지 않는다 */
    var mc = {}; O("7.기술자문문의").forEach(function (r) { var m = ymd(r["접수일자"]).slice(0, 7); if (m) mc[m] = (mc[m] || 0) + 1; });
    var reliable = Object.keys(mc).sort().filter(function (m) { return mc[m] >= 20; })[0] || "";
    var reliableFrom = reliable ? reliable + "-01" : "";
    /* 요약 */
    var l3v = rows.filter(function (r) { return r.l3n > 0; }), awv = rows.filter(function (r) { return r.awardN > 0; });
    var S = { asOf: asOf, start: START, hasL2Source: hasL2Source, reliableFrom: reliableFrom,
      managed: managed.length, active: managed.filter(function (r) { return r.verdict === "정상"; }).length, dormant: managed.filter(function (r) { return r.verdict === "장기 무활동"; }).length, noHistory: managed.filter(function (r) { return r.verdict === "활동 이력 없음"; }).length,
      l3Vendors: l3v.length, l3VendorsManaged: l3v.filter(function (r) { return r.managed; }).length, pathUnknown: rows.filter(function (r) { return r.entry === "경로 확인 필요"; }).length, direct: rows.filter(function (r) { return r.entry === "직접진입"; }).length,
      awardVendors: awv.length, l3AndAward: rows.filter(function (r) { return r.l3n > 0 && r.awardN > 0; }).length,
      buyCand: awv.filter(function (r) { return r.buyState === "구매 연결 후보"; }).length, buyMissing: awv.filter(function (r) { return r.buyState === "낙찰 후 구매 미확인"; }).length, buyObserving: awv.filter(function (r) { return r.buyState === "관찰 중"; }).length,
      mou: rows.filter(function (r) { return r.mou; }).length, mouNone: managed.filter(function (r) { return !r.mou; }).length, mouInWindow: rows.filter(function (r) { return r.mou && r.mou >= START; }).length,
      coreN: managed.filter(function (r) { return r.core; }).length, coreActive: managed.filter(function (r) { return r.core && r.verdict === "정상"; }).length,
      oldRate: (function () { var t = O("18.선행지표요약").filter(function (x) { return String(x["지표"]).indexOf("[공식] L2→L3 전환율") === 0; })[0]; return t && isNum(t["값"]) ? t["값"] : null; })(),
      oldDays: (function () { var t = O("18.선행지표요약").filter(function (x) { return String(x["지표"]).indexOf("[공식] 평균 전환 소요일") === 0; })[0]; return t && isNum(t["값"]) ? t["값"] : null; })() };
    /* 결과 KPI (분석 기준일 이후 · 시트 기록 기준) */
    var awW = awardsAll.filter(function (r) { var d = ymd(r["공고일"]); return d >= START && d <= asOf; });
    S.result = { notices: O("5b.POUR반영공고").filter(function (r) { var d = ymd(r["공고일"]); return r["집계대상"] === "Y" && d >= START && d <= asOf; }).length, awards: awW.length, awardAmt: awW.reduce(function (s2, r) { return s2 + (isNum(r["낙찰금액"]) ? r["낙찰금액"] : 0); }, 0), awardAmtMissing: awW.filter(function (r) { return !isNum(r["낙찰금액"]); }).length,
      buyDen: S.buyCand + S.buyMissing, buyRate: (S.buyCand + S.buyMissing) ? S.buyCand / (S.buyCand + S.buyMissing) : null };
    /* 선행지표 ① 핵심 시공사: 최근 90일 vs 직전 90일 활동 업체 */
    function activeIn(rs, from, to) { return rs.filter(function (r) { return r.core && V[r.id].acts.some(function (a) { return a.stage === "L3" && a.dt >= from && a.dt <= to; }); }).length; }
    var cur0 = addDays(asOf, -89), prv1 = addDays(asOf, -90), prv0 = addDays(asOf, -179);
    var coreRows = managed.filter(function (r) { return r.core; });
    var L1 = { n: coreRows.length, cur: activeIn(coreRows, cur0, asOf), prev: activeIn(coreRows, prv0, prv1), comparable: !!reliableFrom && prv0 >= reliableFrom, curFrom: cur0, prevFrom: prv0, prevTo: prv1,
      up: [], down: [], none: [] };
    coreRows.forEach(function (r) { var a = V[r.id].acts.filter(function (x) { return x.stage === "L3"; }); var c = a.filter(function (x) { return x.dt >= cur0 && x.dt <= asOf; }).length, p = a.filter(function (x) { return x.dt >= prv0 && x.dt <= prv1; }).length; var o = { id: r.id, name: r.name, cur: c, prev: p }; if (!c && !p) L1.none.push(o); else if (c > p) L1.up.push(o); else if (c < p) L1.down.push(o); });
    /* 선행지표 ③ 공법별(공종) 요청 — 월별 */
    var mons = []; { var y = +asOf.slice(0, 4), m = +asOf.slice(5, 7); for (var i = 0; i < 4; i++) { mons.unshift(y + "-" + (m < 10 ? "0" : "") + m); m--; if (m < 1) { m = 12; y--; } } }
    var tr = {}; tradeRows.forEach(function (t) { var mm = t.dt.slice(0, 7); if (mons.indexOf(mm) < 0) return; var k = t.trade || "공법 미분류"; var o = tr[k] = tr[k] || { trade: k, m: {}, vendors: {} }; o.m[mm] = (o.m[mm] || 0) + 1; if (t.id) o.vendors[t.id] = 1; });
    var trades = Object.keys(tr).map(function (k) { var o = tr[k]; var tot = mons.reduce(function (s, mm) { return s + (o.m[mm] || 0); }, 0); return { trade: k, series: mons.map(function (mm) { return o.m[mm] || 0; }), total: tot, vendors: Object.keys(o.vendors).length }; }).sort(function (a, b) { return b.total - a.total; });
    var comparable3 = !!reliableFrom && mons[0] + "-01" >= reliableFrom;
    /* 낙찰 공종(실제 반영 근거, 요청과 분리) */
    var awTrade = {}; awardsAll.forEach(function (r) { var d = ymd(r["공고일"]); if (d < START || d > asOf) return; var k = r["공종그룹"] || "공법 미분류"; awTrade[k] = (awTrade[k] || 0) + 1; });
    /* 추천 관리 대상 (자동 업무 생성 없음) */
    var recs = [];
    rows.forEach(function (r) { if (r.managed && r.oldUnconv > 0 && !(r.oldConv > 0) && r.oldL2 > 0) recs.push({ type: "A", key: "A|" + r.id, id: r.id, name: r.name, reason: "기술자문 " + r.oldL2 + "건 이후 컨설팅·설명회 등 전환 근거 없음(구 정의, 시트 16탭 · 미전환 " + r.oldUnconv + "건)", kpi: "L2→L3 전환(구 정의 참고)", last: r.oldL2Last || r.lastActDt, next: "전환 가능 현장 확인 후 컨설팅·설명회 제안", score: r.oldUnconv, core: r.core }); });
    rows.forEach(function (r) { if (r.buyState === "낙찰 후 구매 미확인") recs.push({ type: "B", key: "B|" + r.id, id: r.id, name: r.name, reason: "POUR 낙찰 " + r.awardN + "건(기준일 이후) · 관찰 " + obsDays + "일 안에 자재 구매가 확인되지 않음", kpi: "낙찰 후 구매 연결률", last: r.awardLast, next: "낙찰 현장 자재 조달 계획 확인", score: r.awardN, core: r.core }); });
    rows.forEach(function (r) { if (r.managed && r.verdict === "장기 무활동") recs.push({ type: "C", key: "C|" + r.id, id: r.id, name: r.name, reason: "마지막 활동 " + (r.lastActDt || "—") + (r.inactDays != null ? " (" + r.inactDays + "일 경과)" : "") + (r.core ? " · 핵심 시공사(임시 정의)" : ""), kpi: "장기 무활동", last: r.lastActDt, next: "재접촉(근황·신규 현장 확인)", score: r.inactDays || 0, core: r.core }); });
    var issued = {}; O("8b.컨설팅발행이력").forEach(function (r) { if (r["통합ID"]) issued[r["통합ID"] + "|" + norm(r["현장명"])] = 1; });
    var dmap = {}; O("8.컨설팅요청").forEach(function (r) { var d = ymd(r["등록일자"]); var id = r["통합ID"]; if (!id || !d || d < START) return; if (r["발행일시"] || r["발행종류"] || issued[id + "|" + norm(r["현장명"])]) return; if (diffDays(d, asOf) < fupDays) return; var o = dmap[id] = dmap[id] || { n: 0, last: "", first: d, site: r["현장명"] || "" }; o.n++; if (d > o.last) { o.last = d; o.site = r["현장명"] || o.site; } if (d < o.first) o.first = d; });
    Object.keys(dmap).forEach(function (id) { var o = dmap[id], v = V[id]; recs.push({ type: "D", key: "D|" + id, id: id, name: v ? v.name : id, reason: "컨설팅 요청 " + o.n + "건(" + o.first + (o.last !== o.first ? " ~ " + o.last : "") + ") 후 " + fupDays + "일 이상 발행 기록 없음" + (o.site ? " · 최근 " + o.site : ""), kpi: "컨설팅 후속", last: o.last, next: "발행 여부·후속 자료 제공 확인", score: o.n, core: !!(v && v.core) }); });
    rows.forEach(function (r) { if (r.managed && !r.mou) recs.push({ type: "E", key: "E|" + r.id, id: r.id, name: r.name, reason: "협약일이 확인되지 않아 신규·기존을 판정하지 못함" + (r.l3n ? " · 기간 내 L3 활동 " + r.l3n + "건" : ""), kpi: "신규 업체 사용률(대상 판정)", last: r.lastActDt, next: "고객관리카드·MOU 체결서로 협약일 확인", score: r.l3n, core: r.core }); });
    if (L1.comparable) coreRows.forEach(function (r) { var o = L1.down.filter(function (x) { return x.id === r.id; })[0]; if (o) recs.push({ type: "F", key: "F|" + r.id, id: r.id, name: r.name, reason: "핵심 시공사(임시 정의) 활동 감소 · 최근 90일 " + o.cur + "건 / 직전 90일 " + o.prev + "건", kpi: "핵심 시공사 이용률", last: r.lastActDt, next: "감소 원인 확인·재접촉", score: o.prev - o.cur, core: true }); });
    var recBy = { A: [], B: [], C: [], D: [], E: [], F: [] }; recs.forEach(function (x) { recBy[x.type].push(x); }); Object.keys(recBy).forEach(function (k) { recBy[k].sort(function (a, b) { return (b.core ? 1 : 0) - (a.core ? 1 : 0) || b.score - a.score; }); });
    /* 한 시공사가 여러 조건에 걸리면 사유를 모두 보여 준다(중복 제거 후 시공사 수는 summary.mgmtUnique) */
    var RL = { A: ["전환 미완(구 정의)", "warn"], B: ["낙찰 후 구매 미확인", "bad"], C: ["장기 무활동", "bad"], D: ["컨설팅 후속", "warn"], E: ["협약일 미확인", "na"], F: ["활동 감소", "warn"] };
    recs.forEach(function (x) { var r = rowBy[x.id]; if (r) { r.reasons = r.reasons || []; r.reasons.push({ type: x.type, label: RL[x.type][0], kind: RL[x.type][1] }); } });
    S.mgmtUnique = rows.filter(function (r) { return r.managed && r.reasons && r.reasons.length; }).length; S.mgmtMulti = rows.filter(function (r) { return r.managed && r.reasons && r.reasons.length > 1; }).length;
    S.recCounts = { A: recBy.A.length, B: recBy.B.length, C: recBy.C.length, D: recBy.D.length, E: recBy.E.length, F: recBy.F.length };
    return { start: START, asOf: asOf, obsDays: obsDays, fupDays: fupDays, summary: S, rows: rows, rowBy: rowBy, lead: { core: L1, trades: trades, mons: mons, tradesComparable: comparable3, awardTrades: awTrade }, recs: recBy };
  }
  root.B2BOps = { START: START, build: build, OBS_DAYS_DEFAULT: OBS_DAYS_DEFAULT, FUP_DAYS_DEFAULT: FUP_DAYS_DEFAULT };
  if (typeof module !== "undefined" && module.exports) module.exports = root.B2BOps;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
