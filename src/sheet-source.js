/* ============================================================
   통합 구글시트 데이터 소스 — 업무 트래커 첫 화면용 (v3)
   · 내장: #b2b-sheet-data (검증본 gzip+base64) → "저장된 데이터" / data-enc="none" → "연결 대기"(회사 데이터 미내장)
   · 실시간 A (권장) : Google 로그인(OAuth, spreadsheets.readonly) + Sheets API 직접 읽기
                       → 시트를 공유받은 직원만 자기 계정으로 읽음. 공유 키 없음. 회수 = 시트 공유 해제.
   · 실시간 B (내부 시험용): Apps Script 읽기 전용 웹앱 + 공유 액세스 키(POST 본문) — 승인 직원 제한 불가
   · 연결 설정은 localStorage "netform.b2b.sheetlink.v1" 에만, 로그인 토큰은 sessionStorage 에만. HTML 에 ID·키 없음.
   · 업무 기록 저장소 "netform.b2b.tracker.v1" 은 읽지도 쓰지도 않는다.
   ============================================================ */
(function () {
  var KEY = "netform.b2b.sheetlink.v1", TKEY = "netform.b2b.sheettoken.v1";
  var LEDGER = "3.이카운트판매원문";
  var SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
  var API = function () { return (window.B2B_SHEETS_API_BASE || "https://sheets.googleapis.com") + "/v4/spreadsheets/"; };
  var state = { ready: false, mode: "embedded", authMode: null, meta: null, tabs: null, at: null, error: null, loading: false, ledgerProgress: null, frozenDiff: [], embeddedMeta: null, decodeError: null, needSignIn: false, signedIn: false };
  var embedded = null; var listeners = []; var tokenClient = null; var gisReady = null;
  var DEFAULT_TABS = ["1.통합KPI", "2.시공사마스터", "4.메인자재구매현황", "5.POUR공고낙찰", "5b.POUR반영공고", "6.타사공법낙찰", "7.기술자문문의", "7b.플랫폼가입현황", "8.컨설팅요청", "8b.컨설팅발행이력", "9.샘플카탈로그요청", "10.공법설명회이력", "11.기타문의답변", "12.거래처연결검토", "13.데이터검증변경이력", "14.판매원문차이검증", "15.마스터대조", "16.L2L3전환", "16b.L2L3시공사별", "16c.L2L3판정집계", "16d.L2L3검토이력", "17.장기무활동", "18.선행지표요약", "19.업체명정규화"];

  /* ---------- 내장 데이터 ---------- */
  function decodeTab(t) { if (!t.enc) return t; var cols = t.enc.cols; return { header: t.header, rows: t.rows.map(function (r) { return r.map(function (v, i) { var d = cols[i]; if (!d) return v; if (v == null) return null; if (typeof v === "object") return v.v; return d[v]; }); }) }; }
  function b64ToBytes(b64) { var bin = atob(b64), n = bin.length, u = new Uint8Array(n); for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u; }
  function gunzipText(bytes) { if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("이 브라우저는 압축 해제(DecompressionStream)를 지원하지 않습니다. 최신 Chrome/Edge 로 열어 주세요.")); var ds = new DecompressionStream("gzip"); var w = ds.writable.getWriter(); w.write(bytes); w.close(); return new Response(ds.readable).arrayBuffer().then(function (ab) { return new TextDecoder("utf-8").decode(ab); }); }
  function loadEmbedded() {
    var el = document.getElementById("b2b-sheet-data"); if (!el || el.getAttribute("data-enc") === "none") { embedded = { meta: { source: "none", version: "연결 대기", asOf: "", tabs: {}, verified: "" }, tabs: {} }; return Promise.resolve(embedded); }
    var enc = el.getAttribute("data-enc") || "json"; var p = enc === "gzip-b64" ? gunzipText(b64ToBytes(el.textContent.trim())) : Promise.resolve(el.textContent);
    return p.then(function (txt) { var j = JSON.parse(txt); var tabs = {}; for (var k in j.tabs) tabs[k] = decodeTab(j.tabs[k]); embedded = { meta: j.meta, tabs: tabs }; return embedded; });
  }
  function noData() { return !embedded || embedded.meta.source === "none"; }

  /* ---------- 설정 ---------- */
  function settings() { try { return JSON.parse(localStorage.getItem(KEY) || "null") || null; } catch (e) { return null; } }
  function saveSettings(s) { localStorage.setItem(KEY, JSON.stringify({ mode: s.mode === "appsscript" ? "appsscript" : "google", clientId: String(s.clientId || "").trim(), sheetId: String(s.sheetId || "").trim(), endpoint: String(s.endpoint || "").trim(), key: String(s.key || ""), savedAt: new Date().toISOString() })); }
  function clearSettings() { localStorage.removeItem(KEY); clearToken(); }
  function emit() { listeners.forEach(function (f) { try { f(state); } catch (e) {} }); }

  /* ---------- A. Google 로그인 + Sheets API ---------- */
  function getStoredToken() { try { var t = JSON.parse(sessionStorage.getItem(TKEY) || "null"); if (t && t.token && t.exp > Date.now() + 30000) return t.token; } catch (e) {} return null; }
  function storeToken(tok, sec) { try { sessionStorage.setItem(TKEY, JSON.stringify({ token: tok, exp: Date.now() + (Number(sec) || 3600) * 1000 })); } catch (e) {} }
  function clearToken() { try { sessionStorage.removeItem(TKEY); } catch (e) {} state.signedIn = false; }
  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (gisReady) return gisReady;
    gisReady = new Promise(function (res, rej) { var s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = function () { res(); }; s.onerror = function () { gisReady = null; rej(new Error("Google 로그인 라이브러리를 불러오지 못했습니다(네트워크 확인)")); }; document.head.appendChild(s); });
    return gisReady;
  }
  /* 사용자 클릭에서만 호출(팝업 허용). interactive=false 면 저장된 세션 토큰만 사용 */
  function getToken(interactive) {
    var t = getStoredToken(); if (t) { state.signedIn = true; return Promise.resolve(t); }
    if (!interactive) { state.needSignIn = true; return Promise.reject(new Error("NEED_SIGNIN")); }
    var s = settings() || {}; if (!s.clientId) return Promise.reject(new Error("OAuth 클라이언트 ID 가 없습니다. 연결 설정에서 입력하세요."));
    return loadGis().then(function () { return new Promise(function (res, rej) {
      tokenClient = google.accounts.oauth2.initTokenClient({ client_id: s.clientId, scope: SCOPE, callback: function (r) { if (r && r.access_token) { storeToken(r.access_token, r.expires_in); state.signedIn = true; state.needSignIn = false; res(r.access_token); } else rej(new Error("로그인이 취소되었거나 토큰을 받지 못했습니다" + (r && r.error ? " (" + r.error + ")" : ""))); }, error_callback: function (e) { rej(new Error("Google 로그인 실패: " + (e && (e.type || e.message) || "알 수 없음"))); } });
      tokenClient.requestAccessToken({ prompt: "" });
    }); });
  }
  function gfetch(url, timeoutMs) {
    return getToken(false).then(function (tok) {
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null; var t = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 90000) : null;
      return fetch(url, { headers: { Authorization: "Bearer " + tok }, signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
        if (r.status === 401) { clearToken(); state.needSignIn = true; throw new Error("NEED_SIGNIN"); }
        if (r.status === 403) throw new Error("시트 접근 권한이 없습니다(PERMISSION_DENIED). 로그인한 Google 계정에 시트가 공유되어 있어야 합니다 — 시트 소유자에게 '뷰어' 공유를 요청하세요.");
        if (r.status === 404) throw new Error("시트를 찾을 수 없습니다(시트 ID 확인)");
        if (r.status === 429) throw new Error("Sheets API 호출 한도 초과 — 잠시 후 다시 시도하세요");
        if (!r.ok) throw new Error("Sheets API HTTP " + r.status);
        return r.json();
      }).catch(function (e) { throw new Error(e.name === "AbortError" ? "응답 시간 초과" : (e.message || String(e))); }).finally(function () { if (t) clearTimeout(t); });
    });
  }
  function colLetter(n) { var s = ""; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function q(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
  function norm(vals, header) { var w = header.length; return (vals || []).map(function (r) { var o = new Array(w); for (var i = 0; i < w; i++) { var v = r[i]; o[i] = (v === "" || v === undefined) ? null : v; } return o; }).filter(function (r) { return r.some(function (v) { return v !== null; }); }); }
  function gMeta(sid) {
    return gfetch(API() + encodeURIComponent(sid) + "?fields=properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))").then(function (j) {
      var tabs = {}; (j.sheets || []).forEach(function (s) { tabs[s.properties.title] = { rows: null, cols: s.properties.gridProperties.columnCount }; });
      var names = Object.keys(tabs); var url = API() + encodeURIComponent(sid) + "/values:batchGet?majorDimension=COLUMNS" + names.map(function (n) { return "&ranges=" + encodeURIComponent(q(n) + "!A:A"); }).join("");
      return gfetch(url).then(function (b) { (b.valueRanges || []).forEach(function (vr, i) { var col = (vr.values && vr.values[0]) || []; tabs[names[i]].rows = Math.max(0, col.length - 1); }); return { source: "sheet", auth: "google", title: j.properties.title, spreadsheetId: sid, lastUpdated: null, servedAt: new Date().toISOString(), tabs: tabs }; });
    });
  }
  function gTabs(sid, names) {
    var url = API() + encodeURIComponent(sid) + "/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING" + names.map(function (n) { return "&ranges=" + encodeURIComponent(q(n)); }).join("");
    return gfetch(url).then(function (b) { var out = {}; (b.valueRanges || []).forEach(function (vr, i) { var vals = vr.values || []; var header = (vals[0] || []).map(function (h) { return h == null ? "" : String(h); }); out[names[i]] = { header: header, rows: norm(vals.slice(1), header) }; }); names.forEach(function (n) { if (!out[n]) throw new Error("시트에 탭 없음: " + n); }); return out; });
  }
  function gLedger(sid, meta, onProgress) {
    var cols = (meta.tabs[LEDGER] || {}).cols || 26, total = (meta.tabs[LEDGER] || {}).rows || 0, L = colLetter(cols), CH = 5000;
    return gfetch(API() + encodeURIComponent(sid) + "/values/" + encodeURIComponent(q(LEDGER) + "!A1:" + L + "1")).then(function (h) { var header = ((h.values || [])[0] || []).map(function (x) { return x == null ? "" : String(x); }); var acc = { header: header, rows: [] };
      function step(start) { if (start > total + 1) return acc; var end = Math.min(start + CH - 1, total + 1); return gfetch(API() + encodeURIComponent(sid) + "/values/" + encodeURIComponent(q(LEDGER) + "!A" + start + ":" + L + end) + "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING", 120000).then(function (j) { acc.rows = acc.rows.concat(norm(j.values, header)); state.ledgerProgress = { loaded: acc.rows.length, total: total }; if (onProgress) onProgress(state.ledgerProgress); return (j.values || []).length ? step(end + 1) : acc; }); }
      return step(2).then(function (a) { state.ledgerProgress = null; return a; }); });
  }

  /* ---------- B. Apps Script 공유 키 (POST 본문) ---------- */
  function api(s, params, timeoutMs) {
    var body = {}; for (var k in params) body[k] = params[k]; body.key = s.key || ""; if (s.sheetId) body.sheetId = s.sheetId;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null; var t = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 60000) : null;
    return fetch(s.endpoint, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) { if (!j || j.ok !== true) throw new Error((j && j.error) || "응답 형식 오류"); return j; })
      .catch(function (e) { throw new Error(e.name === "AbortError" ? "응답 시간 초과" : (e.message || String(e))); })
      .finally(function () { if (t) clearTimeout(t); });
  }
  function smallTabs() { var names = Object.keys(embedded.tabs).filter(function (n) { return n !== LEDGER; }); return names.length ? names : DEFAULT_TABS; }

  /* ---------- 공통 ---------- */
  function diffFrozen(liveTabs) {
    var out = []; var e = embedded.tabs["1.통합KPI"], l = liveTabs["1.통합KPI"]; if (!e || !l) return out;
    var fy = embedded.meta.frozenYears || []; var yi = e.header.indexOf("연도"), yl = l.header.indexOf("연도");
    e.rows.forEach(function (er) { var y = String(er[yi]); if (fy.indexOf(y) < 0) return; var lr = l.rows.filter(function (r) { return String(r[yl]) === y; })[0]; if (!lr) { out.push({ year: y, col: "(행 없음)", embedded: "있음", live: "없음" }); return; }
      e.header.forEach(function (h, i) { var li = l.header.indexOf(h); if (li < 0) return; var a = er[i], b = lr[li]; if (String(a == null ? "" : a) !== String(b == null ? "" : b)) out.push({ year: y, col: h, embedded: a, live: b }); }); });
    return out;
  }
  function useEmbedded(reason) { state.mode = reason ? "fallback" : (noData() ? "none" : "embedded"); state.error = reason || null; state.tabs = embedded.tabs; state.meta = embedded.meta; state.frozenDiff = []; state.ledgerProgress = null; }
  function configured(s) { if (!s) return false; return s.mode === "appsscript" ? !!s.endpoint : !!(s.clientId && s.sheetId); }
  function refresh() {
    if (!embedded) return Promise.resolve(state);
    var s = settings(); state.authMode = s ? (s.mode === "appsscript" ? "appsscript" : "google") : null;
    if (!configured(s)) { useEmbedded(null); state.needSignIn = false; state.at = new Date(); emit(); return Promise.resolve(state); }
    state.loading = true; emit();
    var p;
    if (s.mode === "appsscript") p = api(s, { action: "tabs", tabs: smallTabs().join(",") }, 90000).then(function (j) { var tabs = {}; smallTabs().forEach(function (n) { var t = j.tabs[n]; if (!t) throw new Error("시트에 탭 없음: " + n); tabs[n] = { header: t.header, rows: t.rows }; }); tabs[LEDGER] = null; return { meta: j.meta || {}, tabs: tabs }; });
    else p = gMeta(s.sheetId).then(function (meta) { var names = smallTabs().filter(function (n) { return meta.tabs[n]; }); var missing = smallTabs().filter(function (n) { return !meta.tabs[n]; }); return gTabs(s.sheetId, names).then(function (tabs) { tabs[LEDGER] = null; meta.missingTabs = missing; return { meta: meta, tabs: tabs }; }); });
    return p.then(function (r) { state.mode = "live"; state.meta = r.meta; state.tabs = r.tabs; state.error = null; state.needSignIn = false; state.at = new Date(); state.frozenDiff = diffFrozen(r.tabs); })
      .catch(function (e) { var msg = e.message || String(e); if (msg === "NEED_SIGNIN") { useEmbedded(null); state.needSignIn = true; state.error = null; } else useEmbedded(msg); state.at = new Date(); })
      .then(function () { state.loading = false; emit(); return state; });
  }
  function ledger(onProgress) {
    if (state.mode !== "live") { var t0 = embedded.tabs[LEDGER]; return t0 ? Promise.resolve(t0) : Promise.reject(new Error("연결 대기 — 구글시트에 연결한 뒤 원문을 읽을 수 있습니다")); }
    if (state.tabs[LEDGER]) return Promise.resolve(state.tabs[LEDGER]);
    var s = settings();
    if (s.mode !== "appsscript") return gLedger(s.sheetId, state.meta, onProgress).then(function (acc) { state.tabs[LEDGER] = acc; return acc; });
    var acc = null, LIMIT = 5000;
    function step(off) { return api(s, { action: "tab", tab: LEDGER, offset: off, limit: LIMIT }, 120000).then(function (j) { if (!acc) acc = { header: j.header, rows: [] }; acc.rows = acc.rows.concat(j.rows); state.ledgerProgress = { loaded: acc.rows.length, total: j.total }; if (onProgress) onProgress(state.ledgerProgress); if (acc.rows.length < j.total && j.rows.length) return step(acc.rows.length); state.tabs[LEDGER] = acc; state.ledgerProgress = null; return acc; }); }
    return step(0);
  }
  function tab(name) { var t = state.tabs && state.tabs[name]; if (t) return t; return embedded ? embedded.tabs[name] : null; }
  /* 연결 테스트: google 은 사용자 클릭에서 호출(로그인 팝업) */
  function test(s) { if (s.mode === "appsscript") return api(s, { action: "meta" }, 30000).then(function (j) { return j.meta; }); if (!s.clientId || !s.sheetId) return Promise.reject(new Error("OAuth 클라이언트 ID 와 시트 ID 를 입력하세요")); var keep = settings(); saveSettings(s); return getToken(true).then(function () { return gMeta(s.sheetId); }).finally(function () { if (keep) localStorage.setItem(KEY, JSON.stringify(keep)); else localStorage.removeItem(KEY); }); }
  function signIn() { return getToken(true).then(function () { return refresh(); }); }
  function signOut() { var t = getStoredToken(); clearToken(); if (t && window.google && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.revoke) { try { google.accounts.oauth2.revoke(t, function () {}); } catch (e) {} } return refresh(); }

  loadEmbedded().then(function () { state.ready = true; state.embeddedMeta = embedded.meta; useEmbedded(null); state.at = new Date(); emit(); return refresh(); })
    .catch(function (e) { state.decodeError = e.message || String(e); state.ready = false; emit(); });

  window.B2BSheet = { noData: noData, state: state, refresh: refresh, tab: tab, ledger: ledger, settings: settings, saveSettings: saveSettings, clearSettings: clearSettings, test: test, signIn: signIn, signOut: signOut, configured: configured, onChange: function (f) { listeners.push(f); }, LEDGER: LEDGER, KEY: KEY };
})();
