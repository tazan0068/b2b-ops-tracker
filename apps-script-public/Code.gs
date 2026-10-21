/* B2B 공개 집계 웹앱 — 자동 생성 파일(수정하지 마세요. 원본: build/growth-core.js · build/public-pack.js · pipeline/apps-script-public/wrapper.gs)
   설정 방법은 같은 폴더의 README.md 를 보세요. */

/* ===== [1부-a] 성장 분석 집계 모듈 ===== */
/* ============================================================
   POUR 사업 성장 분석 — 집계 모듈 (화면 없음 · 브라우저/Node 공용)
   · 입력: 시트 탭 객체 배열(1.통합KPI · 2.시공사마스터 · 3.이카운트판매원문(선택) · 4.메인자재구매현황 · 5.POUR공고낙찰 · 5b.POUR반영공고 · 12.거래처연결검토 …)
   · 기존 KPI 정의를 바꾸지 않는다: 연간·동일기간(1/1~기준일) 값은 1.통합KPI 탭 값을 그대로 쓰고, 원문이 있으면 원문 합계와 대조한다.
   · 없는 값은 0 으로 채우지 않는다 — null + 사유(why)로 반환한다. 비교 불가 지표는 pct=null, state="na".
   · 연결 등급: 사업자번호로 법인이 확정되지 않은 구매 연결은 '후보'. 구매 기록이 없어도 타사 자재 사용으로 판단하지 않는다.
   · 업무 기록 저장소(netform.b2b.tracker.v1)·브라우저 저장소는 읽지도 쓰지도 않는다.
   ============================================================ */
