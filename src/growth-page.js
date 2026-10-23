/* ============================================================
   POUR 사업 성장 분석 대시보드 — 화면 모듈 (kpi-sheet-page.js 의 'growth' 보기)
   · 집계는 growth-core.js(window.B2BGrowth), 데이터는 window.B2BSheet 가 읽은 시트 탭(같은 스냅샷)
   · 지표 이름·비교 기간·메인자재 분류 규칙은 '정의'로 분리 — 화면 아래 [지표 정의·계산 기준]에서 변경하고 이력을 남긴다
     (정의는 별도 저장소 netform.b2b.growthdef.v1 에만 기록. 업무 기록 저장소 netform.b2b.tracker.v1 은 읽지도 쓰지도 않는다)
   · 모바일 우선: SVG 그래프는 폭에 맞춰 줄고, 표는 좁은 화면에서 카드로 접힌다
   ============================================================ */
(function () {
  "use strict";
  var GKEY = "netform.b2b.growthdef.v1", CALC_VER = "growth-core v1";
  var GC = window.B2BGrowth; var A = null;
  var Gs = { basis: null, year: null, open: {}, trade: "all", q: "", vfilter: "all", cfilter: "all", fam: "all", vendor: null, covOpen: false, recOpen: false, draft: null, msg: null, qres: null };
  var DEF_LABELS = { notices: "자사 반영 공고 합계(POUR+다특허+브랜드)", awards: "POUR 낙찰", awardAmt: "POUR 낙찰금액", ratio: "공고 대비 낙찰 비율", sales: "전체 자재 매출", main: "메인자재 매출", buyRate: "낙찰 시공사 구매 연결률", mainRate: "메인자재 구매 연결률" };
  var RULE_TEXT = {
    notices: "5b.POUR반영공고 중 집계대상=Y 인 공고 건수(공고일 연도 기준). 2025년부터 목록에 구분(POUR·다특허 PD·DO·CNC)이 표시되고 합계 = POUR 단독 + 다특허(PD) + DO·CNC(원본이 'POUR 공고문 현황'에 함께 넣어 관리하는 구분). 동일기간은 공고일이 기준일(월-일) 이전인 건",
    awards: "5.POUR공고낙찰 건수(공고일 연도 기준 · 낙찰일 자료 없음). 타공법 낙찰 제외, 재공고·반복공고 포함",
    awardAmt: "낙찰금액 합(VAT 포함 여부 미확인 · 금액 미기재는 합계에서 제외하고 건수만 집계)",
    ratio: "분모 = 공고 목록(5b, 집계대상=Y) 건수 · 분자 = 그중 낙찰 기록이 연결된 공고 수(현장명+공고일 일치). 같은 모집단",
    sales: "1.통합KPI 의 전체자재순매출·동일기간_전체매출(공급가액 순액, 음수 전표 포함, 비자재·용역 포함). 원문이 있으면 합계를 다시 대조",
    main: "1.통합KPI 의 메인자재순매출·동일기간_메인매출(검증된 품목 분류표의 '핵심 메인'). 2022~2023은 미확인",
    buyRate: "낙찰 시공사(통합ID, 중복 제거) 중 같은 연도·기간에 자재(비자재·용역 제외) 순매출 > 0 인 업체 비율 — 이름 정규화 일치 기준이라 '연결 후보'",
    mainRate: "낙찰 시공사 중 같은 연도·기간에 메인자재를 유상 구매(품목별 순수량>0 · 순금액>0)한 업체 비율 — '연결 후보'"
  };

  /* ---------- 정의(이름·기준) 저장소 + 변경 이력 ---------- */
  function loadStore() { try { var j = JSON.parse(localStorage.getItem(GKEY) || "null"); if (j && j.over && j.hist) return j; } catch (e) {} return { over: {}, hist: [] }; }
  var STORE = loadStore();
  function saveStore() { try { localStorage.setItem(GKEY, JSON.stringify(STORE)); return true; } catch (e) { return false; } }
  function defs() { var o = STORE.over || {}; var lab = {}; for (var k in DEF_LABELS) lab[k] = (o.labels && o.labels[k]) || DEF_LABELS[k]; return { labels: lab, endMD: o.endMD || null, basis: o.basis || "ytd", famRules: o.famRules && o.famRules.length ? o.famRules : null, version: STORE.hist.length + 1 }; }
  function L(k) { return defs().labels[k] || k; }

  /* ---------- 작은 도구 ---------- */
  var esc = function (s) { return A.esc(s); }, num = function (n) { return A.num(n); }, won = function (n) { return A.won(n); }, isNum = function (v) { return typeof v === "number" && isFinite(v); };
  function cnt(n) { return isNum(n) ? n.toLocaleString("ko-KR") : null; }
  function p1(v) { return isNum(v) ? (v * 100).toFixed(1) + "%" : null; }
  function sgn(x, d) { return (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d == null ? 1 : d); }
  function chip(g, kind) {
    if (!g || g.state !== "ok") return '<span class="gw-d na" title="' + esc(g && g.why || "") + '">비교 불가</span>';
    var v = kind === "pp" ? g.pp : g.pct * 100, up = v > 0.0001, dn = v < -0.0001; var t = (up ? "▲ " : dn ? "▼ " : "– ") + sgn(v) + (kind === "pp" ? "%p" : "%");
    return '<span class="gw-d ' + (up ? "up" : dn ? "dn" : "fl") + '">' + t + "</span>";
  }
  function badge(code, text, tip) { return '<span class="gw-tr ' + code + '"' + (tip ? ' title="' + esc(tip) + '"' : "") + ">" + esc(text) + "</span>"; }
  var TR = { ok: ["ok", "확인 완료"], cand: ["cand", "연결 후보"], short: ["short", "데이터 부족"], na: ["na", "확인 불가"] };
  function tr(k, tip) { return badge(TR[k][0], TR[k][1], tip); }
  function jump(id) { setTimeout(function () { var el = document.getElementById(id); if (el && el.scrollIntoView) el.scrollIntoView({ block: "start", behavior: "smooth" }); }, 40); }
  function ymLabel(m) { return Gs.basis === "ytd" ? "1/1~" + m.endMD.replace("-", "/") + " 동일기간" : "연간(" + m.lastY + "년은 " + m.endMD.replace("-", "/") + "까지 누계)"; }
  function yl(m, y) { return y + (Gs.basis === "ytd" ? "" : (y === m.lastY ? "*" : "")); }

  /* ---------- 모델 ---------- */
  var model = null, mkey = "";
  function getModel() {
    var st0 = A.S.state;
    if (st0.mode === "public" && st0.pub && st0.pub.data) {          /* 공개 보기: 서버가 집계해 둔 값(업체·현장 단위 정보 없음) */
      var pkey = "pub|" + st0.pub.data.meta.hash + "|" + st0.version; if (model && mkey === pkey) return model;
      try { model = GC.buildPublic(st0.pub.data.growth, { kpi: A.objs("1.통합KPI") }); model.publicMeta = st0.pub.data.meta; } catch (e) { model = { missing: ["공개 집계 해석 오류: " + (e.message || e)], years: [], error: true }; }
      mkey = pkey; return model;
    }
    var d = defs(), st = A.S.state, led = A.ledger(); var key = [st.version, st.epoch, st.mode, led ? led.length : 0, d.endMD || "", JSON.stringify(d.famRules || "")].join("|");
    if (model && mkey === key) return model;
    var src = { has: A.has, objs: A.objs, ledger: function () { return A.ledger(); } };
    try { model = GC.build(src, { defs: { endMD: d.endMD, famRules: d.famRules } }); } catch (e) { model = { missing: ["계산 오류: " + (e.message || e)], years: [], error: true }; }
    mkey = key; return model;
  }

  /* ---------- SVG 그래프 ---------- */
  var uid = 0;
  function svgOpen(W, H, title) { uid++; return '<svg class="gw-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(title) + '"><defs><pattern id="gh' + uid + '" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--surf)"/><line x1="0" y1="0" x2="0" y2="5" stroke="var(--text-3)" stroke-width="1.4" opacity=".55"/></pattern></defs>'; }
  function barChart(o) {
    var W = 360, H = o.h || 190, pl = 4, pr = 4, pt = 20, pb = 22, n = o.cats.length, gw = (W - pl - pr) / n, ns = o.series.length, gap = 3, bw = Math.min(28, (gw - 10 - (ns - 1) * gap) / ns), max = 0, ph = H - pt - pb;
    o.series.forEach(function (s) { s.vals.forEach(function (v) { if (isNum(v) && v > max) max = v; }); }); if (!max) max = 1;
    var h = svgOpen(W, H, o.title) + '<line class="gw-ax" x1="0" x2="' + W + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '"/>';
    o.cats.forEach(function (c, i) {
      var x0 = pl + i * gw, tip = [];
      if (o.sel === c) h += '<rect class="gw-sel" x="' + (x0 + 1) + '" y="2" width="' + (gw - 2) + '" height="' + (H - 4) + '" rx="5"/>';
      o.series.forEach(function (s, j) {
        var v = s.vals[i], bx = x0 + (gw - ns * bw - (ns - 1) * gap) / 2 + j * (bw + gap), why = s.na && s.na[i];
        if (isNum(v)) { var bh = Math.max(1.5, ph * v / max), by = H - pb - bh; h += '<rect class="gw-b ' + s.cls + '" x="' + bx.toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="2"/>';
          var lab = s.fmt(v); if (ns >= 3) h += '<text class="gw-vl" transform="rotate(-90 ' + (bx + bw / 2 + 3).toFixed(1) + " " + (by - 3).toFixed(1) + ')" x="' + (bx + bw / 2 + 3).toFixed(1) + '" y="' + (by - 3).toFixed(1) + '" text-anchor="start">' + esc(lab) + "</text>"; else h += '<text class="gw-vl" x="' + (bx + bw / 2).toFixed(1) + '" y="' + (by - 3).toFixed(1) + '" text-anchor="middle">' + esc(lab) + "</text>";
          tip.push(s.name + " " + lab); }
        else { h += '<rect class="gw-b na" x="' + bx.toFixed(1) + '" y="' + (H - pb - 14) + '" width="' + bw.toFixed(1) + '" height="14" rx="2" fill="url(#gh' + uid + ')"/><text class="gw-vl na" x="' + (bx + bw / 2).toFixed(1) + '" y="' + (H - pb - 17) + '" text-anchor="middle">–</text>'; tip.push(s.name + " " + (why || "값 없음")); }
      });
      h += '<text class="gw-cl' + (o.sel === c ? " on" : "") + '" x="' + (x0 + gw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(o.catLabel ? o.catLabel(c) : c) + "</text>";
      if (o.click) h += '<rect class="gw-hit" x="' + x0.toFixed(1) + '" y="0" width="' + gw.toFixed(1) + '" height="' + H + '" fill="transparent" data-kact="' + o.click.act + '" data-id="' + esc(c) + '" data-sec="' + o.click.sec + '" tabindex="0" role="button" aria-label="' + esc(c + "년 상세 보기") + '"><title>' + esc(c + "년 · " + tip.join(" · ")) + "</title></rect>";
    });
    return h + "</svg>";
  }
  function lineChart(o) {
    var W = 360, H = o.h || 150, pl = 10, pr = 10, pt = 18, pb = 22, n = o.cats.length, gw = (W - pl - pr) / n, vals = []; o.series.forEach(function (s) { s.vals.forEach(function (v) { if (isNum(v)) vals.push(v); }); });
    var lo = vals.length ? Math.min.apply(null, vals) : 0, hi = vals.length ? Math.max.apply(null, vals) : 1; var padv = (hi - lo) * 0.25 || 0.05; lo = Math.max(0, lo - padv); hi = Math.min(1, hi + padv); if (hi - lo < 0.05) hi = lo + 0.05; var ph = H - pt - pb;
    function yy(v) { return pt + ph * (1 - (v - lo) / (hi - lo)); }
    var h = svgOpen(W, H, o.title) + '<line class="gw-ax" x1="0" x2="' + W + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '"/>';
    o.cats.forEach(function (c, i) { var cx = pl + i * gw + gw / 2; if (o.sel === c) h += '<rect class="gw-sel" x="' + (pl + i * gw + 1) + '" y="2" width="' + (gw - 2) + '" height="' + (H - 4) + '" rx="5"/>'; h += '<text class="gw-cl' + (o.sel === c ? " on" : "") + '" x="' + cx.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(c) + "</text>"; if (o.click) h += '<rect class="gw-hit" x="' + (pl + i * gw).toFixed(1) + '" y="0" width="' + gw.toFixed(1) + '" height="' + H + '" fill="transparent" data-kact="' + o.click.act + '" data-id="' + esc(c) + '" data-sec="' + o.click.sec + '" tabindex="0" role="button" aria-label="' + esc(c + "년 상세 보기") + '"/>'; });
    o.series.forEach(function (s, j) {
      var pts = [], seg = ""; s.vals.forEach(function (v, i) { if (isNum(v)) { var x = pl + i * gw + gw / 2, y = yy(v); pts.push([x, y, v]); seg += (seg ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); } else seg += ""; });
      var path = ""; var run = []; s.vals.forEach(function (v, i) { if (isNum(v)) run.push([pl + i * gw + gw / 2, yy(v)]); else { if (run.length > 1) path += "M" + run.map(function (p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("L"); run = []; } }); if (run.length > 1) path += "M" + run.map(function (p) { return p[0].toFixed(1) + " " + p[1].toFixed(1); }).join("L");
      if (path) h += '<path class="gw-ln ' + s.cls + '" d="' + path + '"/>';
      pts.forEach(function (p) { h += '<circle class="gw-pt ' + s.cls + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.2"/><text class="gw-vl" x="' + p[0].toFixed(1) + '" y="' + (p[1] + (j ? 12 : -6)).toFixed(1) + '" text-anchor="middle">' + esc((p[2] * 100).toFixed(1)) + "%</text>"; });
    });
    return h + "</svg>";
  }
  function legend(items) { return '<div class="gw-lg">' + items.map(function (x) { return '<span><i class="sw ' + x[0] + '"></i>' + esc(x[1]) + "</span>"; }).join("") + "</div>"; }
  function yoyRow(m, key, kind) { return '<div class="gw-yoy" style="grid-template-columns:repeat(' + m.years.length + ',1fr)">' + m.years.map(function (y) { return "<div>" + chip(m.growth(Gs.basis, y, key), kind) + "</div>"; }).join("") + "</div>"; }
  function chartBox(title, sub, body, extra) { return '<div class="gw-chart"><div class="t">' + esc(title) + (sub ? ' <span class="mini">' + esc(sub) + "</span>" : "") + "</div>" + body + (extra || "") + "</div>"; }

  /* ---------- 표(좁은 화면에서 카드로 접힘) ---------- */
  function gtable(id, cols, rows, opt) {
    opt = opt || {}; var per = opt.per || 12, V = A.V; var p = V.page[id] || 0, pages = Math.max(1, Math.ceil(rows.length / per)); if (p >= pages) p = pages - 1; V.page[id] = p; var sl = rows.slice(p * per, p * per + per);
    var h = '<div class="tblwrap"><table class="gw-t"><thead><tr>' + cols.map(function (c) { return '<th class="' + (c.r ? "r" : "") + '">' + esc(c.l || c.k) + "</th>"; }).join("") + "</tr></thead><tbody>";
    if (!sl.length) h += '<tr><td colspan="' + cols.length + '" class="gw-empty">' + esc(opt.empty || "조건에 해당하는 행이 없습니다") + "</td></tr>";
    sl.forEach(function (o) { h += "<tr>" + cols.map(function (c) { var v = c.f ? c.f(o) : o[c.k]; var t = v == null || v === "" ? '<span class="mini">—</span>' : (c.raw ? v : esc(c.fmt ? c.fmt(v) : v)); return '<td data-l="' + esc(c.l || c.k) + '" class="' + (c.r ? "r num" : "") + (c.wrap ? " wrap" : "") + '">' + t + "</td>"; }).join("") + "</tr>"; });
    h += "</tbody></table></div>";
    if (rows.length > per) h += '<div class="pg"><span>' + (p * per + 1) + "–" + Math.min(rows.length, p * per + per) + " / " + num(rows.length) + '</span><button data-kact="pg" data-id="' + id + '" data-d="-1"' + (p === 0 ? " disabled" : "") + '>이전</button><button data-kact="pg" data-id="' + id + '" data-d="1"' + (p >= pages - 1 ? " disabled" : "") + ">다음</button></div>";
    return h;
  }
  function vlink(id, name) { return '<a class="vlink" data-kact="gvendor" data-id="' + esc(id) + '">' + esc(name || id) + "</a>"; }
  function stChip(code, label) { return '<span class="st ' + (code === "ok" ? "ok" : code === "cand" ? "rev" : code === "nocand" ? "na" : "na") + '">' + esc(label) + "</span>"; }
  function simpleTable(head, rows, flow) { return '<div class="tblwrap"><table class="gw-t' + (flow ? ' gw-flowt' : '') + '"><thead><tr>' + head.map(function (x, i) { return '<th class="' + (i ? "r" : "") + '">' + esc(x) + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.map(function (r) { return "<tr>" + r.map(function (c, i) { return '<td data-l="' + esc(head[i]) + '" class="' + (i ? "r num" : "") + '">' + c + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>"; }
  function toggleBtn(id, onText, offText) { var on = !!Gs.open[id]; return '<button class="btn ghost" data-kact="gtoggle" data-id="' + id + '">' + esc(on ? onText : offText) + "</button>"; }

  /* ---------- 머리 · 출처 · 검색 ---------- */
  function pubProvenance(m) {
    var pm = m.publicMeta || {}, ps = A.S.state.pub || {}, sv = ps.serve || {};
    var stale = sv.state && sv.state !== "ok";
    return '<div class="gw-prov"><span><b>출처</b> 구글시트 25개 탭 → 서버 자동 집계(공개용)</span><span><b>기준일</b> ' + esc(m.asOf || "—") + "</span><span><b>최종 갱신</b> " + esc(A.hhmm(pm.generatedAt) || "—") + (stale ? " (새 집계 보류 · 이전 정상 집계)" : "") + "</span><span><b>시트 변경 감지</b> " + esc(A.hhmm(pm.sourceModified) || "—") + "</span><span><b>공개 범위</b> 집계값만</span><span><b>정의 버전</b> v" + defs().version + " · " + CALC_VER + "</span></div>";
  }
  function provenance(m) {
    if (m.restricted) return pubProvenance(m);
    var st = A.S.state, meta = st.meta || {}, em = st.embeddedMeta || {}, sy = st.sync, live = st.mode === "live", led = A.ledger();
    var src = live ? "구글시트 실시간 · " + esc(meta.title || "") : "저장된 데이터 " + esc(em.version || "") + " · " + esc(em.verified || "");
    var upd = live ? (sy.lastOkAt ? A.hhmm(sy.lastOkAt) + (sy.stale ? " (이전 데이터)" : "") : "—") : (em.exportedAt ? A.hhmm(em.exportedAt) : esc(em.asOf || "—"));
    var lg = led ? "판매 원문 " + num(led.length) + "행 읽음" : (A.V.ledgerState === "error" ? "판매 원문 읽기 실패 — 일부 지표 대기" : "판매 원문 읽는 중…");
    return '<div class="gw-prov"><span><b>출처</b> ' + src + "</span><span><b>기준일</b> " + esc(m.asOf || "—") + "</span><span><b>최종 갱신</b> " + upd + "</span><span><b>원문</b> " + esc(lg) + "</span><span><b>정의 버전</b> v" + defs().version + " · " + CALC_VER + "</span></div>";
  }
  function header(m) {
    var d = defs(); var y0 = m.years[0], asOf = m.asOf || ""; var md = asOf.split("-"); var per = y0 + "년 1월 1일 ~ " + (md[0] || "") + "년 " + Number(md[1] || 0) + "월 " + Number(md[2] || 0) + "일";
    var h = '<div class="card gw-head"><h1 class="gw-h1">POUR 사업 성장 분석 대시보드</h1>' + (m.restricted ? '<div class="gw-pubtag">공개 집계 · 로그인 없이 열람 · 시공사·현장·거래 명세는 비공개</div>' : "") + '<div class="gw-per">조회 기간 ' + esc(per) + "</div>" + provenance(m);
    h += '<div class="gw-ctl"><div class="ks-chips"><button data-kact="gbasis" data-id="ytd"' + (Gs.basis === "ytd" ? ' aria-current="true"' : "") + ">동일기간 1/1~" + esc(m.endMD.replace("-", "/")) + '</button><button data-kact="gbasis" data-id="ann"' + (Gs.basis === "ann" ? ' aria-current="true"' : "") + ">연간(확정 연도)</button></div>";
    h += '<div class="ks-chips">' + m.years.map(function (y) { return '<button data-kact="gyearsel" data-id="' + y + '"' + (Gs.year === y ? ' aria-current="true"' : "") + ">" + y + "</button>"; }).join("") + "</div></div>";
    h += '<div class="ks-tools gw-search"><input id="gw-q" data-kact="gq" type="search" placeholder="' + (m.restricted ? "시공사 검색은 상세 보기(로그인)에서 이용" : "시공사 검색 (업체명·표기·통합ID·사업자번호)") + '" value="' + esc(Gs.q) + '" autocomplete="off"><button class="btn" data-kact="gqgo">검색</button>' + (Gs.q ? '<button class="btn ghost" data-kact="gqclear">지우기</button>' : "") + "</div>";
    h += '<div class="gw-menu">' + [["gw-our", "우리 공법"], ["gw-sum", "핵심 지표"], ["gw-flow", "종합 흐름"], ["gw-awards", "① 공고·낙찰"], ["gw-sales", "② 자재 매출"], ["gw-cohort", "③ 낙찰→구매 연결"], ["gw-q", "질문 답변"], ["gw-who", "기여·확인 필요 업체"], ["gw-cov", "데이터 신뢰도"], ["gw-def", "지표 정의"]].map(function (x) { return '<button data-kact="gjump" data-id="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>";
    if (m.missing && m.missing.length) h += '<div class="ks-warn"><b>시트 구조 경고:</b> ' + esc(m.missing.join(", ")) + " 탭이 없거나 구조가 달라 해당 분석은 표시하지 않습니다(0으로 대체하지 않음).</div>";
    return h + "</div>";
  }
  function searchCard(m) {
    if (!Gs.q) return ""; if (m.restricted) return '<div class="card"><div class="card-h"><h2>시공사 검색</h2><span class="badge rev">비공개</span></div>' + restrictedNote("시공사 검색·상세 분석은 업체 정보가 포함되어 공개 보기에서 제공하지 않습니다") + "</div>"; var rs = Gs.qres || m.findVendors(Gs.q);
    var h = '<div class="card"><div class="card-h"><h2>시공사 검색 결과</h2><span class="badge">' + rs.length + (rs.length >= 40 ? "+" : "") + "곳</span><span class=\"mini\">업체명을 누르면 상세 분석이 열립니다</span></div>";
    h += gtable("gsearch", [{ k: "업체", raw: 1, f: function (r) { return vlink(r["통합ID"], r["대표업체명"]); } }, { k: "통합ID" }, { k: "사업자등록번호", l: "사업자번호" }, { k: "연결상태" }, { k: "낙찰시공사_표기", l: "낙찰 표기", wrap: 1 }], rs, { per: 8, empty: "일치하는 시공사가 없습니다" });
    return h + "</div>";
  }

  /* ---------- 쉬운 근거: 제목 바로 아래에 "뜻 · 계산 · 출처 · 조심할 점"을 접어서 보여준다 ---------- */
  var EZ_L = ["무슨 뜻이에요?", "어떻게 계산했어요?", "어디서 가져왔어요?", "조심할 점"];
  function easyBlock(a) { return '<details class="ez"><summary>쉽게 보기 · 이 숫자의 근거</summary><dl>' + a.map(function (t, i) { return t ? "<dt>" + EZ_L[i] + "</dt><dd>" + esc(t) + "</dd>" : ""; }).join("") + "</dl></details>"; }
  function withEasy(html, map) {
    Object.keys(map).forEach(function (k) { var mk = "<h2>" + k + "</h2>", from = 0, i; while ((i = html.indexOf(mk, from)) >= 0) { var e = html.indexOf("</div>", i); if (e < 0) break; e += 6; var ins = easyBlock(map[k]); html = html.slice(0, e) + ins + html.slice(e); from = e + ins.length; } });
    return html;
  }
  var EASY_GROW = {
    "핵심 성장 지표": ["고른 연도(같은 기간끼리)의 공고·낙찰·낙찰금액·자재 매출·메인자재·구매 연결, 6가지가 작년보다 늘었는지 줄었는지 한눈에 보여줘요.", "증감 = (올해 − 작년) ÷ 작년. 예: 작년 100건, 올해 120건이면 +20%.", "5b.POUR반영공고(공고), 5.POUR공고낙찰(낙찰), 이카운트 판매 원문(매출), 4.메인자재구매현황.", "올해는 10월 20일까지라서 작년 '전체 연간'과 비교하지 않고, 작년 같은 기간(1/1~10/20)끼리 비교해요. 비교할 수 없으면 '비교 불가'로 적어요."],
    "종합 성장 흐름": ["공고 → 낙찰 → 자재 구매로 이어지는 흐름을 연도별로 나란히 놓고 보는 그림이에요.", "각 막대는 그 해(같은 기간)의 건수나 금액이에요. 아래 줄은 작년 대비 증감이에요.", "공고·낙찰·판매 원문 집계.", "공고는 해마다 담긴 범위가 달라요(아래 ① 설명 참고)."],
    "① POUR 공고·낙찰 성장 분석": ["'공고'는 아파트 공사 입찰 공고문 한 건이에요. 이 중 우리 POUR 특허가 들어간 공고가 몇 건이고, 그중 몇 건이 POUR 낙찰로 이어졌는지 보는 곳이에요.","자사 반영 공고 합계 = POUR 단독 + 다특허(PD) + DO·CNC. 낙찰/공고 = 낙찰 기록이 연결된 공고 ÷ 자사 반영 공고. 전년 대비 = (올해−작년)÷작년이고, 모든 해 같은 기간(1/1~10/20)끼리 비교해요.","시트 5b.POUR반영공고(집계대상=Y), 5.POUR공고낙찰. 원본: 2022~2024 'POUR공법 공고문 LIST', 2025·2026 '전체 및 POUR 공법 공고문 현황'.","2025년부터 구분(POUR 단독·다특허·DO·CNC)이 생겨서 POUR 단독과 다특허·브랜드의 2025년 증감은 '비교 불가'예요. 2025년에 공고 관리 방식이 '전체 공고문 확대 관리'로 바뀌었다고 원본에 적혀 있어, 증가의 일부는 수집 범위가 넓어진 효과일 수 있어요(원본만으로는 확인할 수 없어요)."],
    "연도별 실적 비교표": ["해마다 우리 공법의 공고·낙찰·낙찰금액이 어땠는지 표로 비교해요. 앞쪽 열일수록 우리 공법 성과예요.","각 '전년 대비'는 (올해−작년)÷작년이에요. 모든 해 같은 기간(1/1~10/20)끼리 비교해요.","시트 5b.POUR반영공고(집계대상 Y), 5.POUR공고낙찰.","'다특허(PD)'는 경쟁사 공고가 아니라 우리 특허가 함께 들어 있는 다특허 공고예요. 구분이 없던 해와는 비교할 수 없어 '비교 불가'예요."],
    "② 자재 매출 성장 분석": ["우리 자재(이카운트 판매)가 얼마나 팔렸는지, 그중 '메인자재'가 얼마인지 비교해요.", "그 해(같은 기간)의 판매 공급가액 합계. 증감 = (올해 − 작년) ÷ 작년.", "이카운트 판매 원문(시트 3), 1.통합KPI.", "메인자재는 품목 이름을 검증한 해만 보여줘요. 검증 전 해는 0이 아니라 '미확인'이에요. 금액은 VAT 제외예요."],
    "연도별 매출 비교표": ["해마다 전체 자재 매출과 메인자재 매출을 표로 비교해요.", "같은 기간의 판매 합계와 작년 대비 증감 %.", "이카운트 판매 원문, 1.통합KPI.", "비자재·용역도 전체 매출에 들어 있어요(기존 KPI 정의)."],
    "③ POUR 낙찰 시공사 → 자재 구매 연결 분석": ["POUR로 낙찰받은 시공사가 우리 자재를 실제로 샀는지 보는 곳이에요.", "자재를 산 기록이 있는 낙찰 시공사 수 ÷ 낙찰 시공사 수.", "5.POUR공고낙찰의 낙찰 시공사, 이카운트 판매 원문(거래처).", "사업자번호가 없어서 이름으로 '연결 후보'만 잡았어요. 산 것이 그 현장에 쓰였다는 증거는 아니에요."],
    "연도별 연결 비교표": ["낙찰 시공사 중 자재를 산 시공사가 해마다 얼마나 되는지 비교해요.", "연결 후보 시공사 ÷ 낙찰 시공사.", "낙찰 기록과 판매 원문.", "'후보'라서 확정 숫자가 아니에요."],
    "질문 답변": ["팀장님이 자주 묻는 질문에 대한 답을 숫자로 요약해요.", "위 표와 카드의 같은 숫자를 문장으로 풀었어요.", "위 분석과 같은 시트.", "비교할 수 없는 항목은 '비교 불가'라고 적어요."],
    "어떤 시공사가 매출 성장에 기여했는가?": ["올해 우리 자재를 가장 많이 늘려 산 시공사가 어디인지 보여줘요.", "시공사별 올해 구매액 − 작년 같은 기간 구매액.", "이카운트 판매 원문.", "시공사 이름이 다르게 적힌 경우를 묶었지만, 사업자번호가 없어 일부는 '후보'예요."],
    "낙찰 이력은 있지만 구매 확인이 필요한 업체는?": ["POUR 낙찰은 받았는데 우리 자재를 산 기록이 안 보이는 시공사 목록이에요.", "낙찰 기록은 있고 판매 원문에서 구매가 확인되지 않는 시공사.", "낙찰 기록, 판매 원문.", "'구매 없음'이 아니라 '구매 미확인'이에요. 이름이 다르게 적혀 못 찾았을 수도 있어요."],
    "데이터 신뢰도 · 기간별 누락·비교 불가": ["숫자를 얼마나 믿어도 되는지 상태별로 알려줘요(확인 완료·연결 후보·데이터 부족·확인 불가).", "각 숫자에 상태 표시를 붙였어요.", "각 지표의 원천 시트.", "데이터가 없으면 0으로 채우지 않고 이유를 적어요."]
  };
  /* ---------- 우리 POUR 공법 성과 우선 표시: 팀장 질문 "우리 공법 공고가 실제 얼마나 늘었나?" ---------- */
  function ourCard(m) {
    var B = Gs.basis, Y = Gs.year, P = m.prevOf(Y), c = m.metrics(B, Y), p = P ? m.metrics(B, P) : null;
    if (!c) return "";
    var span = ymLabel(m), oth = function (x) { return x && isNum(x.notices) && isNum(x.noticesPour) ? x.notices - x.noticesPour : null; }, sy = m.splitYear && m.splitYear(), undiv = function (yy) { return !!(sy && yy < sy); };
    var gT = m.growth(B, Y, "notices"), gP = m.growth(B, Y, "noticesPour"), gW = m.growth(B, Y, "awards"), gA = m.growth(B, Y, "awardAmt"), gO = m.growth(B, Y, "noticesOther");
    var row = function (rank, label, big, prev, g, note, kind) { return '<div class="gw-our"><span class="rk">' + rank + '</span><div class="b"><div class="t">' + esc(label) + '</div><div class="n">' + esc(big) + '</div><div class="d">' + (P ? esc(P) + "년 " + esc(prev) + " " : "") + chip(g, kind) + '</div>' + (note ? '<div class="w">' + note + "</div>" : "") + "</div></div>"; };
    var whyT = function (g) { return g && g.state !== "ok" && g.why ? esc(g.why) : ""; };
    var h = '<div class="card gw-ourcard" id="gw-our"><div class="card-h"><h2>우리 POUR 공법 성과 — 공고는 얼마나 늘었나요?</h2><span class="badge">' + esc(Y) + "년 " + esc(span) + (P ? " vs " + esc(P) + "년 같은 기간" : "") + '</span></div>';
    h += '<p class="gw-oneline">' + (p && isNum(c.notices) && isNum(p.notices) && gT.state === "ok" ? "<b>우리 특허가 들어간 공고(자사 반영 공고)</b>는 " + esc(P) + "년 " + cnt(p.notices) + "건 → " + esc(Y) + "년 " + cnt(c.notices) + "건, <b>" + (gT.pct >= 0 ? "+" : "−") + (Math.abs(gT.pct) * 100).toFixed(1) + "%</b> 입니다(같은 기준 · 같은 기간)." : "전년과 같은 기준으로 비교할 수 있는 값이 없어 증감을 계산하지 않았습니다.") + "</p>";
    h += '<div class="gw-ours">' +
      row("①", "POUR 단독 공고", c.noticesPour == null ? "—" : cnt(c.noticesPour) + "건", p ? (undiv(P) ? "구분 없음(합계에 포함)" : p.noticesPour == null ? "—" : cnt(p.noticesPour) + "건") : "", gP, whyT(gP)) +
      row("②", "POUR 낙찰", c.awards == null ? "—" : cnt(c.awards) + "건", p ? (p.awards == null ? "—" : cnt(p.awards) + "건") : "", gW, "") +
      row("③", "POUR 낙찰금액", won(c.awardAmt) || "—", p ? (won(p.awardAmt) || "—") : "", gA, "VAT 미확인 · 금액 미기재 " + (c.awardAmtMissing || 0) + "건은 합계에서 제외") +
      row("④", "자사 반영 공고 합계 (전체 공고·시장 변화의 기준)", c.notices == null ? "—" : cnt(c.notices) + "건", p ? (p.notices == null ? "—" : cnt(p.notices) + "건") : "", gT, "POUR 단독 + 다특허(PD) + DO·CNC · 2022~2024 목록과 같은 기준이라 전년과 비교할 수 있어요") +
      row("⑤", "다특허·브랜드 공고 (PD·DO·CNC)", oth(c) == null ? "—" : cnt(oth(c)) + "건", p ? (undiv(P) ? "구분 없음(합계에 포함)" : oth(p) == null ? "—" : cnt(oth(p)) + "건") : "", gO, whyT(gO) || "경쟁사 공고가 아니라, 우리 특허가 함께 들어 있는 다특허 공고와 브랜드(DO·CNC) 공고예요") + "</div>";
    h += easyBlock(["공고문 목록에서 우리 POUR 특허가 들어간 공고(자사 반영 공고)가 전년 같은 기간보다 얼마나 늘었는지 보여줘요.",
      p && isNum(c.notices) && isNum(p.notices) ? "자사 반영 공고 전년 대비 = (" + cnt(c.notices) + " − " + cnt(p.notices) + ") ÷ " + cnt(p.notices) + (gT.state === "ok" ? " = " + (gT.pct >= 0 ? "+" : "−") + (Math.abs(gT.pct) * 100).toFixed(1) + "%" : "") + ". 기간: " + Y + "년 " + span + " vs " + P + "년 같은 기간(공고일 기준). POUR 단독 " + cnt(c.noticesPour) + "건 + 다특허·브랜드 " + (oth(c) == null ? "—" : cnt(oth(c))) + "건 = " + cnt(c.notices) + "건." : "전년 값이 없어 증감을 계산하지 않았어요.",
      "시트 5b.POUR반영공고(집계대상=Y) ← 원본 연도별 공고 목록 엑셀(2022~2024 'POUR공법 공고문 LIST', 2025·2026 '전체 및 POUR 공법 공고문 현황'). 낙찰은 시트 5.POUR공고낙찰.",
      "POUR 단독과 다특허·브랜드는 구분이 생긴 2025년과 그 전 해를 비교할 수 없어 '비교 불가'예요. '다특허(PD)'는 경쟁사 공고가 아니라 우리 특허가 함께 들어 있는 공고예요. 원본에 2025년부터 공고 관리가 '전체 공고문 확대 관리'로 바뀌었다고 적혀 있어, 증가의 일부는 수집 범위가 넓어진 효과일 수 있어요(원본만으로는 확인할 수 없어요)."]);
    h += '<p class="gw-note">경쟁사·일반 공고를 포함한 시장 전체 공고 수는 이 시트에 담기지 않았습니다(원본 \'전체 공고문\' 시트에는 있음). 시트에 담기 전에는 시장 점유율을 계산하지 않습니다.</p>';
    return h + "</div>";
  }
  /* ---------- 핵심 성장 지표 ---------- */
  function tile(label, val, d, sub, trust, jumpId) { return '<div class="tile gw-tile" data-kact="gjump" data-id="' + jumpId + '" tabindex="0" role="button"><div class="l">' + esc(label) + '</div><div class="v' + (val == null ? " na" : "") + '">' + (val == null ? "확인 불가" : esc(val)) + '</div><div class="gw-dl">' + d + "</div>" + (sub ? '<div class="s">' + sub + "</div>" : "") + '<div class="gw-tt">' + trust + "</div></div>"; }
  function summary(m) {
    var B = Gs.basis, Y = Gs.year, P = m.prevOf(Y), c = m.metrics(B, Y), p = P ? m.metrics(B, P) : null;
    var gS = m.growth(B, Y, "sales"), gM = m.growth(B, Y, "main"), gN = m.growth(B, Y, "notices"), gW = m.growth(B, Y, "awards"), gA = m.growth(B, Y, "awardAmt"), gP = m.growth(B, Y, "noticesPour");
    var h = '<div class="card core6" id="gw-sum"><div class="card-h"><h2>핵심 성장 지표</h2><span class="badge">' + esc(Y) + "년 " + esc(ymLabel(m)) + (P ? " vs " + esc(P) + "년" : "") + '</span><span class="mini">카드를 누르면 해당 분석으로 이동 · 비교할 수 없는 지표는 임의로 계산하지 않고 \'비교 불가\'로 표시</span></div><div class="tiles six">';
    h += tile(L("notices"), cnt(c.notices) == null ? null : cnt(c.notices) + "건", chip(gN), (p ? esc(P) + "년 " + cnt(p.notices) + "건" : "") + " · POUR 단독 " + cnt(c.noticesPour) + "건 + 다특허·브랜드 " + (isNum(c.notices) && isNum(c.noticesPour) ? cnt(c.notices - c.noticesPour) : "—") + "건 · POUR 단독 전년 대비 " + chip(gP), tr("ok", "5b.POUR반영공고 집계대상=Y · 기존 KPI 카드와 일치"), "gw-awards");
    h += tile(L("awards"), cnt(c.awards) == null ? null : cnt(c.awards) + "건", chip(gW), (p ? esc(P) + "년 " + cnt(p.awards) + "건 · " : "") + L("ratio") + " " + (p1(c.awardRatio) || "—") + " " + chip(m.growth(B, Y, "ratio"), "pp"), c.unmatchedAwards ? tr("short", "낙찰 " + c.unmatchedAwards + "건은 공고 목록과 연결되지 않아 비율 분자에서 제외") : tr("ok"), "gw-awards");
    h += tile(L("awardAmt"), won(c.awardAmt), chip(gA), "VAT 미확인 · 금액 미기재 " + (c.awardAmtMissing || 0) + "건 제외", tr("ok", "금액이 기재된 건만 합산"), "gw-awards");
    h += tile(L("sales"), won(c.sales), chip(gS), (isNum(gS.abs) ? "증감 " + (gS.abs >= 0 ? "+" : "−") + won(Math.abs(gS.abs)) : "") + " · 비자재·용역 포함(기존 KPI 정의)", tr(c.salesCheck === false ? "short" : "ok", c.salesCheck === false ? "원문 합계와 다름" : "1.통합KPI 값 · 원문 합계 대조 " + (c.salesCheck ? "일치" : "대기")), "gw-sales");
    h += tile(L("main"), isNum(c.main) ? won(c.main) : null, isNum(c.main) ? chip(gM) : "", isNum(c.main) ? "비중 " + (p1(c.mainShare) || "—") + " (전체 대비)" : esc(c.mainWhy || ""), isNum(c.main) ? tr("ok") : tr("short", c.mainWhy), "gw-sales");
    var co = c.cohort; h += tile(L("buyRate"), co ? p1(co.buyRate) : null, co ? chip(m.growth(B, Y, "buyRate"), "pp") : "", co ? co.buyN + "/" + co.n + "곳 구매 확인 · " + L("mainRate") + " " + (co.mainRate == null ? "미확인" : p1(co.mainRate)) : "판매 원문을 읽는 중입니다", co ? tr("cand", "판매 원천에 사업자번호가 없어 이름 일치 기준 후보") : tr("short"), "gw-cohort");
    return h + "</div></div>";
  }

  /* ---------- 종합 성장 흐름 ---------- */
  function flow(m) {
    var B = Gs.basis, Y = Gs.year, P = m.prevOf(Y), c = m.metrics(B, Y), p = P ? m.metrics(B, P) : null, co = c.cohort, cp = p && p.cohort;
    function stage(n, title, val, sub, ratioHtml) { return '<div class="gw-st"><div class="n">' + n + '</div><div class="tt">' + esc(title) + '</div><div class="vv">' + (val == null ? '<span class="na">확인 불가</span>' : esc(val)) + '</div><div class="ss">' + sub + "</div>" + (ratioHtml ? '<div class="rr">' + ratioHtml + "</div>" : "") + "</div>"; }
    var h = '<div class="card" id="gw-flow"><div class="card-h"><h2>종합 성장 흐름</h2><span class="badge">' + esc(Y) + "년 " + esc(ymLabel(m)) + '</span><span class="mini">POUR 공고 → 낙찰 → 낙찰 시공사의 자재 구매 → 자사 매출</span></div>';
    h += '<div class="gw-flowrow">' +
      stage(1, "자사 반영 공고", c.notices == null ? null : cnt(c.notices) + "건", "POUR 단독 " + cnt(c.noticesPour) + " + 다특허·브랜드 " + (isNum(c.notices) && isNum(c.noticesPour) ? cnt(c.notices - c.noticesPour) : "—") + "건 · " + (P ? "전년 " + cnt(p.notices) + "건 " : "") + chip(m.growth(B, Y, "notices"))) + '<div class="ar">→</div>' +
      stage(2, "낙찰", c.awards == null ? null : cnt(c.awards) + "건", (P ? "전년 " + cnt(p.awards) + "건 " : "") + chip(m.growth(B, Y, "awards")), "공고 대비 " + (p1(c.awardRatio) || "—") + " " + chip(m.growth(B, Y, "ratio"), "pp")) + '<div class="ar">→</div>' +
      stage(3, "낙찰 시공사", c.awardVendors == null ? null : cnt(c.awardVendors) + "곳", "통합ID 기준 중복 제거 · 표기 기준 " + cnt(c.awardNames) + "곳", "") + '<div class="ar">→</div>' +
      stage(4, "자재 구매 확인 업체", co ? co.buyN + "곳" : null, co ? "메인 구매 " + (co.mainBuyN == null ? "미확인" : co.mainBuyN + "곳") : "원문 읽는 중", co ? "낙찰 시공사 대비 " + (p1(co.buyRate) || "—") + " " + chip(m.growth(B, Y, "buyRate"), "pp") + " " + tr("cand") : "") + '<div class="ar">→</div>' +
      stage(5, "자사 자재 매출", c.sales == null ? null : won(c.sales), "낙찰 시공사 구매액 " + (co ? won(co.buyAmt) + " (자재 매출의 " + (p1(co.amtShare) || "—") + ")" : "원문 읽는 중"), chip(m.growth(B, Y, "sales"))) + "</div>";
    h += '<p class="gw-note">단계 사이의 비율은 같은 연도·기간 안에서 관측한 연결입니다. 낙찰 1건과 자재 구매 금액이 건 단위로 연결된 것은 아니므로 실제 \'전환\'으로 간주하지 않습니다. 사업자번호가 확정되지 않아 구매 연결은 \'후보\'입니다.</p>';
    var rows = [["자사 반영 공고 합계(건)", function (x) { return cnt(x.notices); }], ["└ POUR 단독(건)", function (x) { return m.splitYear() && String(x.year) < m.splitYear() ? "구분 없음" : cnt(x.noticesPour); }], ["└ 다특허·브랜드(건)", function (x) { return m.splitYear() && String(x.year) < m.splitYear() ? "구분 없음" : isNum(x.notices) && isNum(x.noticesPour) ? cnt(x.notices - x.noticesPour) : null; }], ["낙찰(건)", function (x) { return cnt(x.awards); }], ["낙찰/공고", function (x) { return p1(x.awardRatio); }], ["낙찰 시공사(곳)", function (x) { return cnt(x.awardVendors); }], ["구매 확인 업체(곳)", function (x) { return x.cohort ? cnt(x.cohort.buyN) : null; }], ["구매 확인/낙찰 시공사", function (x) { return x.cohort ? p1(x.cohort.buyRate) : null; }], ["메인 구매 업체(곳)", function (x) { return x.cohort ? (x.cohort.mainBuyN == null ? "미확인" : cnt(x.cohort.mainBuyN)) : null; }], ["메인 구매/낙찰 시공사", function (x) { return x.cohort ? (x.cohort.mainRate == null ? "미확인" : p1(x.cohort.mainRate)) : null; }], ["낙찰 시공사 자재 구매액", function (x) { return x.cohort ? won(x.cohort.buyAmt) : null; }], ["그 구매액/자재 매출", function (x) { return x.cohort ? p1(x.cohort.amtShare) : null; }]];
    h += simpleTable(["연도별 흐름 · " + ymLabel(m)].concat(m.years.map(function (y) { return yl(m, y); })), rows.map(function (r) { return [esc(r[0])].concat(m.years.map(function (y) { var v = r[1](m.metrics(B, y)); return v == null ? '<span class="mini">대기</span>' : esc(v); })); }), true);
    return h + "</div>";
  }

  /* ---------- ① 공고 · 낙찰 ---------- */
  function secAwards(m) {
    var B = Gs.basis, Y = Gs.year, ys = m.years, M = {}; ys.forEach(function (y) { M[y] = m.metrics(B, y); });
    var h = '<div class="card" id="gw-awards"><div class="card-h"><h2>① POUR 공고·낙찰 성장 분석</h2><span class="badge">' + esc(ymLabel(m)) + "</span>" + tr("ok") + '<span class="mini">' + (m.restricted ? "막대를 누르면 그 연도가 선택됩니다 · " : "막대를 누르면 그 연도의 시공사·현장 목록이 아래에 열립니다 · ") + '낙찰 시점은 공고일 기준(낙찰일 자료 없음)</span></div>';
    var f = function (v) { return cnt(v); };
    var ch1 = barChart({ title: "연도별 공고·낙찰 건수", cats: ys, catLabel: function (y) { return yl(m, y); }, sel: Y, click: { act: "gyear", sec: "awards" }, series: [{ name: L("notices"), cls: "c1", vals: ys.map(function (y) { return M[y].notices; }), fmt: f }, { name: L("awards"), cls: "c2", vals: ys.map(function (y) { return M[y].awards; }), fmt: f }] });
    var ch2 = barChart({ title: "연도별 낙찰금액", cats: ys, catLabel: function (y) { return yl(m, y); }, sel: Y, click: { act: "gyear", sec: "awards" }, series: [{ name: L("awardAmt"), cls: "c3", vals: ys.map(function (y) { return M[y].awardAmt; }), fmt: won }] });
    var ch3 = lineChart({ title: "공고 대비 낙찰 비율", cats: ys, sel: Y, click: { act: "gyear", sec: "awards" }, series: [{ name: L("ratio"), cls: "c4", vals: ys.map(function (y) { return M[y].awardRatio; }) }] });
    h += '<div class="gw-grid">' + chartBox("공고·낙찰 추이", "건수", ch1, legend([["c1", L("notices")], ["c2", L("awards")]]) + '<div class="gw-yl">공고 전년 대비</div>' + yoyRow(m, "notices") + '<div class="gw-yl">낙찰 전년 대비</div>' + yoyRow(m, "awards")) +
      chartBox("낙찰금액", "VAT 미확인", ch2, '<div class="gw-yl">전년 대비</div>' + yoyRow(m, "awardAmt")) +
      chartBox(L("ratio"), "같은 모집단", ch3, '<div class="gw-yl">전년 대비 증감(%p)</div>' + yoyRow(m, "ratio", "pp")) + "</div>";
    var rows = ys.map(function (y) { var c = M[y], un = !!(m.splitYear && m.splitYear() && y < m.splitYear()), oth = isNum(c.notices) && isNum(c.noticesPour) ? c.notices - c.noticesPour : null; return [esc(yl(m, y)), esc(un ? "구분 없음" : cnt(c.noticesPour) || "—"), chip(m.growth(B, y, "noticesPour")), esc(cnt(c.awards) || "—"), chip(m.growth(B, y, "awards")), esc(won(c.awardAmt) || "—"), chip(m.growth(B, y, "awardAmt")), esc(cnt(c.notices) || "—"), chip(m.growth(B, y, "notices")), esc(un ? "구분 없음" : oth == null ? "—" : cnt(oth)), chip(m.growth(B, y, "noticesOther")), esc(p1(c.awardRatio) || "—"), esc(cnt(c.awardVendors) || "—")]; });
    h += '<div class="card-h" style="margin-top:6px"><h2>연도별 실적 비교표</h2></div>' + simpleTable(["연도", "POUR 단독 공고", "전년 대비", "POUR 낙찰", "전년 대비", "POUR 낙찰금액", "전년 대비", "자사 반영 공고 합계", "합계 전년 대비", "다특허·브랜드(PD·DO·CNC)", "전년 대비", "낙찰/공고", "낙찰 시공사"], rows);
    h += '<p class="gw-note"><b>공고 숫자, 이렇게 읽으세요.</b> \'자사 반영 공고 합계\' = 공고문 목록에서 우리 POUR 특허(또는 원본이 \'POUR 공고문 현황\'에 함께 넣어 관리하는 다특허·DO·CNC)가 들어간 공고예요. 2022~2024년 목록은 이 합계를 한 목록으로 모았고, 2025년부터 구분(POUR 단독 · 다특허(PD) · DO · CNC)이 생겼어요. <b>\'다특허(PD)\'는 경쟁사 공고가 아니에요</b> — 한 공고에 특허가 여러 개 적힌 공고 중 우리 특허가 들어 있는 것이에요. 그래서 <b>합계끼리의 전년 대비</b>는 같은 기준이지만, <b>POUR 단독·다특허/브랜드</b>는 구분이 생긴 2025년과 그 전 해를 비교할 수 없어 \'비교 불가\'로 표시해요. 경쟁사 공고(타사·일반·자사 미포함 다특허)는 이 시트에 담기지 않았어요.</p>';
    h += '<div class="ks-tools"><span class="mini">상세: ' + esc(Y) + "년 " + esc(ymLabel(m)) + "</span>" + (m.restricted ? '<span class="gw-tr na">시공사·현장 목록 비공개</span>' : toggleBtn("awards", "상세 목록 접기", "시공사·현장 상세 목록 펼치기")) + "</div>";
    if (m.restricted) h += pubTradeBlock(m); else if (Gs.open.awards) h += '<div id="gw-det-awards">' + awardDetail(m) + "</div>";
    return h + "</div>";
  }
  function awardDetail(m) {
    var rows = m.awardRows(Gs.basis, Gs.year); var q = Gs.q.toLowerCase(); var trades = {}; rows.forEach(function (r) { trades[r.공종 || "미기재"] = 1; });
    var fr = rows.filter(function (r) { return (Gs.trade === "all" || (r.공종 || "미기재") === Gs.trade) && (!q || [r.업체, r.시공사, r.현장명, r.통합ID].join(" ").toLowerCase().indexOf(q) >= 0); }); var amt = 0; fr.forEach(function (r) { if (isNum(r.낙찰금액)) amt += r.낙찰금액; });
    var h = '<div class="ks-tools"><select data-kact="gtrade"><option value="all">공종 전체</option>' + Object.keys(trades).sort().map(function (t) { return '<option value="' + esc(t) + '"' + (Gs.trade === t ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("") + '</select><button class="btn ghost" data-kact="gcsv" data-id="awards">엑셀(CSV)</button><span class="cnt">' + num(fr.length) + "건 · 금액 합 " + esc(won(amt) || "—") + "</span></div>";
    h += gtable("gaw", [{ k: "업체", l: "시공사명", raw: 1, f: function (r) { return vlink(r.통합ID, r.업체); } }, { k: "현장명", l: "아파트·현장명", wrap: 1 }, { k: "공종" }, { k: "공고일" }, { k: "낙찰일", f: function () { return "자료 없음"; } }, { k: "낙찰금액", r: 1, fmt: function (v) { return won(v); } }, { k: "연결상태", l: "업체 연결 상태(마스터)" }, { k: "구매연결", l: "구매 연결", raw: 1, f: function (r) { return stChip(r.구매연결코드, r.구매연결); } }, { k: "사용확인", l: "현장 사용 확인", raw: 1, f: function (r) { return '<span title="' + esc(r.사용확인메모) + '">' + stChip(r.사용확인코드, r.사용확인) + "</span>"; } }], fr, { per: 12 });
    return h;
  }

  /* ---------- ② 자재 매출 ---------- */
  function famSeries(m, B) {
    var ys = m.years, out = [];
    GC.FAMS.forEach(function (f, i) { var vals = [], na = []; ys.forEach(function (y) { var s = m.famStatus(B, y, f), c = m.metrics(B, y); if (s.code === "ok") { vals.push(c.fam[f]); na.push(null); } else { vals.push(null); na.push(s.label); } }); out.push({ name: GC.FAM_LABEL[f], cls: ["c1", "c2", "c3"][i], vals: vals, na: na, fmt: won }); });
    return out;
  }
  function secSales(m) {
    var B = Gs.basis, Y = Gs.year, ys = m.years, M = {}; ys.forEach(function (y) { M[y] = m.metrics(B, y); });
    var h = '<div class="card" id="gw-sales"><div class="card-h"><h2>② 자재 매출 성장 분석</h2><span class="badge">' + esc(ymLabel(m)) + "</span>" + tr("ok") + '<span class="mini">' + (m.restricted ? "막대를 누르면 그 연도가 선택됩니다 · " : "막대를 누르면 그 연도의 구매 업체·금액이 아래에 열립니다 · ") + '비자재·용역 포함(기존 KPI 정의) · 메인자재는 검증된 품목 분류표 기준</span></div>';
    var ch1 = barChart({ title: "연도별 전체 자재 매출", cats: ys, catLabel: function (y) { return yl(m, y); }, sel: Y, click: { act: "gyear", sec: "sales" }, series: [{ name: L("sales"), cls: "c1", vals: ys.map(function (y) { return M[y].sales; }), fmt: won }] });
    var ch2 = barChart({ title: "전체 자재 매출과 메인자재 매출", cats: ys, catLabel: function (y) { return yl(m, y); }, sel: Y, click: { act: "gyear", sec: "sales" }, series: [{ name: L("sales"), cls: "c1", vals: ys.map(function (y) { return M[y].sales; }), fmt: won }, { name: L("main"), cls: "c2", vals: ys.map(function (y) { return M[y].main; }), na: ys.map(function (y) { return M[y].mainWhy; }), fmt: won }] });
    var ch3 = barChart({ title: "메인자재 품목별 매출", cats: ys, catLabel: function (y) { return yl(m, y); }, sel: Y, click: { act: "gyear", sec: "sales" }, h: 210, series: famSeries(m, B) });
    var famYoy = '<div class="gw-yl">품목별 전년 대비(' + esc(Y) + "년)</div>" + '<div class="gw-famyoy">' + GC.FAMS.map(function (f, i) { var g = m.famGrowth(B, Y, f), s = m.famStatus(B, Y, f); return '<div><i class="sw ' + ["c1", "c2", "c3"][i] + '"></i>' + esc(GC.FAM_LABEL[f]) + " " + (s.code === "prelaunch" ? '<span class="gw-d na" title="해당 기간 판매 기록 없음(첫 판매 ' + esc(m.firstSale[f] || "—") + ')">판매 전</span>' : chip(g)) + "</div>"; }).join("") + "</div>";
    h += '<div class="gw-grid">' + chartBox("전체 자재 매출", "공급가액 순액", ch1, '<div class="gw-yl">전년 대비</div>' + yoyRow(m, "sales")) +
      chartBox("전체 vs 메인자재", "빗금 = 미확인", ch2, legend([["c1", L("sales")], ["c2", L("main")]]) + '<div class="gw-yl">메인자재 전년 대비</div>' + yoyRow(m, "main")) +
      chartBox("우레탄·페인트·에폭시 매출 추이", "빗금 = 미확인/판매 전", ch3, legend([["c1", "페인트(재도장)"], ["c2", "우레탄 중도"], ["c3", "에폭시 중도"]]) + famYoy) + "</div>";
    var rows = ys.map(function (y) { var c = M[y], gS = m.growth(B, y, "sales"), gM = m.growth(B, y, "main"); return [esc(yl(m, y)), esc(won(c.sales) || "—"), isNum(gS.abs) ? esc((gS.abs >= 0 ? "+" : "−") + won(Math.abs(gS.abs))) : '<span class="mini">—</span>', chip(gS), isNum(c.main) ? esc(won(c.main)) : '<span class="mini">미확인</span>', isNum(gM.abs) ? esc((gM.abs >= 0 ? "+" : "−") + won(Math.abs(gM.abs))) : '<span class="mini">—</span>', chip(gM), esc(p1(c.mainShare) || "—"), chip(m.growth(B, y, "mainShare"), "pp")]; });
    h += '<div class="card-h" style="margin-top:6px"><h2>연도별 매출 비교표</h2></div>' + simpleTable(["연도", "전체 매출", "증감액", "증감률", "메인자재", "증감액", "증감률", "메인 비중", "비중 증감"], rows);
    h += '<div class="ks-tools"><span class="mini">상세: ' + esc(Y) + "년 거래처별 매출 증감(" + esc(ymLabel(m)) + ")</span>" + (m.restricted ? '<span class="gw-tr na">거래처별 목록 비공개</span>' : toggleBtn("sales", "거래처 상세 접기", "거래처별 매출 증감·구매 업체 펼치기")) + "</div>";
    if (m.restricted) h += restrictedNote("거래처별 매출 증감·구매 업체 목록은 업체명과 거래 금액이 포함되어 공개 보기에서 제공하지 않습니다"); else if (Gs.open.sales) h += '<div id="gw-det-sales">' + salesDetail(m) + "</div>";
    return h + "</div>";
  }
  function measureOf(r, fam) { if (fam === "all") return [r.당기, r.전기]; if (fam === "main") return [r.메인당기, r.메인전기]; return [r.famNow ? r.famNow[fam] : 0, r.famPrev ? r.famPrev[fam] : 0]; }
  function salesDetail(m) {
    var B = Gs.basis, Y = Gs.year, P = m.prevOf(Y); if (!P) return '<div class="ks-warn">비교할 전년 자료가 없습니다.</div>'; if (B === "ann" && Y === m.lastY) return '<div class="ks-warn">연중 누계(' + esc(m.endMD.replace("-", "/")) + "까지)는 전년 연간과 비교할 수 없습니다. 위의 \'동일기간\' 보기를 선택하세요.</div>";
    var rows = m.vendorSales(B, Y, P); if (!rows) return '<div class="loading">판매 원문 읽는 중… 원문이 준비되면 거래처별 증감이 표시됩니다.</div>';
    var fam = Gs.fam, blockFam = (fam !== "all" && (!m.mainOK(Y) || !m.mainOK(P))) ? "메인자재 값 미확인 연도가 포함되어 비교할 수 없습니다" : null;
    var q = Gs.q.toLowerCase(); var data = rows.map(function (r) { var mm = measureOf(r, fam); return { 통합ID: r.통합ID, 업체: r.업체, 당기: mm[0], 전기: mm[1], 증감액: mm[0] - mm[1], 증감률: mm[1] > 0 ? (mm[0] - mm[1]) / mm[1] : null, 낙찰당기: r.낙찰당기, 낙찰이력: r.낙찰이력, 구분: mm[1] <= 0 && mm[0] > 0 ? "신규 구매" : mm[0] <= 0 && mm[1] > 0 ? "구매 중단" : "" }; }).filter(function (r) { return r.당기 !== 0 || r.전기 !== 0; });
    var vf = Gs.vfilter; data = data.filter(function (r) { return (vf === "all" || (vf === "award" && r.낙찰이력) || (vf === "new" && r.구분 === "신규 구매") || (vf === "stop" && r.구분 === "구매 중단")) && (!q || (r.업체 + " " + r.통합ID).toLowerCase().indexOf(q) >= 0); }).sort(function (a, b) { return b.증감액 - a.증감액; });
    var tot = { c: 0, p: 0 }; data.forEach(function (r) { tot.c += r.당기; tot.p += r.전기; });
    var h = '<div class="ks-chips">' + [["all", "전체 자재"], ["main", "메인 전체"], ["재도장", "페인트"], ["우레탄", "우레탄"], ["에폭시", "에폭시"]].map(function (x) { return '<button data-kact="gfam" data-id="' + x[0] + '"' + (fam === x[0] ? ' aria-current="true"' : "") + ">" + x[1] + "</button>"; }).join("") + "</div>";
    h += '<div class="ks-chips">' + [["all", "모든 거래처"], ["award", "낙찰 이력 있음"], ["new", "신규 구매"], ["stop", "구매 중단"]].map(function (x) { return '<button data-kact="gvf" data-id="' + x[0] + '"' + (vf === x[0] ? ' aria-current="true"' : "") + ">" + x[1] + "</button>"; }).join("") + '<button class="btn ghost" data-kact="gcsv" data-id="sales">엑셀(CSV)</button></div>';
    if (blockFam) return h + '<div class="ks-warn">' + esc(blockFam) + "</div>";
    h += '<div class="gw-note">' + esc(Y) + "년 " + num(data.length) + "곳 · 당기 " + esc(won(tot.c) || "—") + " / 전기 " + esc(won(tot.p) || "—") + ' · 증감 합 ' + esc((tot.c - tot.p >= 0 ? "+" : "−") + won(Math.abs(tot.c - tot.p))) + " · 금액은 자재(비자재·용역 제외) 순매출</div>";
    h += gtable("gsa", [{ k: "업체", l: "거래처", raw: 1, f: function (r) { return vlink(r.통합ID, r.업체); } }, { k: "당기", l: Y + "년", r: 1, fmt: function (v) { return won(v); } }, { k: "전기", l: P + "년", r: 1, fmt: function (v) { return won(v); } }, { k: "증감액", r: 1, fmt: function (v) { return (v >= 0 ? "+" : "−") + won(Math.abs(v)); } }, { k: "증감률", r: 1, fmt: function (v) { return (v >= 0 ? "+" : "−") + (Math.abs(v) * 100).toFixed(1) + "%"; } }, { k: "구분", raw: 1, f: function (r) { return r.구분 ? '<span class="st ' + (r.구분 === "신규 구매" ? "ok" : "bad") + '">' + r.구분 + "</span>" : ""; } }, { k: "낙찰이력", l: "POUR 낙찰 이력", raw: 1, f: function (r) { return r.낙찰이력 ? '<span class="st rev">낙찰 이력(연결 후보)</span>' : '<span class="mini">—</span>'; } }], data, { per: 12 });
    return h;
  }

  /* ---------- ③ 낙찰 시공사 → 구매 연결 ---------- */
  function secCohort(m) {
    var B = Gs.basis, Y = Gs.year, ys = m.years, M = {}; ys.forEach(function (y) { M[y] = m.metrics(B, y); });
    var ready = ys.every(function (y) { return !!M[y].cohort; });
    var h = '<div class="card" id="gw-cohort"><div class="card-h"><h2>③ POUR 낙찰 시공사 → 자재 구매 연결 분석</h2><span class="badge">' + esc(ymLabel(m)) + "</span>" + tr("cand", "사업자번호로 법인이 확정되지 않아 이름 일치 기준의 '연결 후보'") + '<span class="mini">시공사 기준 구매 연결(같은 시공사가 자재를 산 사실) ≠ 현장 기준 사용 확인(해당 현장에 썼다는 증빙) · 구매 기록이 없어도 타사 자재 사용으로 단정하지 않음</span></div>';
    if (!ready && B === "ytd") h += '<div class="loading">판매 원문 읽는 중… 동일기간 구매 연결은 원문 거래일자가 필요합니다.</div>';
    var co = function (y) { return M[y].cohort; };
    var ch1 = barChart({ title: "낙찰 시공사와 구매 업체 수", cats: ys, catLabel: function (y) { return yl(m, y); }, sel: Y, click: { act: "gyear", sec: "cohort" }, series: [{ name: "낙찰 시공사", cls: "c1", vals: ys.map(function (y) { return M[y].awardVendors; }), fmt: cnt }, { name: "구매 확인", cls: "c2", vals: ys.map(function (y) { return co(y) ? co(y).buyN : null; }), na: ys.map(function (y) { return co(y) ? null : "원문 읽는 중"; }), fmt: cnt }, { name: "메인 구매", cls: "c3", vals: ys.map(function (y) { return co(y) ? co(y).mainBuyN : null; }), na: ys.map(function (y) { return co(y) ? (co(y).mainWhy || null) : "원문 읽는 중"; }), fmt: cnt }] });
    var ch2 = lineChart({ title: "구매 연결률 추이", cats: ys, sel: Y, click: { act: "gyear", sec: "cohort" }, series: [{ name: L("buyRate"), cls: "c2", vals: ys.map(function (y) { return co(y) ? co(y).buyRate : null; }) }, { name: L("mainRate"), cls: "c3", vals: ys.map(function (y) { return co(y) ? co(y).mainRate : null; }) }] });
    h += '<div class="gw-grid">' + chartBox("낙찰 업체 vs 구매 업체", "곳 · 빗금 = 미확인", ch1, legend([["c1", "낙찰 시공사"], ["c2", "구매 확인(자재)"], ["c3", "메인 구매"]])) +
      chartBox("구매 연결률", "연결 후보 기준", ch2, legend([["c2", L("buyRate")], ["c3", L("mainRate")]]) + '<div class="gw-yl">구매 연결률 전년 대비(%p)</div>' + yoyRow(m, "buyRate", "pp") + '<div class="gw-yl">메인자재 연결률 전년 대비(%p)</div>' + yoyRow(m, "mainRate", "pp")) + "</div>";
    var rows = ys.map(function (y) { var c = co(y); return [esc(yl(m, y)), esc(cnt(M[y].awardVendors) || "—"), c ? esc(c.buyN + "곳") : '<span class="mini">대기</span>', c ? esc(p1(c.buyRate) || "—") : "", c ? chip(m.growth(B, y, "buyRate"), "pp") : "", c ? (c.mainBuyN == null ? '<span class="mini">미확인</span>' : esc(c.mainBuyN + "곳 · " + p1(c.mainRate))) : "", c ? esc(won(c.buyAmt) || "—") : "", c && c.mainAmt != null ? esc(won(c.mainAmt)) : '<span class="mini">—</span>']; });
    h += '<div class="card-h" style="margin-top:6px"><h2>연도별 연결 비교표</h2></div>' + simpleTable(["연도", "낙찰 시공사", "구매 확인", "연결률", "전년 대비", "메인 구매(비율)", "자재 구매액", "메인 구매액"], rows);
    h += '<p class="gw-note">낙찰 시공사 수는 통합ID 기준 중복 제거 값입니다(㈜/(주) 등 표기 차이를 한 업체로 합침). 기존 KPI 카드의 \'낙찰 시공사 수\'는 표기 기준이라 값이 다를 수 있습니다 — 아래 [데이터 신뢰도]에서 대조합니다.</p>';
    h += '<div class="ks-tools"><span class="mini">상세: ' + esc(Y) + "년 낙찰 시공사별 구매 연결</span>" + (m.restricted ? '<span class="gw-tr na">시공사별 목록 비공개</span>' : toggleBtn("cohort", "연결 상세 접기", "낙찰 시공사별 구매 연결 상세 펼치기")) + "</div>";
    if (m.restricted) h += restrictedNote("낙찰 시공사별 구매 연결 상세는 업체명이 포함되어 공개 보기에서 제공하지 않습니다 — 위 표의 연도별 집계(곳 수·비율·금액)만 공개합니다"); else if (Gs.open.cohort) h += '<div id="gw-det-cohort">' + cohortDetail(m) + "</div>";
    return h + "</div>";
  }
  function cohortDetail(m) {
    var rows = m.cohortRows(Gs.basis, Gs.year), q = Gs.q.toLowerCase(), cf = Gs.cfilter;
    if (rows.some(function (r) { return r.구매확인 === null; })) return '<div class="loading">판매 원문 읽는 중…</div>';
    rows = rows.filter(function (r) { return (cf === "all" || (cf === "need" && r.구매확인 === false) || (cf === "main" && r.메인구매 === true) || (cf === "nomain" && r.구매확인 === true && r.메인구매 === false)) && (!q || (r.업체 + " " + r.통합ID).toLowerCase().indexOf(q) >= 0); }).sort(function (a, b) { return (b.구매금액 || 0) - (a.구매금액 || 0) || b.낙찰건수 - a.낙찰건수; });
    var h = '<div class="ks-chips">' + [["all", "전체"], ["need", "구매 확인 필요"], ["main", "메인 구매"], ["nomain", "자재만 구매(메인 아님)"]].map(function (x) { return '<button data-kact="gcf" data-id="' + x[0] + '"' + (cf === x[0] ? ' aria-current="true"' : "") + ">" + x[1] + "</button>"; }).join("") + '<button class="btn ghost" data-kact="gcsv" data-id="cohort">엑셀(CSV)</button></div>';
    h += gtable("gco", [{ k: "업체", l: "낙찰 시공사", raw: 1, f: function (r) { return vlink(r.통합ID, r.업체); } }, { k: "낙찰건수", r: 1, fmt: num }, { k: "낙찰금액", r: 1, fmt: function (v) { return won(v); } }, { k: "구매금액", l: "자재 구매액", r: 1, fmt: function (v) { return won(v); } }, { k: "메인금액", l: "메인 구매액", r: 1, fmt: function (v) { return won(v); } }, { k: "최근구매일", l: "최근 구매일" }, { k: "구매", l: "구매 확인", raw: 1, f: function (r) { return r.구매확인 ? '<span class="st ok">구매 확인</span>' : '<span class="st rev">확인 필요</span>'; } }, { k: "연결", l: "연결 등급", raw: 1, f: function (r) { return '<span title="' + esc(r.연결메모) + '">' + stChip(r.연결코드, r.연결) + "</span>"; } }], rows, { per: 12 });
    return h;
  }

  /* ---------- 질문 · 기여/확인 필요 ---------- */
  function ans(code, head, body) { return '<div class="gw-ans"><span class="gw-a ' + code + '">' + esc(head) + "</span> " + body + "</div>"; }
  function questions(m) {
    var B = Gs.basis, Y = Gs.year, P = m.prevOf(Y), c = m.metrics(B, Y), p = P ? m.metrics(B, P) : null;
    var gN = m.growth(B, Y, "notices"), gR = m.growth(B, Y, "ratio"), gW = m.growth(B, Y, "awards"), gB = m.growth(B, Y, "buyRate"), gMR = m.growth(B, Y, "mainRate"), gS = m.growth(B, Y, "sales"), gM = m.growth(B, Y, "main");
    var q1, q2, q3;
    if (gN.state !== "ok" || gR.state !== "ok") q1 = ans("na", "판단 불가", esc(gN.why || gR.why || ""));
    else if (gN.pct > 0 && gR.pp < 0) q1 = ans("dn", "예", "공고는 " + sgn(gN.pct * 100) + "% 늘었지만 낙찰/공고 비율은 " + esc(p1(p.awardRatio)) + " → " + esc(p1(c.awardRatio)) + " (" + sgn(gR.pp) + "%p)로 낮아졌습니다.");
    else if (gN.pct > 0) q1 = ans("up", "아니오", "공고가 " + sgn(gN.pct * 100) + "% 늘었고 낙찰/공고 비율은 " + esc(p1(p.awardRatio)) + " → " + esc(p1(c.awardRatio)) + " (" + sgn(gR.pp) + "%p)로 유지·상승했습니다.");
    else q1 = ans("fl", "해당 없음", "공고가 늘지 않았습니다(" + sgn(gN.pct * 100) + "%).");
    if (gW.state !== "ok" || gB.state !== "ok") q2 = ans("na", "판단 불가", esc(gW.why || gB.why || "판매 원문을 읽는 중입니다"));
    else { var mainTxt = gMR.state === "ok" ? " 메인자재 구매 연결률은 " + sgn(gMR.pp) + "%p." : " 메인자재 연결률: 비교 불가(" + esc(gMR.why || "") + ")."; var cc = c.cohort, pc = p.cohort;
      if (gW.pct > 0 && gB.pp < 0) q2 = ans("dn", "예", "낙찰은 " + sgn(gW.pct * 100) + "% 늘었지만 구매 연결률은 " + esc(p1(pc.buyRate)) + " → " + esc(p1(cc.buyRate)) + " (" + sgn(gB.pp) + "%p)로 낮아졌습니다." + mainTxt + " (연결 후보 기준)");
      else if (gW.pct > 0) q2 = ans("up", "아니오", "낙찰이 " + sgn(gW.pct * 100) + "% 늘었고 구매 연결률은 " + esc(p1(pc.buyRate)) + " → " + esc(p1(cc.buyRate)) + " (" + sgn(gB.pp) + "%p)입니다." + mainTxt + " (연결 후보 기준)");
      else q2 = ans("fl", "해당 없음", "낙찰이 늘지 않았습니다(" + sgn(gW.pct * 100) + "%)."); }
    if (gS.state !== "ok" || gM.state !== "ok") q3 = ans("na", "판단 불가", "전체 매출: " + (gS.state === "ok" ? sgn(gS.pct * 100) + "%" : "비교 불가") + " · 메인자재: " + (gM.state === "ok" ? sgn(gM.pct * 100) + "%" : "비교 불가(" + esc(gM.why || "") + ")"));
    else q3 = gM.pct > gS.pct ? ans("up", "예", "메인자재 매출 " + sgn(gM.pct * 100) + "%가 전체 자재 매출 " + sgn(gS.pct * 100) + "%보다 빠르게 늘었습니다(메인 비중 " + esc(p1(p.mainShare)) + " → " + esc(p1(c.mainShare)) + ").") : ans("dn", "아니오", "메인자재 매출 " + sgn(gM.pct * 100) + "%는 전체 자재 매출 " + sgn(gS.pct * 100) + "%보다 느리거나 같습니다.");
    var h = '<div class="card" id="gw-q"><div class="card-h"><h2>질문 답변</h2><span class="badge">' + esc(Y) + "년 " + esc(ymLabel(m)) + (P ? " vs " + esc(P) + "년" : "") + '</span><span class="mini">위 보기(동일기간/연간·연도)를 바꾸면 답이 함께 바뀝니다</span></div>';
    h += '<div class="gw-qa"><div class="q">공고는 증가했지만 낙찰 비율은 감소했는가?</div>' + q1 + '</div><div class="gw-qa"><div class="q">낙찰은 증가했지만 우리 자재 구매 연결률은 감소했는가?</div>' + q2 + '</div><div class="gw-qa"><div class="q">전체 매출 증가보다 메인자재 매출 증가가 더 빠른가?</div>' + q3 + "</div></div>";
    return h;
  }
  function restrictedNote(t) { return '<div class="gw-note gw-priv"><span class="gw-tr na">비공개</span> ' + esc(t) + '. 시트를 공유받은 직원은 <a class="vlink" data-kact="view" data-id="link">상세 보기(로그인)</a>에서 확인합니다.</div>'; }
  function pubTradeBlock(m) {
    var B = Gs.basis, Y = Gs.year, P = m.prevOf(Y), cur = m.trades(B, Y) || {}, prev = P ? (m.trades(B, P) || {}) : null;
    var block = !P ? "비교할 전년 자료 없음" : (B === "ann" && Y === m.lastY ? "연중 누계라 전년 연간과 비교하지 않음 — '동일기간' 보기를 사용하세요" : null);
    var names = Object.keys(cur).concat(prev ? Object.keys(prev) : []).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var tot = 0; names.forEach(function (k) { tot += cur[k] ? cur[k].n : 0; });
    names.sort(function (a, b) { return ((cur[b] || { n: 0 }).n) - ((cur[a] || { n: 0 }).n); });
    var rows = names.map(function (k) { var c = cur[k] || { n: 0, amt: 0, amtN: 0 }, p = prev && prev[k] ? prev[k] : { n: 0 }; var d = block ? null : c.n - p.n;
      return [esc(k), esc(String(c.n)), esc(tot ? (c.n / tot * 100).toFixed(1) + "%" : "—"), c.amtN ? esc(won(c.amt) || "—") : '<span class="mini">금액 미기재</span>', block ? '<span class="mini">비교 불가</span>' : esc(String(p.n)), d == null ? '<span class="mini">—</span>' : '<span class="gw-d ' + (d > 0 ? "up" : d < 0 ? "dn" : "fl") + '">' + (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d) + "건</span>"]; });
    var h = '<div class="card-h" style="margin-top:6px"><h2>공종별 낙찰 집계 · ' + esc(Y) + "년 " + esc(ymLabel(m)) + '</h2><span class="mini">공종그룹 기준 건수·금액만 공개 (시공사·현장 목록은 비공개)</span></div>';
    h += simpleTable(["공종", "낙찰(건)", "비중", "낙찰금액", P ? esc(P) + "년 건수" : "전년", "건수 증감"], rows.length ? rows : [['<span class="mini">집계 없음</span>', "", "", "", "", ""]]);
    return h + (block ? '<p class="gw-note">' + esc(block) + "</p>" : "") + restrictedNote("시공사·현장별 낙찰 목록은 업체명이 포함되어 공개 보기에서 제공하지 않습니다");
  }
  function pubWho(m) {
    var B = Gs.basis, Y = Gs.year, c = m.metrics(B, Y), co = c && c.cohort;
    var h = '<div class="card" id="gw-who"><div class="two"><div><div class="card-h"><h2>어떤 시공사가 매출 성장에 기여했는가?</h2></div>' + restrictedNote("시공사별 매출 증감·기여도는 업체명과 거래 금액이 포함되어 공개 보기에서 제공하지 않습니다") + "</div>";
    h += '<div><div class="card-h"><h2>낙찰 이력은 있지만 구매 확인이 필요한 업체는?</h2></div>';
    if (!co) h += '<div class="ks-warn">해당 기간 집계값이 없습니다(데이터 부족)</div>';
    else h += '<div class="gw-note">' + esc(Y) + "년 " + esc(ymLabel(m)) + " 낙찰 시공사 " + num(co.n) + "곳 중 같은 기간 자재 구매가 확인되지 않은 곳은 <b>" + num(co.n - co.buyN) + "곳</b>입니다. <b>구매 기록이 없다고 타사 자재를 썼다는 뜻이 아닙니다</b>(판매 원천에서 이름이 일치하는 거래처를 찾지 못했거나 구매가 없는 것)</div>" + restrictedNote("해당 업체 명단은 공개 보기에서 제공하지 않습니다");
    return h + "</div></div></div>";
  }
  function who(m) {
    if (m.restricted) return pubWho(m);
    var B = Gs.basis, Y = Gs.year, P = m.prevOf(Y);
    var h = '<div class="card" id="gw-who"><div class="two">';
    h += '<div><div class="card-h"><h2>어떤 시공사가 매출 성장에 기여했는가?</h2></div>';
    if (!P || (B === "ann" && Y === m.lastY)) h += '<div class="ks-warn">연중 누계는 전년 연간과 비교할 수 없어 기여도를 계산하지 않습니다. \'동일기간\' 보기를 선택하세요.</div>';
    else { var co = m.contributors(B, Y, P, false); if (!co) h += '<div class="loading">판매 원문 읽는 중…</div>'; else { var top = co.rows.slice(0, 8); h += '<div class="gw-note">' + esc(P) + "년 대비 자재 매출 증가가 큰 업체 · 전체 증감 " + esc((co.totalDelta >= 0 ? "+" : "−") + won(Math.abs(co.totalDelta))) + " · POUR 낙찰 이력이 있으면 표시(연결 후보)</div>";
      h += gtable("gwho", [{ k: "업체", raw: 1, f: function (r) { return vlink(r.통합ID, r.업체); } }, { k: "증감액", r: 1, fmt: function (v) { return "+" + won(v); } }, { k: "기여", l: "증가분 중", r: 1, f: function (r) { return co.totalDelta > 0 ? (r.증감액 / co.totalDelta * 100).toFixed(1) + "%" : null; } }, { k: "낙찰이력", l: "POUR 낙찰", raw: 1, f: function (r) { return r.낙찰이력 ? '<span class="st rev">이력 있음</span>' : '<span class="mini">—</span>'; } }], top, { per: 8 }); } }
    h += "</div>";
    h += '<div><div class="card-h"><h2>낙찰 이력은 있지만 구매 확인이 필요한 업체는?</h2></div>';
    var nc = m.needCheck(B, Y); if (nc.some(function (r) { return r.구매확인 === null; })) h += '<div class="loading">판매 원문 읽는 중…</div>';
    else { h += '<div class="gw-note">' + esc(Y) + "년 " + esc(ymLabel(m)) + " 낙찰 시공사 중 같은 기간 자재 구매가 확인되지 않은 " + nc.length + "곳 · <b>구매 기록이 없다고 타사 자재를 썼다는 뜻이 아닙니다</b>(판매 원천에서 이름이 일치하는 거래처를 찾지 못했거나 구매가 없는 것)</div>";
      h += gtable("gnc", [{ k: "업체", raw: 1, f: function (r) { return vlink(r.통합ID, r.업체); } }, { k: "낙찰건수", r: 1, fmt: num }, { k: "낙찰금액", r: 1, fmt: function (v) { return won(v); } }, { k: "연결", l: "연결 등급", raw: 1, f: function (r) { return '<span title="' + esc(r.연결메모) + '">' + stChip(r.연결코드, r.연결) + "</span>"; } }], nc, { per: 8, empty: "구매 확인이 필요한 업체가 없습니다" }); }
    return h + "</div></div></div>";
  }

  /* ---------- 데이터 신뢰도 · 대조 ---------- */
  function coverage(m) {
    var h = '<div class="card" id="gw-cov"><div class="card-h"><h2>데이터 신뢰도 · 기간별 누락·비교 불가</h2><span class="mini">' + tr("ok") + " " + tr("cand") + " " + tr("short") + " " + tr("na") + ' — 데이터가 없는 항목은 0으로 채우지 않고 사유를 표시합니다</span></div>';
    h += '<ul class="gw-cov">' + m.coverage().map(function (c) { return "<li><b>" + esc(c.t) + "</b> " + esc(c.d) + "</li>"; }).join("") + "</ul>";
    var rec = m.reconcile(), bad = rec.filter(function (r) { return r.결과 === "불일치"; }), okn = rec.filter(function (r) { return r.결과 === "일치"; }).length;
    h += '<div class="ks-tools"><span class="chk ' + (bad.length ? "bad" : "ok") + '" style="display:inline-flex;font-size:12px;font-weight:800;padding:5px 10px;border-radius:100px;background:' + (bad.length ? "#FDF2F1" : "#ECFDF3") + ";color:" + (bad.length ? "var(--bad)" : "#166534") + '">기존 KPI 대조: 일치 ' + okn + " · 불일치 " + bad.length + "</span>" + toggleBtn("rec", "대조표 접기", "대조표 펼치기") + "</div>";
    if (Gs.open.rec) h += gtable("grec", [{ k: "연도" }, { k: "항목", wrap: 1 }, { k: "새집계", l: "새 집계", r: 1, fmt: function (v) { return isNum(v) ? v.toLocaleString("ko-KR") : String(v); } }, { k: "KPI", l: "기존 KPI", r: 1, fmt: function (v) { return isNum(v) ? v.toLocaleString("ko-KR") : String(v); } }, { k: "결과", raw: 1, f: function (r) { return '<span class="st ' + (r.결과 === "일치" ? "ok" : r.결과 === "불일치" ? "bad" : "na") + '">' + r.결과 + "</span>"; } }], rec.slice().sort(function (a, b) { return (a.결과 === "불일치" ? 0 : 1) - (b.결과 === "불일치" ? 0 : 1); }), { per: 14 });
    var an = 0; m.years.forEach(function (y) { var c = m.metrics("ann", y); if (c.awardNames !== c.awardVendors) an++; });
    h += '<p class="gw-note">낙찰 시공사 수: 기존 KPI 카드는 표기 기준(㈜X와 (주)X를 둘로 셈), 이 화면은 통합ID 기준 중복 제거입니다. ' + m.years.map(function (y) { var c = m.metrics("ann", y); return y + "년 " + c.awardNames + "→" + c.awardVendors; }).join(" · ") + " (연간).</p>";
    return h + "</div>";
  }

  /* ---------- 지표 정의 · 변경 이력 ---------- */
  function defsCard(m) {
    var d = defs(), dr = Gs.draft || {}; var ruleLines = (d.famRules || GC.DEFAULT_FAM_RULES).map(function (r) { return r.fam + "=" + r.re; }).join("\n");
    var h = '<div class="card" id="gw-def"><div class="card-h"><h2>지표 정의 · 계산 기준</h2><span class="badge">정의 v' + d.version + "</span><span class=\"mini\">지표 이름·비교 기간·메인자재 분류 규칙을 바꾸면 이력이 남고, 원본 시트 데이터는 바뀌지 않습니다</span>" + toggleBtn("def", "접기", "열기") + "</div>";
    if (!Gs.open.def) return h + "</div>";
    if (m.restricted) h += '<div class="gw-note gw-priv"><b>공개 보기:</b> 지표 이름과 기본 보기(동일기간/연간)는 이 브라우저에서 바꿀 수 있고 변경 이력이 남습니다. 비교 기간 종료일과 메인자재 분류 규칙은 서버 집계 기준(기본 정의)으로 고정되어 여기서 바꿀 수 없습니다 — 바꾸려면 상세 보기(로그인)에서 원문으로 다시 계산하거나, 서버 정의를 변경해야 합니다.' + ((STORE.over && (STORE.over.endMD || (STORE.over.famRules && STORE.over.famRules.length))) ? " 이 브라우저에 저장된 종료일·분류 규칙은 상세 보기에서만 적용됩니다." : "") + "</div>";
    h += '<div class="gw-defs">' + Object.keys(DEF_LABELS).map(function (k) { return '<div class="gr"><label for="gd-l-' + k + '">' + esc(DEF_LABELS[k]) + ' <span class="mini">(' + k + ')</span></label><input id="gd-l-' + k + '" data-kact="gdin" value="' + esc(dr["l-" + k] != null ? dr["l-" + k] : d.labels[k]) + '"><div class="mini">' + esc(RULE_TEXT[k]) + "</div></div>"; }).join("") + "</div>";
    h += '<div class="gw-defs"><div class="gr"><label for="gd-end">비교 기간 종료일(월-일)</label><input id="gd-end" data-kact="gdin"' + (m.restricted ? " disabled" : "") + ' placeholder="비움 = 시트 기준(' + esc(m.endMD) + ')" value="' + esc(dr.end != null ? dr.end : (d.endMD || "")) + '"><div class="mini">동일기간 비교의 끝 날짜입니다(예 10-20). 비우면 1.통합KPI 의 기준일을 따릅니다.</div></div>';
    h += '<div class="gr"><label for="gd-basis">기본 보기</label><select id="gd-basis" data-kact="gdin"><option value="ytd"' + ((dr.basis || d.basis) === "ytd" ? " selected" : "") + '>동일기간</option><option value="ann"' + ((dr.basis || d.basis) === "ann" ? " selected" : "") + '>연간</option></select></div>';
    h += '<div class="gr"><label for="gd-fam">메인자재 품목군 분류 규칙</label><textarea id="gd-fam" data-kact="gdin" rows="4"' + (m.restricted ? " disabled" : "") + '>' + esc(dr.fam != null ? dr.fam : ruleLines) + '</textarea><div class="mini">한 줄에 "품목군=정규식"(위에서부터 처음 맞는 규칙). 품목군은 재도장·우레탄·에폭시. 연간 합계가 1.통합KPI 메인 매출과 다르면 아래 대조에서 불일치로 표시됩니다.</div></div>';
    h += '<div class="gr"><label for="gd-why">변경 사유 (필수)</label><input id="gd-why" data-kact="gdin" placeholder="예: 팀장 회의(2026-11-03) 결과 반영" value="' + esc(dr.why || "") + '"></div></div>';
    h += '<div class="ks-tools"><button class="btn" data-kact="gdsave">변경 저장</button><button class="btn ghost" data-kact="gdreset">기본값으로 복원</button></div>';
    if (Gs.msg) h += '<div class="gw-msg ' + Gs.msg.cls + '">' + esc(Gs.msg.t) + "</div>";
    h += '<div class="card-h" style="margin-top:8px"><h2>변경 이력</h2><span class="mini">이 브라우저에 저장 · 팀 공용 이력은 시트 \'20.KPI정의\' 탭 도입 시 이관(확장 구조 설계안)</span></div>';
    var hist = STORE.hist.slice().reverse().map(function (x) { return { v: "v" + x.v, at: A.hhmm(x.at), reason: x.reason, ch: (x.changes || []).map(function (c) { return c.k + ": " + c.from + " → " + c.to; }).join(" / ") }; });
    h += gtable("ghist", [{ k: "v", l: "버전" }, { k: "at", l: "일시" }, { k: "reason", l: "사유", wrap: 1 }, { k: "ch", l: "변경 내용", wrap: 1 }], hist, { per: 6, empty: "변경 이력이 없습니다(기본 정의 v1)" });
    return h + "</div>";
  }
  function readDefsForm() {
    var g = function (id) { var el = document.getElementById(id); return el ? el.value : null; }, d = defs(), over = JSON.parse(JSON.stringify(STORE.over || {})); over.labels = over.labels || {};
    var errs = [], changes = [];
    Object.keys(DEF_LABELS).forEach(function (k) { var v = g("gd-l-" + k); if (v == null) return; v = v.trim(); if (!v) { errs.push("지표 이름은 비울 수 없습니다(" + k + ")"); return; } if (v !== d.labels[k]) { changes.push({ k: "이름 " + k, from: d.labels[k], to: v }); } if (v === DEF_LABELS[k]) delete over.labels[k]; else over.labels[k] = v; });
    var end = (g("gd-end") || "").trim(); if (end && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(end)) errs.push("비교 기간 종료일은 MM-DD 형식이어야 합니다(예 10-20)"); else { if ((end || null) !== (d.endMD || null)) changes.push({ k: "비교 기간 종료일", from: d.endMD || "자동", to: end || "자동" }); if (end) over.endMD = end; else delete over.endMD; }
    var basis = g("gd-basis"); if (basis && basis !== d.basis) { changes.push({ k: "기본 보기", from: d.basis === "ytd" ? "동일기간" : "연간", to: basis === "ytd" ? "동일기간" : "연간" }); } over.basis = basis || d.basis;
    var fam = g("gd-fam"); if (fam != null) { var rules = [], ok = true; fam.split(/\n/).forEach(function (ln) { ln = ln.trim(); if (!ln) return; var i = ln.indexOf("="); var f = ln.slice(0, i).trim(), re = ln.slice(i + 1).trim(); if (i < 0 || GC.FAMS.indexOf(f) < 0 || !re) { errs.push("분류 규칙 형식 오류: " + ln); ok = false; return; } try { new RegExp(re); } catch (e) { errs.push("정규식 오류: " + ln); ok = false; return; } rules.push({ fam: f, re: re }); });
      if (ok && rules.length) { var cur = JSON.stringify(d.famRules || GC.DEFAULT_FAM_RULES), nw = JSON.stringify(rules); if (cur !== nw) changes.push({ k: "메인자재 분류 규칙", from: (d.famRules || GC.DEFAULT_FAM_RULES).map(function (r) { return r.fam + "=" + r.re; }).join(", "), to: rules.map(function (r) { return r.fam + "=" + r.re; }).join(", ") }); if (nw === JSON.stringify(GC.DEFAULT_FAM_RULES)) delete over.famRules; else over.famRules = rules; } else if (ok) errs.push("분류 규칙이 비어 있습니다"); }
    return { over: over, changes: changes, errs: errs, why: (g("gd-why") || "").trim() };
  }

  /* ---------- 시공사별 활동 타임라인 (공식 분석 시작일 2026-06-01 이후) ---------- */
  var ANALYSIS_START = "2026-06-01";
  var TL_SRC = [["7.기술자문문의", "접수일자", "협력사명", "L3", "기술자문 문의", "현장명", "주소"], ["8.컨설팅요청", "등록일자", "업체", "L3", "컨설팅내역서 요청", "현장명", "주소"], ["10.공법설명회이력", "등록일", "시공사", "L3", "공법설명회(PT)", "현장명", "주소"], ["11.기타문의답변", "등록일", "업체명", "L3", "기타 문의", null, null], ["9.샘플카탈로그요청", "접수일시", "업체", "참고", "샘플·카탈로그 요청(L3 분류 미확정)", null, "주소"]];
  function tlNorm(x) { return String(x == null ? "" : x).replace(/[\s·.,()\[\]]/g, "").toLowerCase(); }
  function vendorTimeline(id, v) {
    var ev = [], pre = 0;
    var mou = v.master && v.master["협약일"] ? String(v.master["협약일"]).slice(0, 10) : "";
    TL_SRC.forEach(function (d) { A.objs(d[0]).forEach(function (r) { if (r["통합ID"] !== id) return; var dt = String(r[d[1]] == null ? "" : r[d[1]]).slice(0, 10); if (!dt) return; if (dt < ANALYSIS_START) { pre++; return; } ev.push({ dt: dt, stage: d[3], type: d[4], site: d[5] ? r[d[5]] || "" : "", addr: d[6] ? r[d[6]] || "" : "" }); }); });
    var l3 = ev.filter(function (e) { return e.stage === "L3"; }).sort(function (a, b) { return a.dt.localeCompare(b.dt); });
    A.objs("5.POUR공고낙찰").forEach(function (r) { if (r["통합ID"] !== id) return; var dt = String(r["공고일"] || "").slice(0, 10); if (!dt || dt < ANALYSIS_START) return; ev.push({ dt: dt, stage: "L4", type: "POUR 낙찰(공고일 기준)", site: r["현장명"] || "", addr: r["주소"] || "" }); });
    ev.sort(function (a, b) { return a.dt.localeCompare(b.dt); });
    var sites = {}, order = []; l3.forEach(function (e) { var k = e.addr ? tlNorm(e.addr) : e.site ? "n:" + tlNorm(e.site) : ""; if (!k) return; if (!sites[k]) { sites[k] = { name: e.site || e.addr, first: e.dt, n: 0, byAddr: !!e.addr }; order.push(k); } sites[k].n++; });
    var notices = A.objs("5b.POUR반영공고").concat(A.objs("5.POUR공고낙찰"));
    order.forEach(function (k) { var st = sites[k], nn = tlNorm(st.name), cand = notices.filter(function (r) { var dt = String(r["공고일"] || "").slice(0, 10); return dt && dt >= st.first && nn && tlNorm(r["현장명"]) === nn; }); st.next = cand.length ? "공고 후보 " + cand.length + "건(현장명 일치·검토)" : ""; });
    var h = '<div class="card-h" style="margin-top:12px"><h2>시공사 활동 흐름 (' + ANALYSIS_START + ' 이후)</h2><span class="mini">날짜 기준: 협약일 · 활동일(접수·등록일) · 공고일 · 거래일 / 운영 시트 원천만 사용</span></div>';
    h += '<div class="kv"><span>협약일(마스터)</span><span>' + (mou ? esc(mou) + (mou >= ANALYSIS_START ? ' <span class="st ok">분석 기간 내 협약 — 신규 판정 대상</span>' : ' <span class="st na">분석 시작일 이전 협약 — 신규 판정은 협약 후 1년 이내 관측분만 참고</span>') : '<span class="st na">협약일 없음</span> 신규·기존을 임의로 판정하지 않음(미확인)') + "</span><span>영업보고(L2)</span><span><span class=\"st na\">원천 없음</span> 영업보고 자료가 연결되면 표시 — L2 경유/L3 직접 진입은 현재 구분 불가</span><span>L3 활동(기간 내)</span><span>" + l3.length + "건 · 현장 " + order.length + "곳" + (pre ? ' <span class="mini">(분석 시작일 이전 ' + pre + "건은 보존)</span>" : "") + "</span><span>현장 재사용</span><span>" + (order.length >= 2 ? '<span class="st ok">기간 내 다른 현장 ' + (order.length - 1) + "곳에서 재이용</span>" : order.length === 1 ? '<span class="st na">관측된 현장 1곳</span>' : '<span class="st na">L3 기록 없음</span>') + '</span></div>';
    h += '<div class="card-h" style="margin-top:8px"><h2>시간순 이력</h2></div>' + (ev.length ? simpleTable(["날짜", "단계", "유형", "현장"], ev.slice(-40).reverse().map(function (e) { return [esc(e.dt), esc(e.stage), esc(e.type), esc(e.site || e.addr || "—")]; })) + (ev.length > 40 ? '<p class="gw-note">최근 40건만 표시 (전체 ' + ev.length + "건)</p>" : "") : '<p class="gw-note">분석 기간 내 기록이 없습니다.</p>');
    h += '<div class="card-h" style="margin-top:8px"><h2>현장별 이용 · 다음 단계</h2><span class="mini">같은 아파트 반복 문의는 재사용으로 세지 않습니다</span></div>' + (order.length ? simpleTable(["현장", "첫 L3", "L3 건수", "다음 단계(공고)"], order.map(function (k) { var st = sites[k]; return [esc(st.name), esc(st.first), esc(String(st.n)), st.next ? esc(st.next) : '<span class="mini">아직 연결된 공고 없음</span>']; })) : '<p class="gw-note">현장이 확인된 L3 기록이 없습니다.</p>');
    return h + '<p class="gw-note">운영 시트에 없는 원천(잔디 기술문의·잔디 PT·컨설팅 발행현황)은 포함되지 않았습니다. 현장 연결은 주소 일치 우선, 없으면 현장명 일치이며 불명확한 연결은 확정하지 않습니다.</p>';
  }

  /* ---------- 업체 상세: L2·L3·L4 경로(업체×현장×공종 조합, 24탭) — 영업보고 원천이 없으면 'L2 기록 없음'(직접 진입 확정 아님) ---------- */
  function vendorPathHtml(v) {
    if (!A || !A.has || !A.has("24.경로전환_조합")) return "";
    var rows = A.objs("24.경로전환_조합").filter(function (r) { return r["통합ID"] === v.통합ID; }); if (!rows.length) return '<div class="card-h" style="margin-top:12px"><h2>L2·L3·L4 경로</h2></div><p class="gw-note">이 시공사는 업체·현장·공종이 확정된 L3 조합이 없습니다(업체 미기재·현장 미확정 기록은 제외).</p>';
    var yes = function (x) { return x === "Y" || x === "Y(같은 업체)" ? '<span class="st ok">' + esc(x) + "</span>" : '<span class="st na">—</span>'; };
    var h = '<div class="card-h" style="margin-top:12px"><h2>L2·L3·L4 경로</h2><span class="mini">업체×현장×공종 조합 ' + rows.length + "개 · L3 이후 365일 이내 자사 공고·POUR 낙찰 · L2 보고는 업체를 적지 않아 현장×공종 단위로 연결 · L2 기록 없음 = 직접 진입 확정 아님</span></div>";
    return h + simpleTable(["현장", "공종", "경로 구분", "현장 첫 L2", "첫 L3", "공고 도달", "낙찰 도달"], rows.slice(0, 60).map(function (r) { return [esc(r["현장명"] || r["현장ID"]), esc(r["공종그룹"]), esc(r["경로 구분(L2 반영)"] || r["경로 구분"]), esc(r["현장 첫 L2일(업체 미기재 보고)"] || r["첫 L2일"] || "—"), esc(r["첫 L3일"] || "—"), yes(r["L4 공고 도달(365일)"]), yes(r["L4 낙찰 도달(누구든)"])]; })) + (rows.length > 60 ? '<p class="gw-note">최대 60개만 표시 (전체 ' + rows.length + "개 — 24.경로전환_조합 탭)</p>" : "");
  }
  /* ---------- 업체 상세: 메인자재 구매 이력(업체 단위 — 현장 사용과 구분) ---------- */
  function vendorBuyHtml(v) {
    var b = v.mainBuy; if (!b) return "";
    var h = '<div class="card-h" style="margin-top:12px"><h2>메인자재 구매</h2><span class="mini">업체가 구매한 사실이며, 특정 낙찰 현장에 사용했다는 증거는 아닙니다</span></div>';
    var chip = b.state === "confirmed" ? '<span class="st ok">' + esc(b.label) + "</span>" : b.state === "unknown" ? '<span class="st na">' + esc(b.label) + "</span>" : '<span class="st na">' + esc(b.label) + "</span>";
    h += '<div class="kv"><span>구매 여부</span><span>' + chip + " " + esc(b.note) + "</span>";
    if (b.state === "confirmed") h += "<span>최초 · 최근 구매일</span><span>" + esc(b.first) + " · " + esc(b.last) + "</span><span>재구매</span><span>" + (b.repurchase ? '<span class="st ok">재구매 있음</span> 구매일 ' + b.days + "일" : '<span class="st na">구매일 1일</span>') + "</span><span>구매 건수</span><span>" + b.count + "건 (분석 시작일 이후 " + b.sinceStart + "건)</span>";
    h += "</div>";
    if (b.state === "confirmed") {
      h += '<div class="card-h" style="margin-top:8px"><h2>구매 품목·공종</h2></div><ul class="gw-cov">' + b.items.map(function (x) { return "<li>" + esc(x.품목) + (x.공종 ? " · " + esc(GC.FAM_LABEL[x.공종] || x.공종) : "") + " — " + esc(won(x.금액)) + " (" + x.건수 + "건)</li>"; }).join("") + "</ul>";
      h += '<div class="card-h" style="margin-top:8px"><h2>최근 구매 이력</h2><span class="mini">최근 ' + Math.min(30, b.history.length) + "건 · 판매 적요는 참고용(현장 확정 아님)</span></div>" + simpleTable(["일자", "품목", "수량", "금액", "판매 적요"], b.history.map(function (x) { return [esc(x.d), esc(x.item), x.qty == null ? "—" : esc(String(x.qty)), esc(won(x.amt)), x.memo ? esc(x.memo) : '<span class="op-mut">—</span>']; }));
    }
    return h;
  }
  /* ---------- 업체 상세(모달) ---------- */
  function vendorModal(m) {
    if (!Gs.vendor) return ""; var v = m.vendorDetail(Gs.vendor); var ys = m.years;
    var h = '<div class="ks-modal" data-kact="gvclose-bg"><div class="box" role="dialog" aria-modal="true"><div class="hd"><h2>' + esc(v.이름) + '</h2><span class="mini">통합ID ' + esc(v.통합ID) + '</span><button class="x" data-kact="gvclose">닫기 ✕</button></div><div class="bd">';
    h += '<div class="kv"><span>구매 연결</span><span>' + stChip(v.link.code, v.link.label) + " " + esc(v.link.note) + "</span><span>고객관리카드(B2B 마스터)</span><span>" + (v.cardLinked ? '<span class="st ok">연결됨</span> B2B 고유번호 ' + esc(v.cardId) : '<span class="st na">카드 없음</span> B2B 마스터 미등록(신규 통합ID)') + "</span><span>사업자번호</span><span>" + esc(v.master && v.master["사업자등록번호"] || "없음") + "</span><span>마스터 연결상태</span><span>" + esc(v.master && v.master["연결상태"] || "—") + " · " + esc(v.master && v.master["연결근거"] || "") + "</span><span>최근 구매일</span><span>" + (v.lastBuy ? esc(v.lastBuy) : '<span class="mini">' + esc(v.lastBuyWhy || "구매 기록 없음") + "</span>") + "</span><span>최근 영업활동일</span><span>" + (v.lastActivity ? esc(v.lastActivity + " · " + v.lastActivityType) : '<span class="mini">활동 이력 없음(데이터 없음)</span>') + "</span></div>";
    h += vendorBuyHtml(v);
    h += vendorPathHtml(v);
    h += vendorTimeline(v.통합ID, v);
    h += '<div class="card-h" style="margin-top:12px"><h2>연도별 POUR 낙찰 · 자재 구매</h2></div>' + simpleTable(["연도", "낙찰(건)", "낙찰금액", "자재 구매(연간)", "메인 구매", "동일기간 구매", "품목별(페인트/우레탄/에폭시)"], ys.map(function (y, i) { var a = v.awards[i], p = v.purchases[i]; return [esc(y), esc(String(a.n)), a.n ? esc(won(a.amt) || "—") + (a.missing ? ' <span class="mini">(금액 미기재 ' + a.missing + ")</span>" : "") : '<span class="mini">—</span>', p.amt == null ? '<span class="mini">대기</span>' : esc(won(p.amt) || "0원"), p.main == null ? '<span class="mini">' + esc(p.mainWhy || "대기") + "</span>" : esc(won(p.main) || "0원"), p.ytdAmt == null ? '<span class="mini">대기</span>' : esc(won(p.ytdAmt) || "0원"), p.fam ? esc([p.fam["재도장"], p.fam["우레탄"], p.fam["에폭시"]].map(function (x) { return won(x) || "0"; }).join(" / ")) : '<span class="mini">—</span>']; }));
    h += '<div class="card-h" style="margin-top:12px"><h2>구매 품목(금액 상위)</h2></div>' + (v.items.length ? '<ul class="gw-cov">' + v.items.map(function (x) { return "<li>" + esc(x.품목) + " — " + esc(won(x.금액)) + "</li>"; }).join("") + "</ul>" : '<p class="gw-note">' + esc(v.itemsWhy || "구매 품목 기록 없음") + "</p>");
    h += '<div class="card-h" style="margin-top:12px"><h2>낙찰 현장별 자재 사용 확인</h2><span class="mini">납품서·사용확인 증빙이 시트에 없어 \'확인 완료\'는 없습니다 · 판매 적요에 비슷한 현장명이 있으면 \'후보\'</span></div>';
    h += gtable("gvs", [{ k: "공고일" }, { k: "현장명", wrap: 1 }, { k: "공종" }, { k: "낙찰금액", r: 1, fmt: function (x) { return won(x); } }, { k: "사용확인", l: "사용 확인", raw: 1, f: function (r) { return '<span title="' + esc(r.사용확인메모) + '">' + stChip(r.사용확인코드, r.사용확인) + "</span>"; } }], v.siteRows.slice().sort(function (a, b) { return String(b.공고일).localeCompare(String(a.공고일)); }), { per: 8, empty: "POUR 낙찰 현장 기록이 없습니다" });
    h += '<div class="ks-tools" style="margin-top:12px"><button class="btn ghost" data-kact="gvold" data-id="' + esc(v.통합ID) + '" data-name="' + esc(v.이름) + '">기존 시공사 상세 화면으로</button></div>';
    return h + "</div></div></div>";
  }

  /* ---------- 렌더 ---------- */
  function render(a) { return withEasy(render0(a), EASY_GROW); }
  function render0(a) {
    A = a; if (!Gs.basis) Gs.basis = defs().basis; var m = getModel();
    if (m.error || !m.years || !m.years.length) return '<div class="card"><div class="ks-warn"><b>성장 분석을 계산할 수 없습니다.</b> ' + esc((m.missing || []).join(", ")) + " — 시트 구조를 확인하세요(0으로 대체하지 않음).</div></div>";
    if (!Gs.year || m.years.indexOf(Gs.year) < 0) Gs.year = m.lastY;
    if (!m.restricted && !A.ledger() && A.V.ledgerState === "idle") A.needLedger();
    var h = '<div class="gw">' + header(m) + ourCard(m) + searchCard(m) + summary(m) + flow(m) + secAwards(m) + secSales(m) + secCohort(m) + questions(m) + who(m) + coverage(m) + defsCard(m) + "</div>" + vendorModal(m);
    return h;
  }
  /* ---------- 상호작용 ---------- */
  function rp() { A.repaint(true); }
  function csvOut(kind) {
    var m = getModel(), B = Gs.basis, Y = Gs.year, P = m.prevOf(Y);
    if (kind === "awards") { var rows = m.awardRows(B, Y); A.csv([{ k: "업체", l: "시공사명" }, { k: "시공사", l: "낙찰 표기" }, { k: "통합ID" }, { k: "현장명" }, { k: "공종" }, { k: "공고일" }, { k: "낙찰일", csv: function () { return "자료 없음"; } }, { k: "낙찰금액" }, { k: "연결상태", l: "업체 연결 상태" }, { k: "구매연결" }, { k: "사용확인" }], rows, "POUR낙찰_" + Y + "_" + B); }
    else if (kind === "cohort") { A.csv([{ k: "업체", l: "낙찰 시공사" }, { k: "통합ID" }, { k: "낙찰건수" }, { k: "낙찰금액" }, { k: "구매금액", l: "자재 구매액" }, { k: "메인금액", l: "메인 구매액" }, { k: "최근구매일" }, { k: "연결", l: "연결 등급" }], m.cohortRows(B, Y), "낙찰시공사_구매연결_" + Y + "_" + B); }
    else if (kind === "sales" && P) { var rows2 = m.vendorSales(B, Y, P) || []; A.csv([{ k: "업체", l: "거래처" }, { k: "통합ID" }, { k: "당기", l: Y + "년 자재" }, { k: "전기", l: P + "년 자재" }, { k: "증감액" }, { k: "메인당기", l: Y + "년 메인" }, { k: "메인전기", l: P + "년 메인" }, { k: "낙찰이력" }, { k: "구분" }], rows2, "거래처별매출증감_" + Y + "_vs_" + P + "_" + B); }
  }
  function handle(a, el, id, api, e) {
    if (a.charAt(0) !== "g") return false; A = api; var secMap = { awards: "gw-det-awards", sales: "gw-det-sales", cohort: "gw-det-cohort" };
    switch (a) {
      case "gbasis": Gs.basis = id; Gs.fam = Gs.fam; rp(); return true;
      case "gyearsel": Gs.year = id; rp(); return true;
      case "gyear": Gs.year = id; var sec = el.getAttribute("data-sec"); Gs.open[sec] = true; rp(); jump(secMap[sec]); return true;
      case "gtoggle": Gs.open[id] = !Gs.open[id]; rp(); return true;
      case "gjump": jump(id); return true;
      case "gfam": Gs.fam = id; api.V.page.gsa = 0; rp(); return true;
      case "gvf": Gs.vfilter = id; api.V.page.gsa = 0; rp(); return true;
      case "gcf": Gs.cfilter = id; api.V.page.gco = 0; rp(); return true;
      case "gvendor": Gs.vendor = id; rp(); return true;
      case "gvclose": case "gvclose-bg": if (a === "gvclose" || e.target === el) { Gs.vendor = null; rp(); } return true;
      case "gvold": Gs.vendor = null; api.goOldVendor(id, el.getAttribute("data-name")); api.setView("vendors"); return true;
      case "gcsv": csvOut(id); return true;
      case "gqgo": var qi = document.getElementById("gw-q"); Gs.q = qi ? qi.value.trim() : ""; Gs.qres = null; api.V.page = {}; rp(); return true;
      case "gqclear": Gs.q = ""; Gs.qres = null; api.V.page = {}; rp(); return true;
      case "gdsave": { var r = readDefsForm(); if (r.errs.length) Gs.msg = { cls: "bad", t: r.errs.join(" · ") }; else if (!r.changes.length) Gs.msg = { cls: "bad", t: "바뀐 내용이 없습니다" }; else if (!r.why) Gs.msg = { cls: "bad", t: "변경 사유를 입력하세요(이력에 남습니다)" }; else { STORE.hist.push({ v: STORE.hist.length + 2, at: new Date().toISOString(), reason: r.why, changes: r.changes }); STORE.over = r.over; if (STORE.hist.length > 200) STORE.hist.shift(); var okS = saveStore(); Gs.draft = null; Gs.basis = defs().basis; model = null; Gs.msg = { cls: okS ? "ok" : "bad", t: okS ? "저장했습니다 — 정의 v" + defs().version + " 로 다시 계산했습니다." : "브라우저 저장에 실패해 이번 세션에만 적용됩니다." }; } rp(); return true; }
      case "gdreset": { if (!Object.keys(STORE.over || {}).length) { Gs.msg = { cls: "bad", t: "이미 기본 정의입니다" }; rp(); return true; } var why = (document.getElementById("gd-why") || {}).value || ""; if (!why.trim()) { Gs.msg = { cls: "bad", t: "복원 사유를 입력하세요" }; rp(); return true; } STORE.hist.push({ v: STORE.hist.length + 2, at: new Date().toISOString(), reason: why.trim(), changes: [{ k: "전체", from: "사용자 정의", to: "기본 정의로 복원" }] }); STORE.over = {}; saveStore(); Gs.draft = null; Gs.basis = defs().basis; model = null; Gs.msg = { cls: "ok", t: "기본 정의로 복원했습니다(이력 유지)." }; rp(); return true; }
    }
    return false;
  }
  function key(a, e, api) {
    A = api;
    if (e.key === "Escape" && Gs.vendor) { Gs.vendor = null; rp(); return true; }
    if (a === "gq" && e.key === "Enter") { Gs.q = e.target.value.trim(); Gs.qres = null; api.V.page = {}; rp(); return true; }
    if (a === "gyear" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); handle("gyear", e.target, e.target.getAttribute("data-id"), api, e); return true; }
    return false;
  }
  function change(a, t, api) { A = api; if (a === "gtrade") { Gs.trade = t.value; api.V.page.gaw = 0; rp(); return true; } return false; }
  function input(a, e, api) { A = api; if (a === "gdin") { Gs.draft = Gs.draft || {}; var id = e.target.id; if (id.indexOf("gd-l-") === 0) Gs.draft["l-" + id.slice(5)] = e.target.value; else if (id === "gd-end") Gs.draft.end = e.target.value; else if (id === "gd-basis") Gs.draft.basis = e.target.value; else if (id === "gd-fam") Gs.draft.fam = e.target.value; else if (id === "gd-why") Gs.draft.why = e.target.value; return true; } if (a === "gq" && !e.target.value && Gs.q) { Gs.q = ""; Gs.qres = null; rp(); return true; } return false; }
  window.B2BGrowthView = { render: render, handle: handle, key: key, change: change, input: input, state: Gs, model: function () { return model; }, modelFor: function (api) { A = api; return getModel(); }, defs: defs };
})();
