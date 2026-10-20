/* ============================================================
   통합 구글시트 데이터 소스 — 업무 트래커 첫 화면용 (v4: 상시 자동 연동)
   · 내장: #b2b-sheet-data (검증본 gzip+base64) → "저장된 데이터" / data-enc="none" → "연결 대기"(회사 데이터 미내장)
   · 실시간 A (권장): Google 로그인(OAuth, spreadsheets.readonly) + Sheets API 직접 읽기
       - 시트를 공유받은 직원만 읽음. 공유 키 없음. 회수 = 시트 공유 해제
       - 방문할 때마다 로그인 상태를 재확인(무음 토큰 갱신 → 안 되면 한 번 클릭), 열린 동안 5분마다 변경 확인
       - 조회한 데이터는 메모리에만 둔다(저장소·캐시에 쓰지 않음) → 로그아웃·접근 취소 시 즉시 삭제
   · 실시간 B (내부 시험용): Apps Script 읽기 전용 웹앱 + 공유 액세스 키(POST 본문) — 승인 직원 제한 불가
   · 동기화 규칙: 한 번의 batchGet 으로 모든 탭을 읽고, 전체 조회가 끝나 검사를 통과한 뒤에만 한꺼번에 교체한다
                  (일부만 최신 값으로 바뀌는 현상 방지). KPI 탭과 원문이 어긋나면 교체하지 않고 이전 스냅샷을 유지한다.
   · 연결 설정은 localStorage "netform.b2b.sheetlink.v1", 로그인 토큰은 sessionStorage 에만. HTML 에 ID·키·토큰 없음.
   · 업무 기록 저장소 "netform.b2b.tracker.v1" 은 읽지도 쓰지도 않는다.
   ============================================================ */