(function (root) {
  "use strict";
  var FAMS = ["재도장", "우레탄", "에폭시"];
  var FAM_LABEL = { "재도장": "페인트(재도장)", "우레탄": "우레탄 중도", "에폭시": "에폭시 중도" };
  var ACT = [["7.기술자문문의", "접수일자", "협력사명", "기술자문 문의"], ["8.컨설팅요청", "등록일자", "업체", "컨설팅 요청"], ["10.공법설명회이력", "등록일", "시공사", "공법설명회"], ["9.샘플카탈로그요청", "접수일시", "업체", "샘플·카탈로그"], ["11.기타문의답변", "등록일", "업체명", "기타 문의"]];
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function ymd(s) { return String(s == null ? "" : s).slice(0, 10); }
  function nz(s) { return String(s == null ? "" : s).replace(/\s|아파트|단지|\(|\)|㈜|주식회사/g, ""); }
  /* 메인자재 품목군 분류 규칙(수정 가능): 앞에서부터 처음 맞는 규칙. 기본값은 검증된 품목 분류표와 같은 결과를 내는 규칙 */
  var DEFAULT_FAM_RULES = [{ fam: "우레탄", re: "우레탄" }, { fam: "에폭시", re: "에폭시" }, { fam: "재도장", re: "페인트" }];
  function famOf(name, rules) { name = String(name || ""); rules = rules || DEFAULT_FAM_RULES; for (var i = 0; i < rules.length; i++) { try { if (new RegExp(rules[i].re).test(name)) return rules[i].fam; } catch (e) {} } return null; }
  function sumBy(arr, f) { var s = 0; for (var i = 0; i < arr.length; i++) { var v = f(arr[i]); if (isNum(v)) s += v; } return s; }
  function uniq(arr) { var m = {}, out = []; arr.forEach(function (x) { if (x != null && !m[x]) { m[x] = 1; out.push(x); } }); return out; }

  /* 증감: base 가 없거나 0 이면 증감률을 만들지 않는다 */
  function growth(cur, base, block) {
    if (block) return { abs: null, pct: null, state: "na", why: block };
    if (!isNum(cur)) return { abs: null, pct: null, state: "na", why: "해당 기간 값 없음(데이터 부족)" };
    if (!isNum(base)) return { abs: null, pct: null, state: "na", why: "비교 대상 기간 값 없음(데이터 부족)" };
    if (base === 0) return { abs: cur - base, pct: null, state: "na", why: "비교 대상이 0이라 증감률 산출 불가" };
    return { abs: cur - base, pct: (cur - base) / Math.abs(base), state: "ok", why: null };
  }
  function rateDiff(cur, base, block) {            /* 비율 간 차이(%p) */
    if (block) return { pp: null, state: "na", why: block };
    if (!isNum(cur) || !isNum(base)) return { pp: null, state: "na", why: "비율을 산출할 수 없는 기간 포함(데이터 부족)" };
    return { pp: (cur - base) * 100, state: "ok", why: null };
  }

  /* 비교 가능 여부 · 증감 — 원문 집계(build)와 공개 집계값(buildPublic)이 같은 규칙을 쓰도록 분리 */
  function attachCompare(G, c) {
    var prevOf = c.prevOf, lastY = c.lastY, endMD = c.endMD, mainOK = c.mainOK, firstSale = c.firstSale, metrics = c.metrics, led = c.led;
    function blockFor(basis, y, key) {
      var p = prevOf(y); if (!p) return "비교할 전년 자료 없음";
      if (basis === "ann" && y === lastY) return "연중 누계(" + endMD.replace("-", "/") + "까지)라 전년 연간과 직접 비교할 수 없음 — '동일기간' 보기를 사용하세요";
      if (key === "main" || key === "mainAmt" || key === "mainRate") { if (!mainOK(y)) return y + "년 메인자재 값 미확인(품목명 검증 전)"; if (!mainOK(p)) return p + "년 메인자재 값 미확인(품목명 검증 전)"; if (!led) return "판매 원문을 읽는 중 — 메인자재 첫 판매일 확인 후 표시"; if (firstSale.main) { var pStart = p + "-01-01"; if (firstSale.main > pStart) return p + "년은 메인자재 판매 개시 연도(첫 판매 " + firstSale.main + ")라 연 전체 기간과 비교할 수 없음"; } }
      if (key === "ratio" || key === "notices") { }
      return null;
    }
    G.blockFor = blockFor;
    G.growth = function (basis, y, key) {
      var p = prevOf(y), c = metrics(basis, y), b = p ? metrics(basis, p) : null, blk = blockFor(basis, y, key);
      var map = { notices: "notices", noticesPour: "noticesPour", awards: "awards", awardAmt: "awardAmt", awardVendors: "awardVendors", sales: "sales", main: "main" };
      if (key === "ratio") return rateDiff(c.awardRatio, b && b.awardRatio, blk);
      if (key === "buyRate") return rateDiff(c.cohort && c.cohort.buyRate, b && b.cohort && b.cohort.buyRate, blk);
      if (key === "mainRate") return rateDiff(c.cohort && c.cohort.mainRate, b && b.cohort && b.cohort.mainRate, blockFor(basis, y, "mainRate"));
      if (key === "mainShare") return rateDiff(c.mainShare, b && b.mainShare, blockFor(basis, y, "main"));
      if (key === "cohortBuyAmt") return growth(c.cohort && c.cohort.buyAmt, b && b.cohort && b.cohort.buyAmt, blk);
      if (!map[key]) return growth(null, null, "알 수 없는 지표");
      return growth(c[map[key]], b && b[map[key]], key === "main" ? blockFor(basis, y, "main") : blk);
    };
    /* 메인 3품목 증감: 기준 기간 전체에 판매가 있었는지(판매 개시 이전 기간 혼재)를 확인 */
    G.famGrowth = function (basis, y, fam) {
      var p = prevOf(y), c = metrics(basis, y), b = p ? metrics(basis, p) : null; var blk = null;
      if (!p) blk = "비교할 전년 자료 없음"; else if (basis === "ann" && y === lastY) blk = blockFor(basis, y, "x"); else if (!c.fam || !b || !b.fam) blk = !isNum(c.main) || !(b && isNum(b.main)) ? "메인자재 값 미확인 연도 포함" : "원문을 읽어 오는 중이라 계산 전";
      else if (firstSale[fam] && firstSale[fam] > p + "-01-01") blk = p + "년 " + FAM_LABEL[fam] + " 판매 개시(첫 판매 " + firstSale[fam] + ") — 개시 이전 기간이 섞여 비교 불가";
      return growth(c.fam && c.fam[fam], b && b.fam && b.fam[fam], blk);
    };
    G.famStatus = function (basis, y, fam) {       /* 값 대신 상태 문구: 판매 개시 전은 0 이 아니라 '판매 전' */
      var m = metrics(basis, y); if (!isNum(m.main)) return { code: "unverified", label: "미확인" }; if (!m.fam) return { code: "wait", label: "원문 읽는 중" };
      var fs = firstSale[fam]; var end = basis === "ann" ? y + "-12-31" : y + "-" + endMD; if (fs && fs > end) return { code: "prelaunch", label: "판매 개시 전" };
      return { code: "ok", label: null };
    };

  }

  function build(src, opt) {
    opt = opt || {};
    var need = ["1.통합KPI", "2.시공사마스터", "4.메인자재구매현황", "5.POUR공고낙찰", "5b.POUR반영공고"];
    var missing = need.filter(function (n) { return !src.has(n); });
    var defs = opt.defs || {}; var famRules = defs.famRules && defs.famRules.length ? defs.famRules : DEFAULT_FAM_RULES;
    var G = { missing: missing, years: [], endMD: defs.endMD || opt.endMD || "10-20", ledgerReady: false, notes: [], famRules: famRules };
    if (missing.indexOf("1.통합KPI") >= 0) return G;
    var K = src.objs("1.통합KPI"), MS = src.has("2.시공사마스터") ? src.objs("2.시공사마스터") : [], M4 = src.has("4.메인자재구매현황") ? src.objs("4.메인자재구매현황") : [], A = src.has("5.POUR공고낙찰") ? src.objs("5.POUR공고낙찰") : [], B5 = src.has("5b.POUR반영공고") ? src.objs("5b.POUR반영공고") : [], R12 = src.has("12.거래처연결검토") ? src.objs("12.거래처연결검토") : [];
    var led = src.ledger ? src.ledger() : null; G.ledgerReady = !!led;
    var years = K.map(function (r) { return String(r["연도"]); }); G.years = years; var lastY = years[years.length - 1]; G.lastY = lastY;
    var kBase = String((K[K.length - 1] || {})["기준"] || ""); var mm = kBase.match(/(\d{1,2})\/(\d{1,2})/); if (mm && !opt.endMD && !defs.endMD) G.endMD = ("0" + mm[1]).slice(-2) + "-" + ("0" + mm[2]).slice(-2);
    var endMD = G.endMD; G.asOf = lastY + "-" + endMD;
    var kRow = {}; K.forEach(function (r) { kRow[String(r["연도"])] = r; });
    var master = {}; MS.forEach(function (r) { master[r["통합ID"]] = r; });
    function inP(basis, d) { return basis === "ann" || ymd(d).slice(5) <= endMD; }
    function prevOf(y) { var i = years.indexOf(y); return i > 0 ? years[i - 1] : null; }
    G.prevOf = prevOf; G.kpi = function (y) { return kRow[y] || null; }; G.master = function (id) { return master[id] || null; };

    /* ---------- 원문 인덱스 (연간 · 동일기간) ---------- */
    var ann = {}, ytd = {}, firstSale = { main: null, 재도장: null, 우레탄: null, 에폭시: null }, ledgerTotals = { ann: {}, ytd: {}, mainAnn: {}, mainYtd: {} };
    function rec(tbl, y, id) { var t = tbl[y] || (tbl[y] = {}); return t[id] || (t[id] = { total: 0, amt: 0, main: 0, stage: 0, nonmat: 0, fam: { "재도장": 0, "우레탄": 0, "에폭시": 0 }, items: {}, mi: {}, last: null, mainLast: null, mainPaid: false }); }
    if (led) {
      for (var i = 0; i < led.length; i++) {
        var r = led[i]; if (r["순매출포함"] !== "포함" || !isNum(r["공급가액"])) continue;
        var y = String(r["연도"]), id = r["통합ID"], d = ymd(r["거래일자"]), a = r["공급가액"], cls = r["메인자재분류"], nm = r["품목명·규격"] || "(품목명 없음)", f = cls === "핵심 메인" ? famOf(nm, famRules) : null;
        var tg = [ann]; if (d.slice(5) <= endMD) tg.push(ytd);
        for (var t = 0; t < tg.length; t++) {
          var c = rec(tg[t], y, id); c.total += a; if (cls === "비자재·용역") c.nonmat += a; else c.amt += a;
          if (cls === "핵심 메인") { c.main += a; if (f) c.fam[f] += a; var mi = c.mi[nm] || (c.mi[nm] = { q: 0, a: 0 }); mi.q += (isNum(r["수량"]) ? r["수량"] : 0); mi.a += a; if (a > 0 && (!c.mainLast || d > c.mainLast)) c.mainLast = d; }
          else if (cls === "하도·상도") c.stage += a;
          if (cls !== "비자재·용역") c.items[nm] = (c.items[nm] || 0) + a;
          if (a > 0 && cls !== "비자재·용역" && (!c.last || d > c.last)) c.last = d;
        }
        var lt = ledgerTotals.ann; lt[y] = (lt[y] || 0) + a; if (d.slice(5) <= endMD) { var l2 = ledgerTotals.ytd; l2[y] = (l2[y] || 0) + a; }
        if (cls === "핵심 메인") { var ma = ledgerTotals.mainAnn; ma[y] = (ma[y] || 0) + a; if (d.slice(5) <= endMD) { var my = ledgerTotals.mainYtd; my[y] = (my[y] || 0) + a; } if (a > 0) { if (!firstSale.main || d < firstSale.main) firstSale.main = d; if (f && (!firstSale[f] || d < firstSale[f])) firstSale[f] = d; } }
      }
      [ann, ytd].forEach(function (tbl) { for (var yy in tbl) for (var ii in tbl[yy]) { var cc = tbl[yy][ii]; for (var k in cc.mi) if (cc.mi[k].q > 0 && cc.mi[k].a > 0) cc.mainPaid = true; } });
    }
    G.firstSale = firstSale; G.ledgerTotals = ledgerTotals;
    /* 4.메인자재구매현황 (연간 · 원문 없이도 사용) */
    var m4 = {}; M4.forEach(function (r) { var y = String(r["연도"]); (m4[y] = m4[y] || {})[r["통합ID"]] = r; });
    function mainOK(y) { var k = kRow[y]; return !!k && isNum(k["메인자재순매출"]); }
    G.mainOK = mainOK;
    /* 구매 기록 조회: basis/연도/ID → {amt, main, mainPaid, fam, last, items} 또는 null(알 수 없음) */
    function buyRec(basis, y, id) {
      var tbl = basis === "ann" ? ann : ytd;
      if (led) { var c = (tbl[y] || {})[id]; return c || { total: 0, amt: 0, main: 0, stage: 0, nonmat: 0, fam: { "재도장": 0, "우레탄": 0, "에폭시": 0 }, items: {}, last: null, mainLast: null, mainPaid: false, none: true }; }
      if (basis === "ann") { var r = (m4[y] || {})[id]; if (!r) return { total: 0, amt: 0, main: 0, stage: 0, nonmat: 0, fam: { "재도장": 0, "우레탄": 0, "에폭시": 0 }, items: {}, last: null, mainLast: null, mainPaid: false, none: true }; var nonmat = isNum(r["비자재·용역"]) ? r["비자재·용역"] : 0; return { total: r["전체순매출"] || 0, amt: (r["전체순매출"] || 0) - nonmat, main: r["메인자재순매출"] || 0, stage: r["하도·상도"] || 0, nonmat: nonmat, fam: { "재도장": r["메인자재_재도장"] || 0, "우레탄": r["메인자재_우레탄중도"] || 0, "에폭시": r["메인자재_에폭시중도"] || 0 }, items: {}, last: null, mainLast: null, mainPaid: r["메인유상구매"] === "Y", noItems: true }; }
      return null;
    }
    G.buyRec = buyRec;
    function buyIds(basis, y) { if (led) return Object.keys((basis === "ann" ? ann : ytd)[y] || {}); if (basis === "ann") return Object.keys(m4[y] || {}); return null; }

    /* ---------- 공고 · 낙찰 ---------- */
    var noticeRows = B5.filter(function (r) { return r["집계대상"] === "Y"; });
    var nkey = {}; noticeRows.forEach(function (r) { var k = nz(r["현장명"]) + "|" + ymd(r["공고일"]); (nkey[k] = nkey[k] || []).push(r); });
    var awardNotice = {}; /* 낙찰 공고기록ID → 공고 행들 */
    A.forEach(function (r) { var k = nz(r["현장명"]) + "|" + ymd(r["공고일"]); awardNotice[r["공고기록ID"]] = nkey[k] || null; });
    G.awardNotice = awardNotice;
    function noticesOf(basis, y, pourOnly) { return noticeRows.filter(function (r) { return String(r["연도"]) === y && inP(basis, r["공고일"]) && (!pourOnly || r["공고구분"] === "POUR"); }); }
    function awardsOf(basis, y) { return A.filter(function (r) { return String(r["연도"]) === y && inP(basis, r["공고일"]); }); }
    G.noticesOf = noticesOf; G.awardsOf = awardsOf;

    var cache = {};
    function metrics(basis, y) {
      var ck = basis + "|" + y; if (cache[ck]) return cache[ck];
      var k = kRow[y] || {}; var N = noticesOf(basis, y), Np = noticesOf(basis, y, true), W = awardsOf(basis, y);
      var m = { basis: basis, year: y };
      m.notices = missing.indexOf("5b.POUR반영공고") >= 0 ? null : N.length; m.noticesPour = missing.indexOf("5b.POUR반영공고") >= 0 ? null : Np.length;
      m.awards = missing.indexOf("5.POUR공고낙찰") >= 0 ? null : W.length;
      m.awardAmt = m.awards == null ? null : sumBy(W, function (r) { return r["낙찰금액"]; }); m.awardAmtN = W.filter(function (r) { return isNum(r["낙찰금액"]); }).length; m.awardAmtMissing = W.length - m.awardAmtN;
      var ids = uniq(W.map(function (r) { return r["통합ID"]; })); m.awardIds = ids; m.awardVendors = m.awards == null ? null : ids.length; m.awardNames = uniq(W.map(function (r) { return r["낙찰시공사"]; })).length;
      /* 같은 모집단 비율: 공고 목록(5b, 집계대상=Y) 중 낙찰 기록이 있는 공고 / 공고 목록 */
      var hit = {}, unmatched = 0; W.forEach(function (r) { var ns = awardNotice[r["공고기록ID"]]; var inSet = ns && ns.filter(function (n) { return String(n["연도"]) === y && inP(basis, n["공고일"]); }); if (inSet && inSet.length) inSet.forEach(function (n) { hit[n["공고기록ID"]] = 1; }); else unmatched++; });
      m.noticesWithAward = Object.keys(hit).length; m.unmatchedAwards = unmatched; m.awardRatio = m.notices ? m.noticesWithAward / m.notices : null;
      /* 매출 (1.통합KPI 값 그대로) */
      m.sales = isNum(basis === "ann" ? k["전체자재순매출"] : k["동일기간_전체매출"]) ? (basis === "ann" ? k["전체자재순매출"] : k["동일기간_전체매출"]) : null;
      var mn = basis === "ann" ? k["메인자재순매출"] : k["동일기간_메인매출"]; m.main = isNum(mn) ? mn : null; m.mainWhy = isNum(mn) ? null : (String(mn == null ? "데이터 없음" : mn) + " — 품목명 검증 전이라 값을 만들지 않습니다");
      m.mainShare = isNum(m.main) && isNum(m.sales) && m.sales ? m.main / m.sales : null;
      /* 원문 대조 */
      if (led) { var lt = (basis === "ann" ? ledgerTotals.ann : ledgerTotals.ytd)[y]; m.ledgerSales = isNum(lt) ? lt : 0; m.salesCheck = isNum(m.sales) ? Math.abs(m.ledgerSales - m.sales) < 1 : null; var lm = (basis === "ann" ? ledgerTotals.mainAnn : ledgerTotals.mainYtd)[y] || 0; m.ledgerMain = lm; m.mainCheck = isNum(m.main) ? Math.abs(lm - m.main) < 1 : null; }
      /* 메인 3품목 */
      m.fam = null; if (isNum(m.main)) { var ff = { "재도장": 0, "우레탄": 0, "에폭시": 0 }, ok = false; var idl = buyIds(basis, y); if (idl) { ok = true; idl.forEach(function (id) { var c = buyRec(basis, y, id); FAMS.forEach(function (f) { ff[f] += c.fam[f]; }); }); } m.fam = ok ? ff : null; }
      /* 낙찰 시공사 → 구매 연결 (후보) */
      m.cohort = null; var il = buyIds(basis, y);
      if (il && m.awards != null) { var buy = [], mbuy = [], noBuy = [], buyAmt = 0, mainAmt = 0; ids.forEach(function (id) { var c = buyRec(basis, y, id); if (c.amt > 0) { buy.push(id); buyAmt += c.amt; } else noBuy.push(id); if (c.mainPaid) { mbuy.push(id); mainAmt += c.main; } });
        var mok = mainOK(y); m.cohort = { n: ids.length, buy: buy, noBuy: noBuy, buyN: buy.length, buyRate: ids.length ? buy.length / ids.length : null, buyAmt: buyAmt, mainBuy: mok ? mbuy : null, mainBuyN: mok ? mbuy.length : null, mainRate: mok && ids.length ? mbuy.length / ids.length : null, mainAmt: mok ? mainAmt : null, mainWhy: mok ? null : "메인자재 품목 검증 전 연도(미확인) — 메인 구매 연결률을 만들지 않습니다" };
        var allAmt = 0; il.forEach(function (id) { allAmt += buyRec(basis, y, id).amt; }); m.cohort.totalAmt = allAmt; m.cohort.amtShare = allAmt ? buyAmt / allAmt : null; }
      cache[ck] = m; return m;
    }
    G.metrics = metrics;

    attachCompare(G, { prevOf: prevOf, lastY: lastY, endMD: endMD, mainOK: mainOK, firstSale: firstSale, metrics: metrics, led: !!led });

    /* ---------- 업체 단위 ---------- */
    var link12 = {}; R12.forEach(function (r) { var id = r["통합ID"]; var t = String(r["연결상태"] || ""); var pr = /낙찰시공사↔이카운트|이카운트 거래처 후보 없음/.test(t) ? 2 : 1; if (!link12[id] || pr > link12[id].pr) link12[id] = { pr: pr, 상태: t, 사유: r["사유"] }; });
    function hasAnyPurchase(id) { var any = false; years.forEach(function (y) { var c = buyRec("ann", y, id); if (c && !c.none && c.amt > 0) any = true; }); return any; }
    G.linkGrade = function (id) {
      var ms = master[id] || {}, l = link12[id]; var realCode = ms["이카운트거래처코드"] && /^[0-9A-Za-z]/.test(String(ms["이카운트거래처코드"])) && !/수령 전/.test(String(ms["이카운트거래처코드"]));
      if (ms["사업자등록번호"] && realCode) return { code: "ok", label: "확인 완료", note: "사업자번호·거래처코드로 법인 동일성 확인" };
      if (l && /후보 없음/.test(l.상태)) return { code: "nocand", label: "구매 후보 없음", note: "판매 거래처명과 일치하는 후보가 없음 — 구매 없음으로 단정하지 않음" };
      if (hasAnyPurchase(id)) return { code: "cand", label: "연결 후보", note: (l && l.사유 ? String(l.사유).replace(/ — 판매 원천에 사업자번호 없어 법인 미확정/, "") + " · " : "") + "판매 원천에 사업자번호가 없어 법인 미확정" };
      return { code: "na", label: "확인 불가", note: "연결할 판매 거래처 기록이 없음" };
    };
    G.vendorName = function (id, fallback) { var m = master[id]; return (m && m["대표업체명"]) || fallback || id; };
    /* 낙찰 현장별 자재 사용 확인: 납품서·사용확인 증빙 자료가 시트에 없으므로 '확인 완료'는 만들지 않는다. 적요(현장명)가 비슷하면 '후보' */
    var memoIdx = null;
    function memos() { if (memoIdx || !led) return memoIdx; memoIdx = {}; led.forEach(function (r) { var s = r["적요(현장명)"]; if (!s || r["순매출포함"] !== "포함") return; var id = r["통합ID"]; (memoIdx[id] = memoIdx[id] || []).push({ k: nz(s), d: ymd(r["거래일자"]) }); }); return memoIdx; }
    G.siteStatus = function (award) {
      if (!led) return { code: "wait", label: "원문 읽는 중", note: "판매 원문을 읽은 뒤 적요 유사 여부를 확인합니다" };
      var key = nz(award["현장명"]); var list = (memos() || {})[award["통합ID"]] || [];
      if (key.length >= 4) { var hit = list.filter(function (m) { return m.k.indexOf(key) >= 0 || (m.k.length >= 4 && key.indexOf(m.k) >= 0); }); if (hit.length) return { code: "cand", label: "후보", note: "판매 적요에 비슷한 현장명 " + hit.length + "건(납품·사용 증빙은 아님)" }; }
      return { code: "na", label: "확인 불가", note: "현장별 사용 증빙이 시트에 없음 — 타사 자재 사용으로 판단하지 않음" };
    };
    /* 낙찰 목록 (연도·기간) — 상세 표용 */
    G.awardRows = function (basis, y) {
      return awardsOf(basis, y).map(function (r) { var ns = awardNotice[r["공고기록ID"]]; var lg = G.linkGrade(r["통합ID"]); var st = G.siteStatus(r); return { 공고기록ID: r["공고기록ID"], 시공사: r["낙찰시공사"], 통합ID: r["통합ID"], 업체: G.vendorName(r["통합ID"], r["낙찰시공사"]), 현장명: r["현장명"], 공종: r["공종그룹"] || r["공종"], 세부공종: r["공종"], 공고일: ymd(r["공고일"]), 낙찰일: null, 낙찰금액: isNum(r["낙찰금액"]) ? r["낙찰금액"] : null, 연결상태: r["연결상태"], 구매연결: lg.label, 구매연결코드: lg.code, 사용확인: st.label, 사용확인코드: st.code, 사용확인메모: st.note, 공고연결: ns ? "공고 목록 연결" : "공고 목록 미연결", 지역: r["지역"], 도시: r["도시"] }; });
    };
    /* 업체별 연결 상세 (낙찰 시공사) */
    G.cohortRows = function (basis, y) {
      var W = awardsOf(basis, y), by = {}; W.forEach(function (r) { var id = r["통합ID"]; var o = by[id] || (by[id] = { 통합ID: id, 업체: G.vendorName(id, r["낙찰시공사"]), 낙찰건수: 0, 낙찰금액: 0, 금액미기재: 0 }); o.낙찰건수++; if (isNum(r["낙찰금액"])) o.낙찰금액 += r["낙찰금액"]; else o.금액미기재++; });
      var mok = mainOK(y); return Object.keys(by).map(function (id) { var o = by[id], c = buyRec(basis, y, id), lg = G.linkGrade(id); if (c) { o.구매금액 = c.amt; o.메인금액 = mok ? c.main : null; o.구매확인 = c.amt > 0; o.메인구매 = mok ? !!c.mainPaid : null; o.최근구매일 = c.last || null; } else { o.구매금액 = null; o.메인금액 = null; o.구매확인 = null; o.메인구매 = null; o.최근구매일 = null; } o.연결 = lg.label; o.연결코드 = lg.code; o.연결메모 = lg.note; return o; });
    };
    /* 거래처별 매출 증감 */
    G.vendorSales = function (basis, y, cy) {
      var a = buyIds(basis, y), b = buyIds(basis, cy); if (!a || !b) return null; var ids = uniq(a.concat(b)); var cur = metrics(basis, y), awardNow = {}; (cur.awardIds || []).forEach(function (i) { awardNow[i] = 1; });
      var everAward = {}; A.forEach(function (r) { everAward[r["통합ID"]] = 1; });
      return ids.map(function (id) { var c = buyRec(basis, y, id), p = buyRec(basis, cy, id); return { 통합ID: id, 업체: G.vendorName(id), 당기: c.amt, 전기: p.amt, 증감액: c.amt - p.amt, 증감률: p.amt > 0 ? (c.amt - p.amt) / p.amt : null, 메인당기: c.main, 메인전기: p.main, 페인트당기: c.fam["재도장"], 우레탄당기: c.fam["우레탄"], 에폭시당기: c.fam["에폭시"], famNow: c.fam, famPrev: p.fam, 낙찰당기: !!awardNow[id], 낙찰이력: !!everAward[id], 구분: p.amt <= 0 && c.amt > 0 ? "신규 구매" : c.amt <= 0 && p.amt > 0 ? "구매 중단" : "" }; });
    };
    /* 성장 기여 시공사: 낙찰 이력이 있는 업체 중 매출 증가액이 큰 순 */
    G.contributors = function (basis, y, cy, onlyAward) { var rows = G.vendorSales(basis, y, cy); if (!rows) return null; var tot = sumBy(rows, function (r) { return r.증감액; }); rows = rows.filter(function (r) { return r.증감액 > 0 && (!onlyAward || r.낙찰이력); }).sort(function (a, b) { return b.증감액 - a.증감액; }); return { rows: rows, totalDelta: tot }; };
    /* 낙찰 이력이 있으나 구매 확인이 필요한 업체: 낙찰 연도에 자재 구매가 확인되지 않은 업체 */
    G.needCheck = function (basis, y) { var rows = G.cohortRows(basis, y); return rows.filter(function (r) { return r.구매확인 === false; }).sort(function (a, b) { return b.낙찰금액 - a.낙찰금액 || b.낙찰건수 - a.낙찰건수; }); };

    /* ---------- 업체 상세 ---------- */
    G.vendorDetail = function (id) {
      var ms = master[id] || null; var out = { 통합ID: id, master: ms, 이름: G.vendorName(id) }; out.link = G.linkGrade(id);
      out.awards = years.map(function (y) { var W = awardsOf("ann", y).filter(function (r) { return r["통합ID"] === id; }); return { year: y, n: W.length, amt: sumBy(W, function (r) { return r["낙찰금액"]; }), missing: W.filter(function (r) { return !isNum(r["낙찰금액"]); }).length }; });
      out.purchases = years.map(function (y) { var c = buyRec("ann", y, id), cy = buyRec("ytd", y, id); return { year: y, amt: c ? c.amt : null, main: c && mainOK(y) ? c.main : null, mainWhy: mainOK(y) ? null : "미확인", fam: c && mainOK(y) ? c.fam : null, ytdAmt: cy ? cy.amt : null, ytdMain: cy && mainOK(y) ? cy.main : null }; });
      var lastBuy = null, items = {}; years.forEach(function (y) { var c = buyRec("ann", y, id); if (c && c.last && (!lastBuy || c.last > lastBuy)) lastBuy = c.last; if (c) for (var k in c.items) items[k] = (items[k] || 0) + c.items[k]; });
      out.lastBuy = led ? lastBuy : null; out.lastBuyWhy = led ? null : "판매 원문을 읽는 중"; out.items = Object.keys(items).map(function (k) { return { 품목: k, 금액: items[k] }; }).filter(function (x) { return x.금액 > 0; }).sort(function (a, b) { return b.금액 - a.금액; }).slice(0, 8); out.itemsWhy = led ? null : "판매 원문을 읽는 중";
      var la = null, lat = null; ACT.forEach(function (d) { if (!src.has(d[0])) return; src.objs(d[0]).forEach(function (r) { if (r["통합ID"] !== id) return; var dt = ymd(r[d[1]]); if (dt && (!la || dt > la)) { la = dt; lat = d[3]; } }); }); out.lastActivity = la; out.lastActivityType = lat;
      out.cardLinked = !!(ms && ms["B2B고유번호"]); out.cardId = ms ? ms["B2B고유번호"] : null;
      out.sites = awardsOf("ann", lastY).concat([]); out.siteRows = [];
      years.forEach(function (y) { G.awardRows("ann", y).filter(function (r) { return r.통합ID === id; }).forEach(function (r) { out.siteRows.push(r); }); });
      return out;
    };
    /* 시공사 검색 */
    G.findVendors = function (q) { q = String(q || "").trim().toLowerCase(); if (!q) return []; var seen = {}, out = []; MS.forEach(function (r) { var hay = [r["대표업체명"], r["낙찰시공사_표기"], r["이카운트_거래처명"], r["플랫폼_업체명"], r["통합ID"], r["사업자등록번호"]].join(" ").toLowerCase(); if (hay.indexOf(q) >= 0 && !seen[r["통합ID"]]) { seen[r["통합ID"]] = 1; out.push(r); } }); return out.slice(0, 40); };

    /* ---------- 데이터 범위 · 비교 불가 안내(자동) ---------- */
    G.coverage = function () {
      var n = [];
      var noKind = years.filter(function (y) { var k = kRow[y]; return k && !isNum(k["전체공고_건수"]); });
      if (noKind.length) n.push({ t: "전체 공고 모수 없음", d: noKind.join("·") + "년은 자사 반영 공고만 수집되어 전체 공고 대비 비중을 계산할 수 없음(전체 공고 건수: 모수 없음)" });
      var kinds = {}; noticeRows.forEach(function (r) { var y = String(r["연도"]); kinds[y] = kinds[y] || {}; kinds[y][r["공고구분"]] = (kinds[y][r["공고구분"]] || 0) + 1; });
      var earlyOnlyPour = years.filter(function (y) { var ks = Object.keys(kinds[y] || {}); return ks.length === 1 && ks[0] === "POUR"; }), mixed = years.filter(function (y) { return Object.keys(kinds[y] || {}).length > 1; });
      if (earlyOnlyPour.length && mixed.length) n.push({ t: "공고 모집단 정의 차이", d: earlyOnlyPour.join("·") + "년은 'POUR 공고만' 목록, " + mixed.join("·") + "년은 '전체 공고' 중 자사 반영(POUR·다특허(PD)·DO·CNC) 목록 — 증감률 옆에 'POUR 공고만 기준'을 함께 표시" });
      var noStatus = years.filter(function (y) { var rows = noticeRows.filter(function (r) { return String(r["연도"]) === y; }); return rows.length && rows.filter(function (r) { return r["상태"]; }).length / rows.length < 0.5; });
      if (noStatus.length) n.push({ t: "공고 진행 상태 미기재", d: noStatus.join("·") + "년 공고는 상태(낙찰·유찰·취소)가 대부분 비어 있어 공고 상태별 분석 불가 — 낙찰 비율은 낙찰 기록(5.POUR공고낙찰)과 공고 목록을 현장명·공고일로 연결해 계산" });
      n.push({ t: "낙찰일 자료 없음", d: "시트에 낙찰일 열이 없어 낙찰 시점은 공고일 기준으로 집계하고 낙찰일은 '자료 없음'으로 표시" });
      var miss = A.filter(function (r) { return !isNum(r["낙찰금액"]); }).length; n.push({ t: "낙찰금액 기준", d: "VAT 포함 여부 미확인 · 금액 미기재 " + miss + "건은 합계에서 제외하고 건수만 집계" });
      var unv = years.filter(function (y) { return !mainOK(y); }); if (unv.length) n.push({ t: "메인자재 값 미확인", d: unv.join("·") + "년은 품목명 검증 전이라 메인자재 매출·비중·구매 연결률을 만들지 않음(0이 아님)" });
      if (led && firstSale.main) n.push({ t: "메인자재 판매 개시", d: "원문 기준 첫 판매일 — 메인 전체 " + firstSale.main + " · " + FAMS.map(function (f) { return FAM_LABEL[f] + " " + (firstSale[f] || "없음"); }).join(" · ") + ". 개시 이전 기간이 섞인 연도는 증감률을 계산하지 않음" });
      else if (!led) n.push({ t: "메인자재 품목별 첫 판매일", d: "판매 원문을 읽으면 표시" });
      var cnf = 0; Object.keys(master).forEach(function (id) { if (G.linkGrade(id).code === "ok") cnf++; }); n.push({ t: "구매 연결은 '후보'", d: "판매 원천에 사업자번호·거래처코드가 없어 낙찰 시공사와 판매 거래처의 동일 법인을 확정할 수 없음(확정 " + cnf + "곳) — 이름 정규화 일치만 '연결 후보'로 집계하며 공식 구매율은 산출하지 않음" });
      n.push({ t: "현장별 사용 확인 불가", d: "납품서·사용확인 증빙이 시트에 없어 낙찰 현장별 자재 사용은 '확인 불가'(적요 현장명이 비슷하면 '후보') — 구매 기록이 없다고 타사 자재 사용으로 판단하지 않음" });
      var un = 0; years.forEach(function (y) { un += metrics("ann", y).unmatchedAwards || 0; }); if (un) n.push({ t: "공고 목록과 연결되지 않은 낙찰", d: "낙찰 기록 " + un + "건은 공고 목록(5b)에서 같은 현장명·공고일을 찾지 못해 낙찰 비율 분자에서 제외(낙찰 건수에는 포함)" });
      return n;
    };
    /* ---------- 기존 KPI 와의 대조 ---------- */
    G.reconcile = function () {
      var out = [];
      years.forEach(function (y) { var k = kRow[y]; var a = metrics("ann", y), s = metrics("ytd", y);
        function chk(label, mine, kpi, fmt) { var ok = isNum(kpi) ? (isNum(mine) && Math.abs(mine - kpi) < 0.5) : null; out.push({ 연도: y, 항목: label, 새집계: mine, KPI: kpi, 결과: ok === null ? "대조 대상 아님" : ok ? "일치" : "불일치" }); }
        chk("POUR 반영 공고(연간)", a.notices, k["POUR반영공고_건수"]); chk("POUR 낙찰 건수(연간)", a.awards, k["POUR낙찰_건수"]); chk("POUR 낙찰금액(연간)", a.awardAmt, k["POUR낙찰금액_VAT미확인"]); chk("동일기간 낙찰 건수", s.awards, k["동일기간_낙찰"]);
        chk("전체 자재 순매출(연간)", a.sales, k["전체자재순매출"]); chk("동일기간 전체 매출", s.sales, k["동일기간_전체매출"]); chk("메인 자재 순매출(연간)", a.main, k["메인자재순매출"]); chk("동일기간 메인 매출", s.main, k["동일기간_메인매출"]);
        if (led) { chk("원문 합계 ↔ 전체 자재 순매출(연간)", a.ledgerSales, k["전체자재순매출"]); chk("원문 합계 ↔ 동일기간 전체 매출", s.ledgerSales, k["동일기간_전체매출"]); if (isNum(k["메인자재순매출"])) { chk("원문 메인 ↔ 메인 자재 순매출(연간)", a.ledgerMain, k["메인자재순매출"]); chk("원문 메인 ↔ 동일기간 메인 매출", s.ledgerMain, k["동일기간_메인매출"]); } }
        if (isNum(k["메인자재순매출"])) { var f = a.fam; if (f) chk("메인 3품목 합 ↔ 메인 자재 순매출(연간)", f["재도장"] + f["우레탄"] + f["에폭시"], k["메인자재순매출"]); }
        chk("낙찰 시공사 수(표기 기준)", a.awardNames, k["낙찰시공사수"]);
      });
      return out;
    };
    /* ---------- 공개용 집계값 내보내기: 업체명·ID·현장명·거래 명세 없이 연도·기간별 합계/건수/비율만 ---------- */
    var PUB_M = ["basis", "year", "notices", "noticesPour", "awards", "awardAmt", "awardAmtN", "awardAmtMissing", "awardVendors", "awardNames", "noticesWithAward", "unmatchedAwards", "awardRatio", "sales", "main", "mainWhy", "mainShare", "ledgerSales", "salesCheck", "ledgerMain", "mainCheck"];
    var PUB_C = ["n", "buyN", "buyRate", "mainBuyN", "mainRate", "mainAmt", "mainWhy", "buyAmt", "totalAmt", "amtShare"];
    function pubMetrics(m) { var o = {}; PUB_M.forEach(function (k) { if (m[k] !== undefined) o[k] = m[k]; }); if (m.fam) o.fam = { "재도장": m.fam["재도장"], "우레탄": m.fam["우레탄"], "에폭시": m.fam["에폭시"] }; else o.fam = null; if (m.cohort) { var c = {}; PUB_C.forEach(function (k) { if (m.cohort[k] !== undefined) c[k] = m.cohort[k]; }); o.cohort = c; } else o.cohort = null; return o; }
    function pubTrades(basis, y) { var t = {}; awardsOf(basis, y).forEach(function (r) { var k = String(r["공종그룹"] || r["공종"] || "미기재"); var o = t[k] || (t[k] = { n: 0, amt: 0, amtN: 0 }); o.n++; if (isNum(r["낙찰금액"])) { o.amt += r["낙찰금액"]; o.amtN++; } }); return t; }
    G.exportPublic = function () {
      var out = { years: years.slice(), lastY: lastY, endMD: endMD, asOf: G.asOf, ledgerReady: !!led, firstSale: { main: firstSale.main, "재도장": firstSale["재도장"], "우레탄": firstSale["우레탄"], "에폭시": firstSale["에폭시"] }, mainOK: {}, metrics: { ann: {}, ytd: {} }, trades: { ann: {}, ytd: {} }, famRules: famRules.map(function (r) { return { fam: r.fam, re: r.re }; }) };
      years.forEach(function (y) { out.mainOK[y] = mainOK(y); ["ann", "ytd"].forEach(function (b) { out.metrics[b][y] = pubMetrics(metrics(b, y)); out.trades[b][y] = pubTrades(b, y); }); });
      out.coverage = G.coverage().map(function (c) { return { t: c.t, d: c.d }; }); out.reconcile = G.reconcile().map(function (r) { return { "연도": r["연도"], "항목": r["항목"], "새집계": r["새집계"], "KPI": r["KPI"], "결과": r["결과"] }; });
      return out;
    };
    return G;
  }
  /* 공개 집계값(exportPublic 결과)으로 같은 화면 인터페이스를 제공 — 업체·현장 단위 메서드는 제공하지 않는다(restricted) */
  function buildPublic(pub, opt) {
    opt = opt || {};
    var G = { missing: [], years: pub.years.slice(), lastY: pub.lastY, endMD: pub.endMD, asOf: pub.asOf, notes: [], famRules: pub.famRules || DEFAULT_FAM_RULES, ledgerReady: !!pub.ledgerReady, firstSale: pub.firstSale, restricted: true, publicMeta: pub.meta || null };
    var kRow = {}; (opt.kpi || []).forEach(function (r) { kRow[String(r["연도"])] = r; });
    function prevOf(y) { var i = G.years.indexOf(y); return i > 0 ? G.years[i - 1] : null; }
    function mainOK(y) { return !!(pub.mainOK && pub.mainOK[y]); }
    function metrics(b, y) { return (pub.metrics[b] || {})[y]; }
    G.prevOf = prevOf; G.kpi = function (y) { return kRow[y] || null; }; G.master = function () { return null; }; G.mainOK = mainOK; G.metrics = metrics;
    attachCompare(G, { prevOf: prevOf, lastY: G.lastY, endMD: G.endMD, mainOK: mainOK, firstSale: pub.firstSale, metrics: metrics, led: !!pub.ledgerReady });
    G.coverage = function () { return pub.coverage || []; }; G.reconcile = function () { return pub.reconcile || []; };
    G.trades = function (b, y) { return ((pub.trades || {})[b] || {})[y] || {}; };
    G.linkGrade = function () { return { code: "na", label: "비공개", note: "업체별 정보는 공개하지 않습니다" }; }; G.vendorName = function (id, fb) { return fb || ""; };
    G.awardRows = function () { return []; }; G.cohortRows = function () { return []; }; G.vendorSales = function () { return null; }; G.contributors = function () { return null; }; G.needCheck = function () { return []; }; G.vendorDetail = function () { return null; }; G.findVendors = function () { return []; };
    return G;
  }
  root.B2BGrowth = { DEFAULT_FAM_RULES: DEFAULT_FAM_RULES, build: build, buildPublic: buildPublic, growth: growth, FAMS: FAMS, FAM_LABEL: FAM_LABEL, isNum: isNum, famOf: famOf, nz: nz };
  if (typeof module !== "undefined" && module.exports) module.exports = root.B2BGrowth;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));


