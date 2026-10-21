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