(function () {
  var KEY = "netform.b2b.sheetlink.v1", TKEY = "netform.b2b.sheettoken.v1", UKEY = "netform.b2b.sheetuser.v1";
  var LEDGER = "3.이카운트판매원문";
  var SCOPE = "openid email https://www.googleapis.com/auth/spreadsheets.readonly";
  var SCHEMA = /*__SCHEMA__*/null;                 /* 빌드가 {탭이름:[열 머리글…]} 로 채운다(구조 검사용, 데이터 아님) */
  var GRACE_MS = 15 * 60 * 1000;                   /* 로그인 만료 후 이전 데이터를 보여 주는 최대 시간 */
  var interval = 5 * 60 * 1000;                    /* 자동 확인 주기 */
  var API = function () { return (window.B2B_SHEETS_API_BASE || "https://sheets.googleapis.com") + "/v4/spreadsheets/"; };
  var state = { ready: false, mode: "embedded", authMode: null, meta: null, tabs: null, at: null, error: null, loading: false, ledgerProgress: null, frozenDiff: [], embeddedMeta: null, decodeError: null, needSignIn: false, signedIn: false, email: "", epoch: 0, version: 0,
    sync: { status: "idle", lastOkAt: null, lastAttemptAt: null, nextAt: null, message: "", stale: false, changed: null, fingerprint: "", ledgerCount: null, issues: { missingTabs: [], badTabs: [] }, consistency: [], expiredSince: null, silentBlocked: false, interval: interval } };
  var embedded = null; var listeners = []; var gisReady = null; var timer = null; var syncing = null;
  var DEFAULT_TABS = ["1.통합KPI", "2.시공사마스터", "4.메인자재구매현황", "5.POUR공고낙찰", "5b.POUR반영공고", "6.타사공법낙찰", "7.기술자문문의", "7b.플랫폼가입현황", "8.컨설팅요청", "8b.컨설팅발행이력", "9.샘플카탈로그요청", "10.공법설명회이력", "11.기타문의답변", "12.거래처연결검토", "13.데이터검증변경이력", "14.판매원문차이검증", "15.마스터대조", "16.L2L3전환", "16b.L2L3시공사별", "16c.L2L3판정집계", "16d.L2L3검토이력", "17.장기무활동", "18.선행지표요약", "19.업체명정규화"];
  function expectedTabs() { return SCHEMA ? Object.keys(SCHEMA) : DEFAULT_TABS.concat([LEDGER]); }
  function err(code, msg) { var e = new Error(msg); e.code = code; return e; }

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
  function saveSettings(s) { var old = settings() || {}; localStorage.setItem(KEY, JSON.stringify({ mode: s.mode === "appsscript" ? "appsscript" : "google", clientId: String(s.clientId || "").trim(), sheetId: String(s.sheetId || "").trim(), endpoint: String(s.endpoint || "").trim(), key: String(s.key || ""), signedBefore: !!old.signedBefore, savedAt: new Date().toISOString() })); }
  function patchSettings(p) { var s = settings(); if (!s) return; for (var k in p) s[k] = p[k]; try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSettings() { localStorage.removeItem(KEY); try { localStorage.removeItem(UKEY); } catch (e) {} clearToken(); stopTimer(); }
  function emit() { listeners.forEach(function (f) { try { f(state); } catch (e) {} }); }
  function configured(s) { if (!s) return false; return s.mode === "appsscript" ? !!s.endpoint : !!(s.clientId && s.sheetId); }

  /* ---------- A. Google 로그인 ---------- */
  function getStoredToken() { try { var t = JSON.parse(sessionStorage.getItem(TKEY) || "null"); if (t && t.token && t.exp > Date.now() + 30000) return t.token; } catch (e) {} return null; }
  function storeToken(tok, sec) { try { sessionStorage.setItem(TKEY, JSON.stringify({ token: tok, exp: Date.now() + (Number(sec) || 3600) * 1000 })); } catch (e) {} }
  function clearToken() { try { sessionStorage.removeItem(TKEY); } catch (e) {} state.signedIn = false; }
  function getHint() { try { return (JSON.parse(localStorage.getItem(UKEY) || "null") || {}).email || ""; } catch (e) { return ""; } }
  function loadGis() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (gisReady) return gisReady;
    gisReady = new Promise(function (res, rej) { var s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = function () { res(); }; s.onerror = function () { gisReady = null; rej(err("NET", "Google 로그인 라이브러리를 불러오지 못했습니다(네트워크 확인)")); }; document.head.appendChild(s); });
    return gisReady;
  }
  /* prompt: "none"=무음(화면 없이 갱신, 안 되면 실패) / ""=필요할 때만 화면 표시(첫 로그인·동의) */
  function requestToken(prompt) {
    var s = settings() || {}; if (!s.clientId) return Promise.reject(err("CONFIG", "OAuth 클라이언트 ID 가 없습니다. 연결 설정에서 입력하세요."));
    return loadGis().then(function () { return new Promise(function (res, rej) {
      var done = false; var to = setTimeout(function () { if (!done) { done = true; rej(err("SILENT", "로그인 상태를 자동으로 확인하지 못했습니다(응답 없음)")); } }, prompt === "none" ? 12000 : 180000);
      var tc = google.accounts.oauth2.initTokenClient({ client_id: s.clientId, scope: SCOPE, hint: getHint() || undefined, callback: function (r) { if (done) return; done = true; clearTimeout(to); if (r && r.access_token) { storeToken(r.access_token, r.expires_in); state.signedIn = true; res(r.access_token); } else rej(err(prompt === "none" ? "SILENT" : "AUTH", "로그인이 취소되었거나 토큰을 받지 못했습니다" + (r && r.error ? " (" + r.error + ")" : ""))); }, error_callback: function (e) { if (done) return; done = true; clearTimeout(to); var t = (e && (e.type || e.message)) || "알 수 없음"; rej(err(prompt === "none" ? "SILENT" : "AUTH", "Google 로그인 실패: " + t)); } });
      tc.requestAccessToken({ prompt: prompt });
    }); }).then(function (tok) { return afterSignIn(tok).then(function () { return tok; }); });
  }
  function afterSignIn(tok) {
    state.sync.silentBlocked = false; state.needSignIn = false; patchSettings({ signedBefore: true });
    return fetch((window.B2B_USERINFO_URL || "https://www.googleapis.com/oauth2/v3/userinfo"), { headers: { Authorization: "Bearer " + tok } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (u) { if (u && u.email) { state.email = u.email; try { localStorage.setItem(UKEY, JSON.stringify({ email: u.email })); } catch (e) {} } }).catch(function () {});
  }
  function getToken(interactive) {
    var t = getStoredToken(); if (t) { state.signedIn = true; return Promise.resolve(t); }
    if (!interactive) return Promise.reject(err("NOSESSION", "NEED_SIGNIN"));
    return requestToken("");
  }
  function silentSignIn() { if (state.sync.silentBlocked) return Promise.reject(err("SILENT", "무음 로그인 불가(팝업 차단 또는 추가 동의 필요)")); return requestToken("none").catch(function (e) { state.sync.silentBlocked = true; throw e; }); }

  function gfetch(url, timeoutMs) {
    return getToken(false).then(function (tok) {
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null; var t = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 90000) : null;
      return fetch(url, { headers: { Authorization: "Bearer " + tok }, signal: ctrl ? ctrl.signal : undefined }).then(function (r) {
        if (r.status === 401) { clearToken(); throw err("AUTH", "로그인이 만료되었거나 접근이 취소되었습니다(401)"); }
        if (r.status === 403) throw err("DENIED", "이 계정에는 시트 열람 권한이 없습니다(403). 시트 소유자에게 '뷰어' 공유를 요청하세요.");
        if (r.status === 404) throw err("DENIED", "시트를 찾을 수 없거나 열람 권한이 없습니다(404) — 시트 ID와 공유 상태를 확인하세요.");
        if (r.status === 429) throw err("RATE", "Sheets API 호출 한도 초과 — 잠시 후 자동으로 다시 시도합니다");
        if (!r.ok) throw err("HTTP", "Sheets API 오류(HTTP " + r.status + ")");
        return r.json();
      }, function (e) { throw err(e && e.name === "AbortError" ? "TIMEOUT" : "NET", e && e.name === "AbortError" ? "응답 시간 초과" : "네트워크 연결 실패"); }).finally(function () { if (t) clearTimeout(t); });
    });
  }
  function colLetter(n) { var s = ""; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function q(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
  function norm(vals, header) { var w = header.length; return (vals || []).map(function (r) { var o = new Array(w); for (var i = 0; i < w; i++) { var v = r[i]; o[i] = (v === "" || v === undefined) ? null : v; } return o; }).filter(function (r) { return r.some(function (v) { return v !== null; }); }); }
  /* 탭 목록 + 행 수(A열 길이). 원문 탭은 필요할 때만 센다(큰 탭) */
  function gMeta(sid, countLedger) {
    return gfetch(API() + encodeURIComponent(sid) + "?fields=properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))").then(function (j) {
      var tabs = {}; (j.sheets || []).forEach(function (s) { tabs[s.properties.title] = { rows: null, cols: s.properties.gridProperties.columnCount }; });
      var names = Object.keys(tabs).filter(function (n) { return n !== LEDGER || countLedger; });
      var url = API() + encodeURIComponent(sid) + "/values:batchGet?majorDimension=COLUMNS" + names.map(function (n) { return "&ranges=" + encodeURIComponent(q(n) + "!A:A"); }).join("");
      return gfetch(url).then(function (b) { (b.valueRanges || []).forEach(function (vr, i) { var col = (vr.values && vr.values[0]) || []; tabs[names[i]].rows = Math.max(0, col.length - 1); }); return { source: "sheet", auth: "google", title: j.properties.title, spreadsheetId: sid, lastUpdated: null, servedAt: new Date().toISOString(), tabs: tabs }; });
    });
  }
  /* 모든 탭을 한 번의 batchGet 으로 읽는다(같은 시점의 원본) */
  function gTabs(sid, names) {
    if (!names.length) return Promise.resolve({});
    var url = API() + encodeURIComponent(sid) + "/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING" + names.map(function (n) { return "&ranges=" + encodeURIComponent(q(n)); }).join("");
    return gfetch(url, 120000).then(function (b) { var out = {}; (b.valueRanges || []).forEach(function (vr, i) { var vals = vr.values || []; var header = (vals[0] || []).map(function (h) { return h == null ? "" : String(h); }); out[names[i]] = { header: header, rows: norm(vals.slice(1), header) }; }); return out; });
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
    return fetch(s.endpoint, { method: "POST", redirect: "follow", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), signal: ctrl ? ctrl.signal : undefined }).then(function (r) { if (!r.ok) throw err("HTTP", "HTTP " + r.status); return r.json(); })
      .then(function (j) { if (!j || j.ok !== true) { var m = (j && j.error) || "응답 형식 오류"; throw err(/키 불일치/.test(m) ? "DENIED" : "HTTP", m); } return j; })
      .catch(function (e) { if (e.code) throw e; throw err(e.name === "AbortError" ? "TIMEOUT" : "NET", e.name === "AbortError" ? "응답 시간 초과" : "네트워크 연결 실패"); })
      .finally(function () { if (t) clearTimeout(t); });
  }

  /* ---------- 검사 ---------- */
  function fnv(str, h) { h = h || 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return h; }
  function fingerprint(tabs) { var h = 2166136261; Object.keys(tabs).sort().forEach(function (n) { var t = tabs[n]; if (!t || n === LEDGER) return; h = fnv(n, h); h = fnv(JSON.stringify(t.header), h); h = fnv(JSON.stringify(t.rows), h); }); return h.toString(16); }
  /* 구조 검사: 누락 탭 · 기대 열이 빠진 탭 → 해당 탭은 사용하지 않는다(0 으로 채우지 않음) */
  function validate(meta, tabs) {
    var issues = { missingTabs: [], badTabs: [] };
    expectedTabs().forEach(function (n) {
      if (!meta.tabs[n]) { issues.missingTabs.push(n); delete tabs[n]; return; }
      if (n === LEDGER || !tabs[n] || !SCHEMA) return;
      var miss = SCHEMA[n].filter(function (c) { return tabs[n].header.indexOf(c) < 0; });
      if (miss.length) { issues.badTabs.push({ tab: n, missing: miss }); delete tabs[n]; }
    });
    return issues;
  }
  /* 같은 원본인지: KPI 탭의 연도별 전체자재순매출 = 원문 공급가액 합 (원문이 메모리에 있을 때만) */
  function consistency(tabs, ledger) {
    var k = tabs["1.통합KPI"]; if (!k || !ledger) return [];
    var yi = k.header.indexOf("연도"), si = k.header.indexOf("전체자재순매출"), li = ledger.header.indexOf("연도"), ai = ledger.header.indexOf("공급가액"); if (yi < 0 || si < 0 || li < 0 || ai < 0) return [];
    var sums = {}; ledger.rows.forEach(function (r) { if (typeof r[ai] === "number") { var y = String(r[li]); sums[y] = (sums[y] || 0) + r[ai]; } });
    var out = []; k.rows.forEach(function (r) { var y = String(r[yi]), v = r[si]; if (typeof v !== "number") return; var s = sums[y] || 0; if (Math.abs(v - s) >= 1) out.push({ year: y, kpi: v, ledger: s }); }); return out;
  }
  function diffFrozen(liveTabs) {
    var out = []; if (!embedded || noData()) return out; var e = embedded.tabs["1.통합KPI"], l = liveTabs["1.통합KPI"]; if (!e || !l) return out;
    var fy = embedded.meta.frozenYears || []; var yi = e.header.indexOf("연도"), yl = l.header.indexOf("연도");
    e.rows.forEach(function (er) { var y = String(er[yi]); if (fy.indexOf(y) < 0) return; var lr = l.rows.filter(function (r) { return String(r[yl]) === y; })[0]; if (!lr) { out.push({ year: y, col: "(행 없음)", embedded: "있음", live: "없음" }); return; }
      e.header.forEach(function (h, i) { var li = l.header.indexOf(h); if (li < 0) return; var a = er[i], b = lr[li]; if (String(a == null ? "" : a) !== String(b == null ? "" : b)) out.push({ year: y, col: h, embedded: a, live: b }); }); });
    return out;
  }

  /* ---------- 스냅샷 조회 ---------- */
  function haveLive() { return state.mode === "live" && state.tabs && state.tabs["1.통합KPI"]; }
  function fetchSnapshot(s, prev) {
    var wantLedger = !!(prev && prev.ledger);
    if (s.mode === "appsscript") {
      return api(s, { action: "meta" }, 30000).then(function (mj) { var meta = mj.meta || {}; meta.auth = "appsscript"; var names = expectedTabs().filter(function (n) { return n !== LEDGER && meta.tabs && meta.tabs[n]; });
        return api(s, { action: "tabs", tabs: names.join(",") }, 90000).then(function (j) { var tabs = {}; names.forEach(function (n) { var t = j.tabs[n]; if (t) tabs[n] = { header: t.header, rows: t.rows }; }); return { meta: meta, tabs: tabs, ledger: prev && prev.ledger || null, ledgerReused: true }; }); });
    }
    return gMeta(s.sheetId, wantLedger).then(function (meta) {
      var names = expectedTabs().filter(function (n) { return n !== LEDGER && meta.tabs[n]; });
      return gTabs(s.sheetId, names).then(function (tabs) {
        var fp = fingerprint(tabs); var lcount = wantLedger && meta.tabs[LEDGER] ? meta.tabs[LEDGER].rows : null;
        var changed = !prev || fp !== prev.fp || (wantLedger && lcount !== prev.ledgerCount);
        if (wantLedger && changed) return gLedger(s.sheetId, meta, null).then(function (led) { return { meta: meta, tabs: tabs, ledger: led, fp: fp, ledgerCount: lcount, changed: true }; });
        return { meta: meta, tabs: tabs, ledger: prev && prev.ledger || null, fp: fp, ledgerCount: lcount, changed: changed };
      });
    });
  }
  function apply(snap) {
    var issues = validate(snap.meta, snap.tabs);
    if (snap.ledger) { var ex = SCHEMA && SCHEMA[LEDGER]; if (ex && ex.some(function (c) { return snap.ledger.header.indexOf(c) < 0; })) { issues.badTabs.push({ tab: LEDGER, missing: ex.filter(function (c) { return snap.ledger.header.indexOf(c) < 0; }) }); snap.ledger = null; } }
    var bad = consistency(snap.tabs, snap.ledger);
    var sy = state.sync;
    if (bad.length && haveLive()) { sy.consistency = bad; sy.status = "stale"; sy.stale = true; sy.message = "시트가 갱신 중이거나 KPI와 판매 원문이 일치하지 않아 새 값을 적용하지 않았습니다(이전 스냅샷 유지). 다음 확인에서 다시 시도합니다."; return; }
    var firstLive = state.mode !== "live" || !state.tabs;
    var fp = snap.fp || fingerprint(snap.tabs);
    var ledgerNow = snap.ledger || (state.tabs && state.tabs[LEDGER]) || null;
    var changed = firstLive || fp !== sy.fingerprint || (snap.ledger && snap.ledger !== (state.tabs && state.tabs[LEDGER]));
    var tabs = snap.tabs; tabs[LEDGER] = ledgerNow;
    if (changed) { state.tabs = tabs; state.meta = snap.meta; state.version++; state.frozenDiff = diffFrozen(tabs); } else { state.meta = snap.meta; }
    state.mode = "live"; state.error = null; state.needSignIn = false;
    sy.fingerprint = fp; sy.ledgerCount = snap.ledgerCount != null ? snap.ledgerCount : sy.ledgerCount; sy.issues = issues; sy.consistency = []; sy.changed = firstLive ? null : !!changed; sy.lastOkAt = Date.now(); sy.status = "ok"; sy.stale = false; sy.message = ""; sy.expiredSince = null;
    state.at = new Date();
  }
  /* 접근 취소·로그아웃: 조회한 데이터를 메모리에서 지운다(저장 데이터로 우회 불가) */
  function purge(status, msg) {
    state.tabs = embedded ? embedded.tabs : null; state.meta = embedded ? embedded.meta : null; state.mode = noData() ? "none" : "embedded"; state.frozenDiff = []; state.ledgerProgress = null;
    state.epoch++; state.version++; var sy = state.sync; sy.status = status; sy.message = msg; sy.stale = false; sy.fingerprint = ""; sy.ledgerCount = null; sy.consistency = []; sy.issues = { missingTabs: [], badTabs: [] }; sy.lastOkAt = null; stopTimer();
  }
  function classify(e) {
    var sy = state.sync; var code = (e && e.code) || "NET"; var msg = (e && e.message) || String(e);
    if (code === "NOSESSION" || code === "AUTH" || code === "SILENT" || code === "CONFIG") {
      sy.expiredSince = sy.expiredSince || Date.now(); state.needSignIn = true;
      if (haveLive()) { if (Date.now() - sy.expiredSince > GRACE_MS) { purge("signedout", "로그인 만료 후 " + (GRACE_MS >= 60000 ? Math.round(GRACE_MS / 60000) + "분" : Math.round(GRACE_MS / 1000) + "초") + "이 지나 조회한 데이터를 화면에서 지웠습니다. 다시 로그인하세요."); return; } sy.status = "auth"; sy.stale = true; sy.message = "로그인 상태를 확인하지 못했습니다 — 재로그인이 필요합니다. 표시 중인 값은 이전 데이터입니다."; }
      else { sy.status = "auth"; sy.message = code === "CONFIG" ? msg : "Google 로그인이 필요합니다."; useEmbedded(null); state.needSignIn = true; }
      return;
    }
    if (code === "DENIED") { clearToken(); purge("denied", msg + " 조회한 데이터는 화면에서 지웠습니다."); state.needSignIn = true; return; }
    if (haveLive()) { sy.status = "stale"; sy.stale = true; sy.message = msg + " — 표시 중인 값은 이전 데이터입니다. 다음 자동 확인 때 다시 시도합니다."; }
    else { sy.status = "error"; useEmbedded(msg); }
  }
  function useEmbedded(reason) { state.mode = reason ? "fallback" : (noData() ? "none" : "embedded"); state.error = reason || null; state.tabs = embedded.tabs; state.meta = embedded.meta; state.frozenDiff = []; state.ledgerProgress = null; }

  /* ---------- 동기화 ---------- */
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } state.sync.nextAt = null; }
  function startTimer() { if (timer) return; timer = setInterval(function () { if (document.hidden) return; syncNow("timer"); }, interval); }
  function scheduleNext() { var s = settings(); if (configured(s) && state.sync.status !== "denied" && state.sync.status !== "signedout") { startTimer(); state.sync.nextAt = Date.now() + interval; } }
  function syncNow(reason) {
    if (!embedded) return Promise.resolve(state);
    if (syncing) return syncing;
    var s = settings(); state.authMode = s ? (s.mode === "appsscript" ? "appsscript" : "google") : null;
    if (!configured(s)) { useEmbedded(null); state.needSignIn = false; state.sync.status = "idle"; stopTimer(); state.at = new Date(); emit(); return Promise.resolve(state); }
    state.loading = true; state.sync.status = "syncing"; state.sync.lastAttemptAt = Date.now(); emit();
    var prev = haveLive() ? { fp: state.sync.fingerprint, ledger: state.tabs[LEDGER] || null, ledgerCount: state.sync.ledgerCount } : null;
    function attempt() { return fetchSnapshot(s, prev); }
    syncing = attempt().catch(function (e) {
      if (s.mode !== "appsscript" && (e.code === "AUTH" || e.code === "NOSESSION") && (s.signedBefore || e.code === "AUTH")) return silentSignIn().then(attempt);
      throw e;
    }).then(apply).catch(classify).then(function () { state.loading = false; syncing = null; scheduleNext(); emit(); return state; });
    return syncing;
  }
  function ledger(onProgress) {
    if (state.mode !== "live") { var t0 = embedded.tabs[LEDGER]; return t0 ? Promise.resolve(t0) : Promise.reject(new Error("연결 대기 — 구글시트에 연결한 뒤 원문을 읽을 수 있습니다")); }
    if (state.tabs[LEDGER]) return Promise.resolve(state.tabs[LEDGER]);
    var s = settings(); var ep = state.epoch;
    function done(acc) { if (ep !== state.epoch) return Promise.reject(new Error("로그아웃되어 원문 조회를 취소했습니다")); if (SCHEMA && SCHEMA[LEDGER] && SCHEMA[LEDGER].some(function (c) { return acc.header.indexOf(c) < 0; })) return Promise.reject(new Error("판매 원문 탭의 열 구조가 바뀌어 표시하지 않습니다(누락 열: " + SCHEMA[LEDGER].filter(function (c) { return acc.header.indexOf(c) < 0; }).join(", ") + ")")); state.tabs[LEDGER] = acc; state.sync.ledgerCount = acc.rows.length; state.sync.consistency = consistency(state.tabs, acc); state.version++; emit(); return acc; }
    if (s.mode !== "appsscript") return gMeta(s.sheetId, true).then(function (meta) { if (!meta.tabs[LEDGER]) return Promise.reject(new Error("시트에 '" + LEDGER + "' 탭이 없습니다")); state.sync.ledgerCount = meta.tabs[LEDGER].rows; return gLedger(s.sheetId, meta, onProgress); }).then(done);
    var acc = null, LIMIT = 5000;
    function step(off) { return api(s, { action: "tab", tab: LEDGER, offset: off, limit: LIMIT }, 120000).then(function (j) { if (!acc) acc = { header: j.header, rows: [] }; acc.rows = acc.rows.concat(j.rows); state.ledgerProgress = { loaded: acc.rows.length, total: j.total }; if (onProgress) onProgress(state.ledgerProgress); if (acc.rows.length < j.total && j.rows.length) return step(acc.rows.length); state.ledgerProgress = null; return acc; }); }
    return step(0).then(done);
  }
  function tab(name) { if (state.mode === "live") return (state.tabs && state.tabs[name]) || null; var t = state.tabs && state.tabs[name]; if (t) return t; return embedded ? embedded.tabs[name] || null : null; }
  /* 연결 테스트: google 은 사용자 클릭에서 호출(로그인 팝업) */
  function test(s) { if (s.mode === "appsscript") return api(s, { action: "meta" }, 30000).then(function (j) { return j.meta; }); if (!s.clientId || !s.sheetId) return Promise.reject(new Error("OAuth 클라이언트 ID 와 시트 ID 를 입력하세요")); var keep = settings(); saveSettings(s); return getToken(true).then(function () { return gMeta(s.sheetId, false); }).finally(function () { if (keep) localStorage.setItem(KEY, JSON.stringify(keep)); else localStorage.removeItem(KEY); }); }
  function signIn(opts) { state.sync.silentBlocked = false; return ((opts && opts.select) ? requestToken("select_account") : getToken(true)).then(function () { state.sync.expiredSince = null; return syncNow("signin"); }); }
  function signOut() { var t = getStoredToken(); clearToken(); try { localStorage.removeItem(UKEY); } catch (e) {} patchSettings({ signedBefore: false }); state.email = ""; if (t && window.google && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.revoke) { try { google.accounts.oauth2.revoke(t, function () {}); } catch (e) {} } purge("signedout", "로그아웃했습니다. 조회한 데이터를 화면에서 지웠습니다."); state.needSignIn = configured(settings()); emit(); return Promise.resolve(state); }
  function setSyncInterval(ms, graceMs) { interval = Math.max(1000, Number(ms) || 300000); state.sync.interval = interval; if (graceMs) GRACE_MS = Math.max(1000, Number(graceMs)); stopTimer(); if (configured(settings()) && haveLive()) scheduleNext(); }

  document.addEventListener("visibilitychange", function () { if (!document.hidden && configured(settings()) && state.sync.lastAttemptAt && Date.now() - state.sync.lastAttemptAt >= interval && state.sync.status !== "denied" && state.sync.status !== "signedout") syncNow("resume"); });

  loadEmbedded().then(function () { state.ready = true; state.embeddedMeta = embedded.meta; useEmbedded(null); state.at = new Date(); state.email = getHint(); emit(); return syncNow("load"); })
    .catch(function (e) { state.decodeError = e.message || String(e); state.ready = false; emit(); });

  window.B2BSheet = { noData: noData, state: state, refresh: function () { return syncNow("manual"); }, tab: tab, ledger: ledger, settings: settings, saveSettings: saveSettings, clearSettings: clearSettings, test: test, signIn: signIn, signOut: signOut, configured: configured, onChange: function (f) { listeners.push(f); }, setSyncInterval: setSyncInterval, expectedTabs: expectedTabs, schema: function () { return SCHEMA; }, LEDGER: LEDGER, KEY: KEY };
})();