/* ===== [1부-b] 공개용 집계 포장 모듈 ===== */
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
    var pub = model.exportPublic();
    var body = { tabs: { "1.통합KPI": { header: kpi.header.slice(), rows: kpi.rows.map(function (r) { return r.slice(); }) }, "18.선행지표요약": { header: ["지표", "값", "기준", "비고"], rows: lead } }, growth: pub };
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
    var g = p.growth; if (!g || !Array.isArray(g.years) || !g.years.length || !g.metrics || !g.metrics.ann || !g.metrics.ytd) return "성장 분석 집계 누락";
    for (var i = 0; i < g.years.length; i++) { var y = g.years[i]; if (!g.metrics.ann[y] || !g.metrics.ytd[y]) return "연도별 집계 누락: " + y; }
    if (!/^\d{2}-\d{2}$/.test(String(g.endMD || ""))) return "기준일 형식 오류";
    return null;
  }

  root.B2BPublicPack = { SCHEMA_VER: SCHEMA_VER, pack: pack, validate: validate, hash53: hash53, NEED: NEED };
  if (typeof module !== "undefined" && module.exports) module.exports = root.B2BPublicPack;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));


/* ===================================================================
   [2부] 구글시트에 붙는 부분 — 자동 수집 · 검증 · 공개용 집계 게시
   · 이 스크립트는 구글시트에 붙은(컨테이너 바운드) 프로젝트입니다. 시트 소유자 권한으로 시트를 "읽기만" 합니다.
     (코드에 setValue·appendRow·deleteRow 등 쓰기 호출이 없습니다 — 아래 전체를 검색해 확인할 수 있습니다)
   · 수집 주기: 10분마다 시트 변경 여부(지문)만 확인 → 바뀐 경우에만 전체 집계. 하루 1회는 무조건 재집계.
   · 게시되는 것: 연도·기간별 집계값(JSON) 하나. 시공사·현장·거래 명세, 사업자번호, 판매 원문은 코드 안에서 만들지도 내보내지도 않습니다.
   · 검증 실패(탭 누락·열 변경·KPI 대조 불일치·원문 급감·업체명 혼입) 시 새 값은 게시하지 않고 이전 정상 집계를 유지합니다.
   · 웹앱(doGet)은 저장된 집계 JSON 만 돌려줍니다. 요청 파라미터로 시트의 다른 내용을 읽을 수 없습니다.
   · 저장 위치: 스크립트 속성(이 프로젝트 안). 드라이브 파일·외부 서버·GitHub 토큰을 쓰지 않습니다.
   =================================================================== */
