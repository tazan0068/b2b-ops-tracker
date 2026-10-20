/* ============================================================
   통합 구글시트 데이터 소스 — 업무 트래커 첫 화면용
   · 내장: #b2b-sheet-data (v7 검증본, gzip+base64) → "저장된 데이터"
   · 실시간: Apps Script 읽기 전용 웹앱(또는 같은 형식의 API) → "구글시트 실시간"
   · 연결 설정(URL·액세스 키)은 localStorage "netform.b2b.sheetlink.v1" 에만 저장. HTML 에 인증정보 없음.
   · 업무 기록 저장소 "netform.b2b.tracker.v1" 은 읽지도 쓰지도 않는다.
   ============================================================ */
(function () {
  var KEY = "netform.b2b.sheetlink.v1";
  var LEDGER = "3.이카운트판매원문";
  var state = { ready: false, mode: "embedded", meta: null, tabs: null, at: null, error: null, loading: false, ledgerProgress: null, frozenDiff: [], embeddedMeta: null, decodeError: null };
  var embedded = null; var listeners = [];

  function decodeTab(t) { if (!t.enc) return t; var cols = t.enc.cols; return { header: t.header, rows: t.rows.map(function (r) { return r.map(function (v, i) { var d = cols[i]; if (!d) return v; if (v == null) return null; if (typeof v === "object") return v.v; return d[v]; }); }) }; }
  function b64ToBytes(b64) { var bin = atob(b64), n = bin.length, u = new Uint8Array(n); for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u; }
  function gunzipText(bytes) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("이 브라우저는 압축 해제(DecompressionStream)를 지원하지 않습니다. 최신 Chrome/Edge 로 열어 주세요."));
    var ds = new DecompressionStream("gzip"); var w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Response(ds.readable).arrayBuffer().then(function (ab) { return new TextDecoder("utf-8").decode(ab); });
  }
  function loadEmbedded() {
    var el = document.getElementById("b2b-sheet-data"); if (!el || el.getAttribute("data-enc") === "none") { embedded = { meta: { source: "none", version: "연결 대기", asOf: "", tabs: {}, verified: "" }, tabs: {} }; return Promise.resolve(embedded); }
    var enc = el.getAttribute("data-enc") || "json";
    var p = enc === "gzip-b64" ? gunzipText(b64ToBytes(el.textContent.trim())) : Promise.resolve(el.textContent);
    return p.then(function (txt) { var j = JSON.parse(txt); var tabs = {}; for (var k in j.tabs) tabs[k] = decodeTab(j.tabs[k]); embedded = { meta: j.meta, tabs: tabs }; return embedded; });
  }
  function settings() { try { return JSON.parse(localStorage.getItem(KEY) || "null") || null; } catch (e) { return null; } }
  function saveSettings(s) { localStorage.setItem(KEY, JSON.stringify({ endpoint: String(s.endpoint || "").trim(), key: String(s.key || ""), sheetId: String(s.sheetId || "").trim(), savedAt: new Date().toISOString() })); }
  function clearSettings() { localStorage.removeItem(KEY); }
  /* 키는 URL 이 아니라 요청 본문(POST · text/plain JSON)으로만 보낸다 → 브라우저 기록·서버 로그에 남지 않음. CORS 사전 요청 없음 */
  function api(s, params, timeoutMs) {
    var body = {}; for (var k in params) body[k] = params[k]; body.key = s.key || ""; if (s.sheetId) body.sheetId = s.sheetId;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null; var t = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 60000) : null;
    return fetch(s.endpoint, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { if (!j || j.ok !== true) throw new Error((j && j.error) || "응답 형식 오류"); return j; })
      .catch(function (e) { throw new Error(e.name === "AbortError" ? "응답 시간 초과" : (e.message || String(e))); })
      .finally(function () { if (t) clearTimeout(t); });
  }
  var DEFAULT_TABS = ["1.통합KPI", "2.시공사마스터", "4.메인자재구매현황", "5.POUR공고낙찰", "5b.POUR반영공고", "6.타사공법낙찰", "7.기술자문문의", "7b.플랫폼가입현황", "8.컨설팅요청", "8b.컨설팅발행이력", "9.샘플카탈로그요청", "10.공법설명회이력", "11.기타문의답변", "12.거래처연결검토", "13.데이터검증변경이력", "14.판매원문차이검증", "15.마스터대조", "16.L2L3전환", "16b.L2L3시공사별", "16c.L2L3판정집계", "16d.L2L3검토이력", "17.장기무활동", "18.선행지표요약", "19.업체명정규화"];
  function smallTabs() { var names = Object.keys(embedded.tabs).filter(function (n) { return n !== LEDGER; }); return names.length ? names : DEFAULT_TABS; }
  function emit() { listeners.forEach(function (f) { try { f(state); } catch (e) {} }); }

  /* 확정 연도(2022~2025) KPI 가 시트와 다른지 — 값은 시트를 보여주되 차이를 알린다 */
  function diffFrozen(liveTabs) {
    var out = []; var e = embedded.tabs["1.통합KPI"], l = liveTabs["1.통합KPI"]; if (!e || !l) return out;
    var fy = embedded.meta.frozenYears || []; var yi = e.header.indexOf("연도"), yl = l.header.indexOf("연도");
    e.rows.forEach(function (er) { var y = String(er[yi]); if (fy.indexOf(y) < 0) return; var lr = l.rows.filter(function (r) { return String(r[yl]) === y; })[0]; if (!lr) { out.push({ year: y, col: "(행 없음)", embedded: "있음", live: "없음" }); return; }
      e.header.forEach(function (h, i) { var li = l.header.indexOf(h); if (li < 0) return; var a = er[i], b = lr[li]; if (String(a == null ? "" : a) !== String(b == null ? "" : b)) out.push({ year: y, col: h, embedded: a, live: b }); }); });
    return out;
  }

  function noData() { return !embedded || embedded.meta.source === "none"; }
  function useEmbedded(reason) { state.mode = reason ? "fallback" : (noData() ? "none" : "embedded"); state.error = reason || null; state.tabs = embedded.tabs; state.meta = embedded.meta; state.frozenDiff = []; state.ledgerProgress = null; }
  function refresh() {
    if (!embedded) return Promise.resolve(state);
    var s = settings();
    if (!s || !s.endpoint) { useEmbedded(null); state.at = new Date(); emit(); return Promise.resolve(state); }
    state.loading = true; emit();
    return api(s, { action: "tabs", tabs: smallTabs().join(",") }, 90000).then(function (j) {
      var tabs = {}; smallTabs().forEach(function (n) { var t = j.tabs[n]; if (!t) throw new Error("시트에 탭 없음: " + n); tabs[n] = { header: t.header, rows: t.rows }; });
      tabs[LEDGER] = null; /* 원문은 열 때 나눠 읽는다 */
      state.mode = "live"; state.meta = j.meta || {}; state.tabs = tabs; state.error = null; state.at = new Date(); state.frozenDiff = diffFrozen(tabs);
    }).catch(function (e) { useEmbedded(e.message || String(e)); state.at = new Date(); })
      .then(function () { state.loading = false; emit(); return state; });
  }
  /* 원문 원장: 내장이면 즉시, 실시간이면 5,000행씩 */
  function ledger(onProgress) {
    if (state.mode !== "live") { var t0 = embedded.tabs[LEDGER]; return t0 ? Promise.resolve(t0) : Promise.reject(new Error("연결 대기 — 구글시트에 연결한 뒤 원문을 읽을 수 있습니다")); }
    if (state.tabs[LEDGER]) return Promise.resolve(state.tabs[LEDGER]);
    var s = settings(); var acc = null; var LIMIT = 5000;
    function step(off) { return api(s, { action: "tab", tab: LEDGER, offset: off, limit: LIMIT }, 120000).then(function (j) { if (!acc) acc = { header: j.header, rows: [] }; acc.rows = acc.rows.concat(j.rows); state.ledgerProgress = { loaded: acc.rows.length, total: j.total }; if (onProgress) onProgress(state.ledgerProgress); if (acc.rows.length < j.total && j.rows.length) return step(acc.rows.length); state.tabs[LEDGER] = acc; state.ledgerProgress = null; return acc; }); }
    return step(0);
  }
  function tab(name) { var t = state.tabs && state.tabs[name]; if (t) return t; return embedded ? embedded.tabs[name] : null; }
  function test(s) { return api(s, { action: "meta" }, 30000).then(function (j) { return j.meta; }); }

  loadEmbedded().then(function () { state.ready = true; state.embeddedMeta = embedded.meta; useEmbedded(null); state.at = new Date(); emit(); return refresh(); })
    .catch(function (e) { state.decodeError = e.message || String(e); state.ready = false; emit(); });

  window.B2BSheet = { noData: noData, state: state, refresh: refresh, tab: tab, ledger: ledger, settings: settings, saveSettings: saveSettings, clearSettings: clearSettings, test: test, onChange: function (f) { listeners.push(f); }, LEDGER: LEDGER, KEY: KEY };
})();
