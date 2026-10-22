/* ============================================================
   시공사 추적 화면 (window.B2BOpsView) + 업무관리 연동용 추천 관리 대상 (window.B2BOpsTasks)
   · 계산은 ops-core.js(window.B2BOps), 데이터는 kpi-sheet-page 가 읽은 운영 시트 탭(읽기 전용)
   · 로그인 상세 보기에서만 업체 단위 정보를 계산·표시한다(공개 보기에는 업체·현장 단위 정보를 싣지 않음)
   · 업무 기록 저장소(netform.b2b.tracker.v1)는 읽지도 쓰지도 않는다 — 업무 등록은 트래커 본체가 담당자 확인 후 수행
   ============================================================ */
(function () {
  "use strict";
  var A = null, cache = { key: "", m: null };
  var St = { l2v: "month", l2q: "", l2p: "all", l2per: "all", l2pg: 0, q: "", stage: "all", act: "all", path: "all", nobuy: false, sort: "last", scope: "managed", page: 0, obs: 180, fup: 14 };
  var PER = 20;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function won(v) { if (!isNum(v)) return "—"; if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, "") + "억"; if (Math.abs(v) >= 1e4) return Math.round(v / 1e4).toLocaleString("ko-KR") + "만"; return Math.round(v).toLocaleString("ko-KR") + "원"; }
  function chip(kind, t) { return '<span class="op-chip ' + kind + '">' + esc(t) + "</span>"; }

  /* ---------- 모델 ---------- */
  function get(api) {
    var a = api || A; if (!a) return { state: "wait" };
    var s = a.S.state; if (s.mode === "public") return { state: "public" };
    if (!a.has("17.장기무활동") || !a.has("2.시공사마스터") || !a.has("7.기술자문문의")) return { state: "wait" };
    var key = [s.version, s.epoch, s.mode, St.obs, St.fup].join("|");
    if (cache.key === key && cache.m) return { state: "ready", m: cache.m };
    var m; try { m = window.B2BOps.build({ has: a.has, objs: a.objs }, { obsDays: St.obs, fupDays: St.fup }); } catch (e) { return { state: "error", msg: String(e && e.message || e) }; }
    if (m.error) return { state: "error", msg: "필요한 시트 탭이 없습니다: " + (m.missing || []).join(", ") };
    cache = { key: key, m: m }; return { state: "ready", m: m };
  }

  /* ---------- 표 ---------- */
  var STAGES = [["all", "전체 단계"], ["L3", "L3"], ["확인 필요", "확인 필요"]];
  var ACTS = [["all", "전체 상태"], ["활성", "활성"], ["전환 관리", "전환 관리"], ["이탈 위험", "이탈 위험(장기 무활동)"], ["활동 이력 없음", "활동 이력 없음"]];
  var SORTS = [["last", "최근 활동순"], ["l3", "L3 활동 많은순"], ["award", "낙찰 건수순"], ["name", "이름순"]];
  function filtered(m) {
    var q = St.q.toLowerCase(), rows = m.rows.filter(function (r) { return St.scope === "all" || r.managed; });
    rows = rows.filter(function (r) {
      if (q && (r.name + " " + r.id).toLowerCase().indexOf(q) < 0) return false;
      if (St.stage !== "all" && r.stage !== St.stage) return false;
      if (St.act !== "all" && r.mgmt !== St.act) return false;
      if (St.path === "unknown" && r.entry !== "경로 확인 필요" && r.entry !== "L2 기록 없음") return false;
      if (St.path === "via" && r.entry !== "L2 경유 있음") return false;
      if (St.path === "direct" && r.entry !== "직접진입") return false;
      if (St.nobuy && r.buyState !== "낙찰 후 구매 미확인") return false;
      return true;
    });
    var s = St.sort; rows = rows.slice().sort(function (a, b) { if (s === "name") return a.name.localeCompare(b.name, "ko"); if (s === "l3") return b.l3n - a.l3n || (b.lastActDt || "").localeCompare(a.lastActDt || ""); if (s === "award") return b.awardN - a.awardN || b.awardAmt - a.awardAmt; return (b.lastActDt || "").localeCompare(a.lastActDt || ""); });
    return rows;
  }
  function statusChip(r) { var k = r.mgmt === "활성" ? "ok" : r.mgmt === "전환 관리" ? "warn" : r.mgmt === "이탈 위험" ? "bad" : "na"; return chip(k, r.mgmt); }
  function pathCell(r) {                                                                   /* 업체×현장×공종 조합 기준 · L2 원천이 없으면 경로 미확정 */
    var p = r.path; if (!p || !p.n) return '<span class="op-mut">조합 없음</span><span class="op-sub">업체·현장·공종 연결 확정 L3 없음</span>';
    return esc("공고 " + p.pub + "/" + p.n + " · 낙찰 " + p.win + "/" + p.n) + '<span class="op-sub">' + esc(p.text2 ? "현장 L2 반영 · " + p.text2 : (p.l2 ? "L2 " + p.l2 + "건 · " : "L2 기록 없음 · ") + p.text) + "</span>";
  }
  function buyChip(r) { var k = r.buyState === "구매 연결 후보" ? "ok" : r.buyState === "낙찰 후 구매 미확인" ? "bad" : r.buyState === "관찰 중" ? "warn" : "na"; return r.buyState === "해당 없음" ? '<span class="op-mut">—</span>' : chip(k, r.buyState); }
  function nextOf(m, id) { var out = []; ["A", "B", "C", "D", "E", "F"].forEach(function (k) { m.recs[k].forEach(function (x) { if (x.id === id && out.length < 2) out.push(x.next); }); }); return out; }
  function tableHtml(m, rows) {
    var pages = Math.max(1, Math.ceil(rows.length / PER)); if (St.page >= pages) St.page = pages - 1; var from = St.page * PER, part = rows.slice(from, from + PER);
    var h = '<div class="op-tw"><table class="op-t"><thead><tr><th>시공사</th><th>협약</th><th>단계 · 진입 유형</th><th>최근 활동</th><th>기술지원(L3)</th><th>공법 활동</th><th>낙찰</th><th>경로 전환 (L3→L4)</th><th>구매 · 메인자재</th><th>관리 상태</th><th>관리 사유 · 다음 조치</th><th></th></tr></thead><tbody>';
    if (!part.length) h += '<tr><td colspan="12" class="op-empty">조건에 맞는 시공사가 없습니다</td></tr>';
    part.forEach(function (r) {
      var nx = nextOf(m, r.id), rs = r.reasons || [];
      h += "<tr><td data-l=\"시공사\"><b>" + esc(r.name) + "</b><span class=\"op-sub\">" + esc(r.id) + (r.core ? " · 핵심(임시)" : "") + (r.managed ? "" : " · 협력사 외") + "</span></td>" +
        "<td data-l=\"협약\">" + (r.mou ? esc(r.mou) : '<span class="op-mut">협약일 미확인</span>') + "</td>" +
        "<td data-l=\"단계 · 진입\">" + (r.stage === "L3" ? chip("ok", "L3") : chip("na", "확인 필요")) + (r.entry === "—" ? "" : " " + chip(r.entry === "경로 확인 필요" || r.entry === "L2 기록 없음" ? "warn" : "ok", r.entry)) + "</td>" +
        "<td data-l=\"최근 활동\">" + (r.lastActDt ? esc(r.lastActDt) + '<span class="op-sub">' + esc(r.lastActType || "") + "</span>" : '<span class="op-mut">활동 이력 없음</span>') + "</td>" +
        "<td data-l=\"기술지원(L3)\">" + (r.l3n ? esc(r.l3n + "건 · 현장 " + r.sites + "곳") + '<span class="op-sub">' + esc(r.types.join(" · ")) + "</span>" : '<span class="op-mut">기간 내 없음</span>') + (r.preN ? '<span class="op-sub">기준일 이전 ' + r.preN + "건 보존</span>" : "") + "</td>" +
        "<td data-l=\"공법 활동\">" + (r.trades.length ? esc(r.trades.slice(0, 2).join(" · ")) + (r.trades.length > 2 ? ' <span class="op-sub">외 ' + (r.trades.length - 2) + "</span>" : "") : '<span class="op-mut">' + (r.l3n ? "공법 미분류" : "—") + "</span>") + "</td>" +
        "<td data-l=\"낙찰\">" + (r.awardN ? esc(r.awardN + "건 · " + won(r.awardAmt)) + '<span class="op-sub">' + esc(r.awardLast) + "</span>" : '<span class="op-mut">기간 내 없음</span>') + "</td>" +
        "<td data-l=\"경로 전환\">" + pathCell(r) + "</td>" +
        "<td data-l=\"구매 · 메인자재\">" + buyChip(r) + '<span class="op-sub">메인자재 ' + (r.mainBuy === "Y" ? "구매 확인" : "구매 미확인") + "</span></td>" +
        "<td data-l=\"관리 상태\">" + statusChip(r) + "</td>" +
        "<td data-l=\"관리 사유\">" + (rs.length ? rs.map(function (x) { return chip(x.kind || "warn", x.label); }).join(" ") + (nx.length ? '<span class="op-sub">' + esc(nx[0]) + "</span>" : "") : '<span class="op-mut">—</span>') + "</td>" +
        "<td class=\"op-act\"><button class=\"btn ghost\" data-kact=\"ovend\" data-id=\"" + esc(r.id) + "\">상세 이력</button></td></tr>";
    });
    h += "</tbody></table></div>";
    h += '<div class="op-pg"><button class="btn ghost" data-kact="opg" data-id="prev"' + (St.page <= 0 ? " disabled" : "") + '>이전</button><span>' + (rows.length ? from + 1 : 0) + "–" + Math.min(from + PER, rows.length) + " / " + rows.length + '곳</span><button class="btn ghost" data-kact="opg" data-id="next"' + (St.page >= pages - 1 ? " disabled" : "") + ">다음</button></div>";
    return h;
  }
  /* ---------- L2 → L3 → L4 전환 현황 (월별 · 현장별 · 시공사별) ---------- */
  function pc(n, d) { return d ? (Math.round(n / d * 1000) / 10).toFixed(1) + "%" : "—"; }
  function l2Cards(L) {
    var a = L.all; return '<div class="op-sum">' + [["L2 현장×공종(확정 연결)", a.n.toLocaleString("ko-KR") + " (보고 " + a.reports.toLocaleString("ko-KR") + "건)"], ["L2 → L3 (365일)", a.l3 + "/" + a.obs + " · " + pc(a.l3, a.obs)], ["L3 → L4 공고 (L2 경유)", a.aPub + "/" + a.aObs + " · " + pc(a.aPub, a.aObs)], ["L2 → L4 직행(L3 없음)", a.direct + "/" + a.obs + " · " + pc(a.direct, a.obs)]].map(function (x) { return '<div class="op-k"><span>' + esc(x[0]) + "</span><b style=\"font-size:16px\">" + esc(x[1]) + "</b></div>"; }).join("") + "</div>";
  }
  function l2MonthTable(L) {
    var h = '<div class="op-tw"><table class="op-t"><thead><tr><th>첫 L2 월</th><th>L2 현장×공종</th><th>365일 관측 완료</th><th>L2 → L3</th><th>L3 → L4 공고(L2 경유)</th><th>L2 → L4 직행</th><th>L2만</th></tr></thead><tbody>';
    L.months.forEach(function (x) { var mk = x.month === "2025-06" ? " · 6/24 이전 포함" : ""; h += "<tr><td data-l=\"첫 L2 월\"><b>" + esc(x.month) + "</b>" + (x.month < "2025-06" ? '<span class="op-sub">분석 시작 전 · 비교용</span>' : mk ? '<span class="op-sub">' + esc(mk.slice(3)) + "</span>" : "") + "</td><td data-l=\"L2 현장×공종\">" + x.n + '<span class="op-sub">보고 ' + x.reports + "건</span></td><td data-l=\"관측 완료\">" + x.obs + "</td><td data-l=\"L2 → L3\">" + (x.obs ? x.l3 + "/" + x.obs + " · " + pc(x.l3, x.obs) : '<span class="op-mut">관측 중</span>') + "</td><td data-l=\"L3 → L4\">" + (x.aObs ? x.aPub + "/" + x.aObs + " · " + pc(x.aPub, x.aObs) : '<span class="op-mut">관측 중</span>') + "</td><td data-l=\"L2 → L4 직행\">" + (x.obs ? x.direct + "/" + x.obs : '<span class="op-mut">—</span>') + "</td><td data-l=\"L2만\">" + (x.obs ? x.only : "—") + "</td></tr>"; });
    return h + "</tbody></table></div>";
  }
  function l2SiteRows(L) {
    var q = St.l2q.toLowerCase();
    return L.rows.filter(function (r) { if (St.l2per === "win" && r.per.indexOf("분석기간") !== 0) return false; if (St.l2per === "past" && r.per.indexOf("과거") !== 0) return false; if (St.l2per === "review" && r.link === "확정") return false; if (St.l2per !== "review" && St.l2per !== "all" && r.link !== "확정") return false;
      if (St.l2p !== "all" && r.path.charAt(0) !== St.l2p) return false; if (q && (r.name + " " + r.trade + " " + r.vend + " " + r.winV).toLowerCase().indexOf(q) < 0) return false; return true; });
  }
  function l2SiteTable(L) {
    var rs = l2SiteRows(L), pages = Math.max(1, Math.ceil(rs.length / PER)); if (St.l2pg >= pages) St.l2pg = pages - 1; var from = St.l2pg * PER, part = rs.slice(from, from + PER);
    var h = '<div class="op-filters"><input class="op-q" type="search" placeholder="현장·공종·업체 검색 (Enter)" value="' + esc(St.l2q) + '" data-kact="ol2q">' + sel("l2per", [["all", "분석기간+과거(확정 연결)"], ["win", "분석기간 내(2025-06-24~)"], ["past", "과거 비교용"], ["review", "현장 연결 불명확(검토)"]], St.l2per) + sel("l2p", [["all", "전체 경로"], ["A", "L2 → L3 (→L4)"], ["C", "L2 → L4 직행"], ["D", "L2만"], ["L", "L3 선행"]], St.l2p) + '<button class="btn ghost" data-kact="ol2csv">현장별 CSV</button></div>';
    h += '<div class="op-tw"><table class="op-t"><thead><tr><th>현장 · 공종</th><th>첫 L2</th><th>경로</th><th>L3 (L2 이후)</th><th>L4 공고</th><th>낙찰</th></tr></thead><tbody>';
    if (!part.length) h += '<tr><td colspan="6" class="op-empty">조건에 맞는 현장이 없습니다</td></tr>';
    part.forEach(function (r) { h += "<tr><td data-l=\"현장 · 공종\"><b>" + esc(r.name) + '</b><span class="op-sub">' + esc(r.trade) + " · " + esc(r.site) + (r.link === "확정" ? "" : " · 현장 연결 검토") + "</span></td><td data-l=\"첫 L2\">" + esc(r.l2) + '<span class="op-sub">보고 ' + r.n2 + "건" + (r.per.indexOf("과거") === 0 ? " · 과거" : "") + "</span></td><td data-l=\"경로\">" + esc(r.path) + (r.obs2 ? "" : '<span class="op-sub">365일 관측 중</span>') + "</td><td data-l=\"L3\">" + (r.l3 ? esc(r.l3) + '<span class="op-sub">' + r.n3 + "건" + (r.vend ? " · " + esc(r.vend.length > 40 ? r.vend.slice(0, 40) + "…" : r.vend) : "") + "</span>" : '<span class="op-mut">—</span>') + "</td><td data-l=\"L4 공고\">" + (r.pub ? esc(r.pubDt || "Y") : r.obs4 ? '<span class="op-mut">없음</span>' : '<span class="op-mut">관측 중</span>') + "</td><td data-l=\"낙찰\">" + (r.win ? esc(r.winV || "Y") : '<span class="op-mut">—</span>') + "</td></tr>"; });
    h += "</tbody></table></div>" + '<div class="op-pg"><button class="btn ghost" data-kact="ol2pg" data-id="prev"' + (St.l2pg <= 0 ? " disabled" : "") + '>이전</button><span>' + (rs.length ? from + 1 : 0) + "–" + Math.min(from + PER, rs.length) + " / " + rs.length + '곳</span><button class="btn ghost" data-kact="ol2pg" data-id="next"' + (St.l2pg >= pages - 1 ? " disabled" : "") + ">다음</button></div>";
    return h;
  }
  function l2VendorTable(m) {
    var rs = m.rows.filter(function (r) { return r.path && r.path.n > 0; }).sort(function (a, b) { return b.path.a - a.path.a || b.path.pub - a.path.pub || b.path.n - a.path.n; }).slice(0, 60);
    var h = '<div class="op-tw"><table class="op-t"><thead><tr><th>시공사</th><th>L3 조합</th><th>L2 선행(A)</th><th>L2 기록 없음(B)</th><th>L4 공고</th><th>낙찰</th></tr></thead><tbody>';
    rs.forEach(function (r) { var p = r.path; h += "<tr><td data-l=\"시공사\"><b>" + esc(r.name) + '</b><span class="op-sub">' + esc(r.id) + "</span></td><td data-l=\"L3 조합\">" + p.n + "</td><td data-l=\"L2 선행\">" + p.a + " · " + pc(p.a, p.n) + "</td><td data-l=\"L2 기록 없음\">" + p.b + "</td><td data-l=\"L4 공고\">" + p.pub + "/" + p.n + "</td><td data-l=\"낙찰\">" + p.win + "/" + p.n + "</td></tr>"; });
    return h + "</tbody></table></div>" + '<p class="op-foot">L2 선행 비율이 높은 순 상위 60곳 · 시공사 전체는 아래 표의 "경로 전환" 열과 CSV에서 봅니다. L2 보고는 업체를 적지 않아 L3 조합의 현장×공종에 보고가 먼저 있었는지로만 연결합니다.</p>';
  }
  function l2Section(m) {
    var L = m.l2; if (!L || !L.has) return "";
    var h = '<div class="card" style="margin-bottom:12px"><div class="card-h"><h2>L2 → L3 → L4 전환 현황</h2><span class="mini">현장×공종 단위 · 잔디 영업보고 ' + L.reports.toLocaleString("ko-KR") + "건(" + esc(L.first) + " ~ " + esc(L.last) + ") · L3·L4는 첫 보고(L3) 이후 365일 내 · 365일 관측이 끝난 건만 분모</span></div>";
    h += l2Cards(L);
    h += '<div class="op-filters">' + [["month", "월별"], ["site", "현장별"], ["vendor", "시공사별"]].map(function (x) { return '<button class="op-tg' + (St.l2v === x[0] ? " on" : "") + '" data-kact="ol2v" data-id="' + x[0] + '" aria-pressed="' + (St.l2v === x[0]) + '">' + x[1] + "</button>"; }).join("") + "</div>";
    h += St.l2v === "month" ? l2MonthTable(L) : St.l2v === "site" ? l2SiteTable(L) : l2VendorTable(m);
    h += '<p class="op-foot">분석기간 내(2025-06-24~) ' + L.win.n + "곳 · 과거 비교용 " + L.past.n + "곳(삭제하지 않고 보존) · 현장 연결이 불명확한(주소 없음·이름만 일치 등) " + L.review.n + "곳은 별도 검토 대상으로 분리해 위 비율에서 뺐습니다. 현장 연결이 덜 확정된 경우 실제 L3·L4가 일부 빠졌을 수 있어 비율은 하한에 가깝습니다. 2026-06-30 이후 영업보고 기록은 없어 그 이후 현장은 L2 경유로 잡히지 않습니다. 검증 전 값이며 KPI 카드 값에는 반영하지 않았습니다.</p></div>";
    return h;
  }
  function sel(id, opts, cur) { return '<select class="op-sel" data-kact="osel" data-id="' + id + '">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(cur) === String(o[0]) ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select>"; }

  function render(api) {
    A = api; var g = get(api);
    var head = '<div class="op"><div class="op-head"><div><h2>시공사별 활동·성과 추적</h2><p>우리 팀의 활동 → 시공사 반응 → 공법 경험 → 낙찰·구매 → 성과 → 다음 관리 업무를 시공사 단위로 봅니다.</p></div></div>' +
      '<div class="op-period"><b>분석 기준일 2025.06.24</b><span>기준일 이후 유효 활동만 집계하고, 이전 기록은 삭제하지 않고 이력으로 보존합니다. 협약일 없는 업체는 신규·기존을 판정하지 않습니다.</span></div>';
    if (g.state === "public") return head + '<div class="card"><div class="ks-warn"><b>시공사 단위 정보는 공개 화면에 싣지 않습니다.</b> 상단의 [상세 보기(로그인)]로 시트에 연결하면 이 화면에서 시공사별 추적표를 볼 수 있습니다.</div></div></div>';
    if (g.state === "wait") return head + '<div class="card"><div class="ks-warn"><b>시트 데이터를 읽는 중이거나 연결되지 않았습니다.</b> 연결 설정에서 구글시트를 연결하면 표시됩니다(값을 만들어 채우지 않습니다).</div></div></div>';
    if (g.state === "error") return head + '<div class="card"><div class="ks-warn"><b>계산할 수 없습니다.</b> ' + esc(g.msg || "") + "</div></div></div>";
    var m = g.m, S = m.summary, rows = filtered(m);
    var h = head;
    h += '<div class="op-sum">' + [["관리 시공사", S.managed], ["활성(최근 90일 내 활동)", S.active], ["장기 무활동", S.dormant], ["기간 내 L3 활동 시공사", S.l3Vendors], ["경로 확인 필요", S.pathUnknown], ["기간 내 낙찰 시공사", S.awardVendors], ["낙찰 후 구매 미확인", S.buyMissing]].map(function (x) { return '<div class="op-k"><span>' + esc(x[0]) + "</span><b>" + esc(isNum(x[1]) ? x[1].toLocaleString("ko-KR") : "—") + "</b></div>"; }).join("") + "</div>";
    h += (S.hasL2Source ? '<div class="op-note"><b>읽는 법</b> L2 = 잔디 「POUR공법기술문의」 영업 담당자 보고(업체 미기재 · 현장×공종 단위)입니다. 시공사의 "L2 경유 있음"은 그 시공사 L3 조합의 현장×공종에 L3 이전 L2 보고가 있다는 뜻이고, "L2 기록 없음"은 직접 진입으로 확정하지 않습니다. 잔디 보고 기록은 2026-06-30까지라 이후 신규 현장의 L2는 없습니다. 협약일 미확인 ' + S.mouNone + '곳은 신규·기존을 판정하지 않았습니다. 낙찰 후 구매는 연 단위 자재 순매출 기준 \x27연결 후보\x27(관찰 ' + m.obsDays + '일)입니다.</div>' : '<div class="op-note"><b>읽는 법</b> L3 활동 시공사·진입 유형은 운영 시트에 있는 플랫폼 기록 기준(잔디 기록 미포함)이라 하한값입니다. 영업보고(L2) 원천이 연결되기 전에는 L3 시공사를 ' + chip("warn", "경로 확인 필요") + '로만 분류하며 직접진입 확정은 ' + S.direct + "곳입니다. 협약일 미확인 " + S.mouNone + "곳은 신규·기존을 판정하지 않았습니다. 낙찰 후 구매는 연 단위 자재 순매출 기준 '연결 후보'(관찰 " + m.obsDays + "일)입니다.</div>" );
    h += l2Section(m);
    h += '<div class="op-filters"><input class="op-q" type="search" placeholder="시공사 이름·ID 검색" value="' + esc(St.q) + '" data-kact="oq">' + sel("scope", [["managed", "관리 시공사(" + S.managed + ")"], ["all", "협력사 외 포함"]], St.scope) + sel("stage", STAGES, St.stage) + sel("act", ACTS, St.act) + sel("path", [["all", "전체 경로"], ["unknown", "경로 확인 필요·L2 기록 없음"], ["via", "L2 경유 있음"], ["direct", "직접진입 확정"]], St.path) + sel("sort", SORTS, St.sort) +
      '<button class="op-tg' + (St.nobuy ? " on" : "") + '" data-kact="onb" aria-pressed="' + St.nobuy + '">낙찰 후 구매 미확인</button><button class="btn ghost" data-kact="ocsv">CSV 다운로드</button></div>';
    h += tableHtml(m, rows);
    h += '<p class="op-foot">시공사 [상세 이력]은 협약일·기간 내 L3·현장별 재사용·공고·낙찰·구매를 시간순으로 보여줍니다. 고객관리카드 데이터는 복제하지 않고 B2B 고유번호만 참조합니다. 업무 완료 자체는 L3 전환이나 구매 실적으로 계산하지 않습니다.</p></div>';
    return h;
  }

  function l2Csv(api) {
    var g = get(api); if (g.state !== "ready" || !g.m.l2) return; var rs = l2SiteRows(g.m.l2);
    var head = ["현장ID", "현장명", "공종그룹", "첫 L2일", "L2 건수", "구분", "현장 연결", "경로 구분", "첫 L3일(L2 이후)", "L3 건수", "L3 업체", "365일 관측 완료(L2)", "L2→L3 365일 내", "L4 공고 도달", "첫 공고일", "L4 낙찰 도달", "낙찰 업체"];
    var lines = [head].concat(rs.map(function (r) { return [r.site, r.name, r.trade, r.l2, r.n2, r.per, r.link, r.path, r.l3, r.n3, r.vend, r.obs2 ? "Y" : "", r.l3in ? "Y" : "", r.pub ? "Y" : "", r.pubDt, r.win ? "Y" : "", r.winV]; }));
    var csv = "\ufeff" + lines.map(function (x) { return x.map(function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }).join(","); }).join("\r\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "L2_L3_L4_현장별_" + g.m.asOf + ".csv"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function csvOut(api) {
    var g = get(api); if (g.state !== "ready") return; var rows = filtered(g.m);
    var cols = [{ k: "시공사", csv: function (r) { return r.name; } }, { k: "통합ID", csv: function (r) { return r.id; } }, { k: "협약일", csv: function (r) { return r.mou || "미확인"; } }, { k: "현재 단계", csv: function (r) { return r.stage; } }, { k: "진입 유형", csv: function (r) { return r.entry; } }, { k: "최근 활동일", csv: function (r) { return r.lastActDt || ""; } }, { k: "L3 건수(기간 내)", csv: function (r) { return r.l3n; } }, { k: "L3 현장 수", csv: function (r) { return r.sites; } }, { k: "기준일 이전 활동(보존)", csv: function (r) { return r.preN; } }, { k: "낙찰 건수(기간 내)", csv: function (r) { return r.awardN; } }, { k: "L3→L4 조합 수", csv: function (r) { return r.path ? r.path.n : ""; } }, { k: "L4 공고 도달 조합", csv: function (r) { return r.path ? r.path.pub : ""; } }, { k: "L4 낙찰 도달 조합(누구든)", csv: function (r) { return r.path ? r.path.win : ""; } }, { k: "경로 구분", csv: function (r) { return r.path ? r.path.text : ""; } }, { k: "낙찰금액(공급가액 기준 미확인)", csv: function (r) { return r.awardAmt; } }, { k: "구매 상태", csv: function (r) { return r.buyState; } }, { k: "메인자재", csv: function (r) { return r.mainBuy; } }, { k: "관리 상태", csv: function (r) { return r.mgmt; } }, { k: "B2B고유번호", csv: function (r) { return r.cardId; } }];
    A.csv(cols, rows, "시공사추적_" + g.m.asOf);
  }

  /* ---------- 상호작용 ---------- */
  function rp() { if (A) A.repaint(true); }
  function handle(a, el, id, api, e) {
    if (!a || a.charAt(0) !== "o") return false; A = api;
    if (a === "ovend") { var GV = window.B2BGrowthView; if (GV && GV.state) { GV.state.vendor = id; } api.setView("growth"); return true; }
    if (a === "onb") { St.nobuy = !St.nobuy; St.page = 0; rp(); return true; }
    if (a === "opg") { St.page += id === "next" ? 1 : -1; if (St.page < 0) St.page = 0; rp(); return true; }
    if (a === "ocsv") { csvOut(api); return true; }
    if (a === "ol2v") { St.l2v = id; St.l2pg = 0; rp(); return true; }
    if (a === "ol2pg") { St.l2pg += id === "next" ? 1 : -1; if (St.l2pg < 0) St.l2pg = 0; rp(); return true; }
    if (a === "ol2csv") { l2Csv(api); return true; }
    if (a === "oq" || a === "ol2q") return true;
    return false;
  }
  function key(a, e, api) { if (a === "ol2q" && e.key === "Enter") { A = api; St.l2q = e.target.value.trim(); St.l2pg = 0; rp(); return true; } if (a === "oq" && e.key === "Enter") { A = api; St.q = e.target.value.trim(); St.page = 0; rp(); return true; } return false; }
  function change(a, t, api) { if (a !== "osel") return false; A = api; var id = t.getAttribute("data-id"); St[id] = t.value; St.page = 0; if (id.indexOf("l2") === 0) St.l2pg = 0; rp(); return true; }

  /* ---------- 업무관리 연동: 추천 관리 대상 ---------- */
  var TYPES = { A: { n: "L2→L3 전환 관리", d: "기술자문 이후 컨설팅·설명회 등 전환 근거가 없는 시공사(구 정의, 시트 16탭 기준)" }, B: { n: "낙찰 후 미구매 확인", d: "기준일 이후 낙찰 기록이 있으나 관찰 기간 안에 자재 구매가 확인되지 않은 시공사" }, C: { n: "장기 무활동 시공사", d: "과거 활동은 있으나 90일 이상 새 활동이 없는 시공사" }, D: { n: "컨설팅 후속 관리", d: "컨설팅 요청 후 발행 기록이 확인되지 않은 시공사" }, E: { n: "협약일 미확인", d: "협약일이 없어 신규·기존 판정을 못한 관리 시공사 — 협약일 확인이 먼저" }, F: { n: "최근 활동 감소", d: "핵심 시공사(임시 정의) 중 최근 90일 활동이 직전 90일보다 줄어든 시공사 · 이전 기간 원천이 충분할 때만 판단" } };
  var Tasks = {
    attach: function (api) { A = api; },
    types: TYPES,
    get: function () { var g = get(A); if (g.state !== "ready") return { state: g.state, msg: g.msg }; return { state: "ready", recs: g.m.recs, asOf: g.m.asOf, obsDays: g.m.obsDays, fupDays: g.m.fupDays }; },
    find: function (k) { var g = get(A); if (g.state !== "ready") return null; var out = null; ["A", "B", "C", "D", "E", "F"].forEach(function (t) { g.m.recs[t].forEach(function (x) { if (x.key === k) out = x; }); }); return out; },
    setParams: function (o) { if (o.obs) St.obs = o.obs; if (o.fup) St.fup = o.fup; },
    params: function () { return { obs: St.obs, fup: St.fup }; }
  };
  window.B2BOpsView = { render: render, handle: handle, key: key, change: change, attach: function (api) { A = api; }, state: St, model: function (api) { var g = get(api || A); return g.state === "ready" ? g.m : null; } };
  window.B2BOpsTasks = Tasks;
})();