var PUB_SCHEMA = {"1.통합KPI":["L2건수_유효","L3전환_확정_공식","L3전환_검토대상","L2L3전환율_공식","L2L3전환율_검토포함상한_참고","평균전환소요일_확정","장기무활동_90일이상","핵심협력사_장기무활동","연도","기준","데이터구분","기술자문문의_건수","컨설팅요청_건수","공법설명회_건수","샘플·카탈로그_건수","기타문의_건수","영업활동_업체수","전체공고_건수","POUR반영공고_건수","POUR반영비중","POUR낙찰_건수","POUR낙찰금액_VAT미확인","낙찰시공사수","타사공법낙찰_건수","전체자재순매출","메인자재순매출","메인비중","메인구매거래처수","별도자재만거래처수","동일기간_낙찰","동일기간_전체매출","동일기간_메인매출","법인확정낙찰업체","공식메인구매율","후보관측_메인구매업체"],"2.시공사마스터":["통합ID","대표업체명","B2B고유번호","마스터업체코드","사업자등록번호","이카운트거래처코드","협약일","주요공종","연결상태","연결근거","출처","낙찰시공사_표기","이카운트_거래처명","플랫폼_업체명","검토사항"],"3.이카운트판매원문":["거래일자","연도","전표번호","통합ID","거래처명","거래처코드","품목명·규격","수량","단가","공급가액","부가세","합계","적요(현장명)","구분","메인자재분류","순매출포함","원전표연결","원본출처","적재일시","레코드ID","버전"],"4.메인자재구매현황":["통합ID","거래처명","연도","거래행수","전체순매출","메인자재순매출","메인자재_재도장","메인자재_우레탄중도","메인자재_에폭시중도","하도·상도","별도자재","기타자재","분류확인필요","비자재·용역","메인비중","메인유상구매","별도자재유상구매","구매유형","비고"],"5.POUR공고낙찰":["공고기록ID","연도","공고일","현장명","주소","지역","도시","공종","공종그룹","공사명","POUR판정","특허번호","낙찰시공사","통합ID","연결상태","낙찰금액","낙찰금액상태","공고관계","원본출처"],"5b.POUR반영공고":["공고기록ID","연도","원천파일연도","집계대상","공고일","현장명","공고구분","공종","공종그룹","상태","낙찰시공사","통합ID","낙찰금액","동일기간","원천범위","원본출처"],"6.타사공법낙찰":["연도","공고일","공고번호","현장명","공종","공고구분","낙찰공법구분","공법명_특허권자","특허번호","낙찰업체","통합ID","낙찰금액","원본출처"],"7.기술자문문의":["접수일자","연도","협력사명","통합ID","현장명","지역","도시","주소","공종","특허번호","상태","낙찰결과","문의ID","출처"],"7b.플랫폼가입현황":["가입일자","연도","업체명","통합ID","아이디","가입경로","집계대상","활동여부","활동건수_여정L2이상","출처"],"8.컨설팅요청":["등록일자","연도","업체","통합ID","현장명","담당자_협력사","지역","도시","주소","공사범위","요청기한","발행일시","발행종류","공종별","총합계","발송여부","문의ID","출처"],"8b.컨설팅발행이력":["발행일시","연도","시공사","통합ID","현장명","공종","발행종류","요청기한","등록일","소요일수","출처"],"9.샘플카탈로그요청":["접수일시","연도","업체","통합ID","받는분","슁글샘플","금속기와샘플","듀얼샘플","균열보수샘플","제품카달로그","공법카달로그","시트샘플북","주소","문의ID","출처"],"10.공법설명회이력":["등록일","연도","시공사","통합ID","현장명","주소","공종","요청일","상태","배정담당자","문의ID","출처"],"11.기타문의답변":["등록일","연도","업체명","통합ID","담당자","문의내용","답변완료일","문서ID","출처"],"12.거래처연결검토":["통합ID","대표업체명","연결상태","사유","출처","표기들","사업자등록번호","처리"],"13.데이터검증변경이력":["항목","통합건수","원천건수","통합금액","원천금액","차이","비고"],"14.판매원문차이검증":["구분","레코드ID","전표번호","거래일자","거래처명","품목명·규격","수량","공급가액","적요","원본출처","적재일시","설명"],"15.마스터대조":["구분","항목","상세","판정"],"16.L2L3전환":["L2일자","L2연도","시공사","통합ID","업체ID","L2현장명","L2아파트ID","L2주소","판정","판정코드","판정근거","L3일자","L3유형","L3현장명","L3아파트ID","L3주소","아파트ID일치","현장명일치","주소일치","공식전환포함","전환소요일","최종검증","검증1_시공사동일성","검증2_현장명주소","검증3_공종충돌","검증4_선후관계","검증5_중복전환","검증6_원본추적","L2문의ID","L3문의ID","L2공종","L3공종","추가확인_L3공사범위","추가확인_같은현장_POUR공고","추가확인_상태","L2처리상태","L2여정행","L3여정행","검토결정","검토결정근거"],"16b.L2L3시공사별":["시공사","통합ID","L2건수","유효L2","L3전환_확정","검토","미전환","연결불가_일자검토","공식전환율","검토포함시_전환율","평균소요일_확정"],"16c.L2L3판정집계":["판정코드","판정","건수","공식전환율_반영","판단기준"],"16d.L2L3검토이력":["일시","L2여정행","L3여정행","시공사","현장명","이전판정","결정","결과","승인자","근거","증빙"],"17.장기무활동":["통합ID","업체명","B2B고유번호","핵심협력사","마지막활동일","무활동경과일","마지막활동유형","활동건수_기록기간","판정","기준일"],"18.선행지표요약":["지표","값","기준","비고"],"19.업체명정규화":["구분","항목","내용","상태","비고"]};                     /* 빌드가 {탭이름:[열 머리글…]} 로 채움(데이터 아님) */
/* 공개되면 안 되는 단어(내부 계정명 등)는 코드에 적지 않고 스크립트 속성 DENY_WORDS(쉼표 구분)에 넣습니다 — 코드가 저장소에 올라가도 단어가 노출되지 않도록 */
var LEDGER_TAB = "3.이카운트판매원문";
var TICK_MINUTES = 10;                                    /* 변경 확인 주기(분): 1·5·10·15·30 중 하나. 실행 시간 한도가 빠듯하면 15~30 으로 늘린다 */
var CHUNK_CHARS = 2800;                                   /* 스크립트 속성 값 한도(9KB)보다 작게: 한글 3바이트 × 2800 = 8.4KB */
var MAX_STORE_CHARS = 150000;                             /* 속성 전체 한도(500KB) 안전선 */

function props_() { return PropertiesService.getScriptProperties(); }
function denyWords_() { var s = props_().getProperty("DENY_WORDS"); return s ? s.split(",").map(function (w) { return w.trim(); }).filter(function (w) { return w; }) : []; }
function nowIso_() { return new Date().toISOString(); }

/* ---------- 저장소(스크립트 속성, 조각 저장) ---------- */
function writeStore_(obj) {
  var s = JSON.stringify(obj); if (s.length > MAX_STORE_CHARS) throw new Error("공개 집계가 너무 큽니다(" + s.length + "자)");
  var p = props_(), old = Number(p.getProperty("PUB_N") || 0), n = Math.ceil(s.length / CHUNK_CHARS), kv = {};
  for (var i = 0; i < n; i++) kv["PUB_" + i] = s.substr(i * CHUNK_CHARS, CHUNK_CHARS);
  kv["PUB_N"] = String(n); p.setProperties(kv);                         /* 새 조각을 모두 쓴 뒤에 개수를 바꾼다 */
  for (var j = n; j < old; j++) p.deleteProperty("PUB_" + j);
}
function readStore_() {
  var p = props_(), n = Number(p.getProperty("PUB_N") || 0); if (!n) return null; var all = p.getProperties(), s = "";
  for (var i = 0; i < n; i++) { var c = all["PUB_" + i]; if (c == null) return null; s += c; }
  try { return JSON.parse(s); } catch (e) { return null; }
}
function readStatus_() { try { return JSON.parse(props_().getProperty("PUB_STATUS") || "null"); } catch (e) { return null; } }
function writeStatus_(st) { props_().setProperty("PUB_STATUS", JSON.stringify(st)); }
/* 화면에 내려줄 상태: 오류 사유에는 탭 이름·건수만 있고 업체·현장명은 없다(포장 단계에서 차단) */
function serveStatus_(st) {
  st = st || {};
  return { state: st.state || "none", checkedAt: st.checkedAt || null, publishedAt: st.publishedAt || null, message: st.message ? String(st.message).slice(0, 300) : null };
}

/* ---------- 시트 읽기(읽기 전용) ---------- */
function conv_(v) {
  if (v === "" || v === undefined) return null;
  if (Object.prototype.toString.call(v) === "[object Date]") return isNaN(v.getTime()) ? null : Utilities.formatDate(v, "Asia/Seoul", "yyyy-MM-dd");
  return v;
}
function readTab_(ss, name) {
  var sh = ss.getSheetByName(name); if (!sh) return null;
  var values = sh.getDataRange().getValues(); if (!values.length) return { header: [], rows: [] };
  var header = values[0].map(function (h) { return String(h); }), w = header.length, rows = [];
  for (var i = 1; i < values.length; i++) { var r = values[i], o = new Array(w), any = false; for (var c = 0; c < w; c++) { var v = conv_(r[c]); o[c] = v; if (v !== null) any = true; } if (any) rows.push(o); }
  return { header: header, rows: rows };
}
/* 변경 지문: 판매 원문을 뺀 모든 탭의 값 + 판매 원문의 행 수·공급가액 합계·마지막 행 */
function ledgerPart_(ss) {
  var sh = ss.getSheetByName(LEDGER_TAB); if (!sh) return "X";
  var last = sh.getLastRow(), cols = sh.getLastColumn(); if (last < 2) return "0";
  var head = sh.getRange(1, 1, 1, cols).getValues()[0], ci = head.indexOf("공급가액"), sum = 0, cnt = 0;
  if (ci >= 0) { var col = sh.getRange(2, ci + 1, last - 1, 1).getValues(); for (var i = 0; i < col.length; i++) { var v = col[i][0]; if (typeof v === "number") { sum += v; cnt++; } } }
  var tail = sh.getRange(Math.max(2, last - 4), 1, Math.min(5, last - 1), cols).getValues();
  return last + "x" + cols + "|" + cnt + "|" + Math.round(sum) + "|" + B2BPublicPack.hash53(JSON.stringify(tail));
}
function fingerprint_(ss, tabs) {
  var parts = [];
  Object.keys(PUB_SCHEMA).forEach(function (n) { if (n === LEDGER_TAB) return; var t = tabs && tabs[n] ? tabs[n] : readTab_(ss, n); parts.push(n + ":" + (t ? t.header.length + "x" + t.rows.length + ":" + B2BPublicPack.hash53(JSON.stringify(t)) : "X")); });
  parts.push(LEDGER_TAB + ":" + ledgerPart_(ss));
  return B2BPublicPack.hash53(parts.join("|"));
}

/* ---------- 집계 게시 ---------- */
function refreshPublic(force) {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return "busy";
  try { return refresh_(force === true); }
  catch (e) { return fail_(e); }                          /* 예외가 나도 상태에 사유를 남기고 이전 정상 집계는 그대로 둔다(같은 실패를 조용히 반복하지 않음) */
  finally { lock.releaseLock(); }
}
function fail_(e) {
  var st = readStatus_() || {};
  try { writeStatus_({ fp: st.fp || null, fpAt: st.fpAt || null, failedFp: st.failedFp || null, computedAt: st.computedAt || null, state: st.hash ? "stale" : "blocked", checkedAt: nowIso_(), publishedAt: st.publishedAt || null, hash: st.hash || null, ledgerRows: st.ledgerRows || null, message: "집계 중 오류(이전 정상 집계 유지): " + String((e && e.message) || e).slice(0, 160) }); } catch (x) {}
  return "error";
}
function refreshPublicTick() { return refreshPublic(false); }       /* 시간 트리거용(이벤트 인자를 force 로 오해하지 않도록 분리) */
function refreshPublicForce() { return refreshPublic(true); }
function refresh_(force) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), now = nowIso_(), st = readStatus_() || {}, tabs = {};
  Object.keys(PUB_SCHEMA).forEach(function (n) { if (n !== LEDGER_TAB) { var t = readTab_(ss, n); if (t) tabs[n] = t; } });
  var fp = fingerprint_(ss, tabs);
  var fresh = st.computedAt && (Date.now() - Date.parse(st.computedAt) < 24 * 3600 * 1000);      /* 마지막 "전체 집계" 시각 기준(게시 시각이 아님 — 값이 같아 재게시하지 않아도 하루 1회만 다시 집계) */
  if (!force && st.fp === fp && st.state === "ok" && fresh) { st.checkedAt = now; writeStatus_(st); return "unchanged"; }
  if (!force && st.failedFp === fp) { st.checkedAt = now; writeStatus_(st); return "still-blocked"; }     /* 같은 문제 데이터를 10분마다 다시 계산하지 않는다 */
  var led = readTab_(ss, LEDGER_TAB); if (led) tabs[LEDGER_TAB] = led;
  var fp2 = fingerprint_(ss, null);                                  /* 읽는 동안 시트가 바뀌었는지 다시 읽어 확인 */
  if (fp2 !== fp) { st.checkedAt = now; st.note = "시트가 읽는 동안 바뀌어 다음 확인에서 다시 집계합니다"; writeStatus_(st); return "changing"; }
  var prev = readStore_();
  var observed = st.fp === fp && st.fpAt ? st.fpAt : now;
  var res = B2BPublicPack.pack(tabs, { schema: PUB_SCHEMA, now: now, sourceModified: observed, prev: prev && prev.meta, extraDeny: denyWords_() });
  if (!res.ok) {
    var ns = { fp: st.fp, fpAt: st.fpAt, failedFp: fp, computedAt: st.computedAt || null, state: prev ? "stale" : "blocked", checkedAt: now, publishedAt: st.publishedAt || null, hash: st.hash || null, message: "새 집계를 게시하지 않았습니다(이전 정상 집계 유지): " + res.errors.slice(0, 3).join(" / ") };
    writeStatus_(ns); return "blocked";
  }
  if (!prev || !prev.meta || prev.meta.hash !== res.payload.meta.hash) {
    try { writeStore_(res.payload); }
    catch (e) { writeStatus_({ fp: st.fp, fpAt: st.fpAt, failedFp: fp, computedAt: st.computedAt || null, state: prev ? "stale" : "blocked", checkedAt: now, publishedAt: st.publishedAt || null, hash: st.hash || null, ledgerRows: st.ledgerRows || null, message: "새 집계를 저장하지 못했습니다(이전 정상 집계 유지): " + String((e && e.message) || e).slice(0, 160) }); return "blocked"; }
  }
  writeStatus_({ fp: fp, fpAt: observed, failedFp: null, computedAt: now, state: "ok", checkedAt: now, publishedAt: (prev && prev.meta && prev.meta.hash === res.payload.meta.hash && st.publishedAt) ? st.publishedAt : now, hash: res.payload.meta.hash, ledgerRows: res.stats.ledgerRows, message: null });
  return "published";
}

/* ---------- 웹앱: 저장된 집계만 돌려준다 ---------- */
function doGet(e) {
  var p = (e && e.parameter) || {}, st = readStatus_(), body;
  if (p.action === "status") body = { ok: true, serve: serveStatus_(st) };
  else {
    var pub = readStore_();
    if (!pub) body = { ok: false, error: "NO_DATA", message: "아직 게시된 집계가 없습니다. 시트 소유자가 refreshPublic 을 한 번 실행해야 합니다.", serve: serveStatus_(st) };
    else { pub.serve = serveStatus_(st); body = pub; }
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 설정 도우미(시트 소유자가 편집기에서 한 번 실행) ---------- */
function installTriggers() {
  removeTriggers();
  ScriptApp.newTrigger("refreshPublicTick").timeBased().everyMinutes(TICK_MINUTES).create();
  ScriptApp.newTrigger("refreshPublicForce").timeBased().atHour(5).everyDays(1).create();
  return "트리거 2개 설치: " + TICK_MINUTES + "분마다 확인 · 매일 05시 재집계";
}
function removeTriggers() { ScriptApp.getProjectTriggers().forEach(function (t) { var f = t.getHandlerFunction(); if (f === "refreshPublicTick" || f === "refreshPublicForce") ScriptApp.deleteTrigger(t); }); }
function showStatus() { var st = readStatus_(), pub = readStore_(); var s = { status: st, hash: pub && pub.meta ? pub.meta.hash : null, asOf: pub && pub.meta ? pub.meta.asOf : null, bytes: pub ? JSON.stringify(pub).length : 0 }; console.log(JSON.stringify(s)); return s; }
