/* ============================================================
   통합 구글시트 데이터 소스 — 업무 트래커 첫 화면용 (v6: 공개 보기 기본 · 상세 보기는 기존 Google 로그인 연동)
   · 공개 보기(기본): 로그인·시트 연결 없이 서버(Apps Script)가 자동 집계해 둔 공개용 집계값만 읽는다. 시공사·현장·거래 명세·판매 원문은 이 경로에 없다.
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
    sync: { status: "idle", lastOkAt: null, lastAttemptAt: null, nextAt: null, message: "", stale: false, changed: null, fingerprint: "", ledgerCount: null, issues: { missingTabs: [], badTabs: [] }, consistency: [], expiredSince: null, silentBlocked: false, interval: interval, progress: null, lastError: null, startedAt: null } };
  var embedded = null; var listeners = []; var gisReady = null; var timer = null; var syncing = null;
  var DEFAULT_TABS = ["1.통합KPI", "2.시공사마스터", "4.메인자재구매현황", "5.POUR공고낙찰", "5b.POUR반영공고", "6.타사공법낙찰", "7.기술자문문의", "7b.플랫폼가입현황", "8.컨설팅요청", "8b.컨설팅발행이력", "9.샘플카탈로그요청", "10.공법설명회이력", "11.기타문의답변", "12.거래처연결검토", "13.데이터검증변경이력", "14.판매원문차이검증", "15.마스터대조", "16.L2L3전환", "16b.L2L3시공사별", "16c.L2L3판정집계", "16d.L2L3검토이력", "17.장기무활동", "18.선행지표요약", "19.업체명정규화"];
  var EXTRA_TABS = ["21.잔디등_L3활동", "22.영업보고", "23.경로전환_시공사별", "24.경로전환_조합", "25.경로전환_현장별"];   /* 선택 탭: 있으면 읽고 없으면 건너뜀 */
  function readTabs() { return expectedTabs().concat(EXTRA_TABS); }
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
  function saveSettings(s) { var old = settings() || {}; localStorage.setItem(KEY, JSON.stringify({ view: s.view || old.view || "public", mode: s.mode === "appsscript" ? "appsscript" : "google", clientId: String(s.clientId || "").trim(), sheetId: String(s.sheetId || "").trim(), endpoint: String(s.endpoint || "").trim(), key: String(s.key || ""), signedBefore: !!old.signedBefore, savedAt: new Date().toISOString() })); }
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
    gisReady = new Promise(function (res, rej) { var to = setTimeout(function () { gisReady = null; rej(err("NET", "Google 로그인 라이브러리 응답 없음(15초) — 네트워크 또는 차단을 확인하세요")); }, 15000); var s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.onload = function () { clearTimeout(to); res(); }; s.onerror = function () { clearTimeout(to); gisReady = null; rej(err("NET", "Google 로그인 라이브러리를 불러오지 못했습니다(네트워크 확인)")); }; document.head.appendChild(s); });
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
    return Promise.race([sleep(8000), fetch((window.B2B_USERINFO_URL || "https://www.googleapis.com/oauth2/v3/userinfo"), { headers: { Authorization: "Bearer " + tok } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (u) { if (u && u.email) { state.email = u.email; try { localStorage.setItem(UKEY, JSON.stringify({ email: u.email })); } catch (e) {} } }).catch(function () {})]);
  }
  function getToken(interactive) {
    var t = getStoredToken(); if (t) { state.signedIn = true; return Promise.resolve(t); }
    if (!interactive) return Promise.reject(err("NOSESSION", "NEED_SIGNIN"));
    return requestToken("");
  }
  function silentSignIn() { if (state.sync.silentBlocked) return Promise.reject(err("SILENT", "무음 로그인 불가(팝업 차단 또는 추가 동의 필요)")); return requestToken("none").catch(function (e) { state.sync.silentBlocked = true; throw e; }); }

  /* ---- v5: 요청 단위 타임아웃·재시도·취소·진단 로그 (데이터·토큰은 기록하지 않음) ---- */
  var REQ_TIMEOUT = 45000, SYNC_DEADLINE = 180000, GROUP_SIZE = 6, CONC = 2, LEDGER_CHUNK = 4000, LEDGER_CONC = 3;
  var logBuf = [], inflight = [], abortGen = 0;
  function logd(label, status, ms, kb, attempt) { logBuf.push({ t: Date.now(), label: label, status: status, ms: ms, kb: kb, attempt: attempt }); if (logBuf.length > 300) logBuf.shift(); }
  function getLog() { return logBuf.slice(); }
  function setProgress(label, done, total) { state.sync.progress = { label: label, done: done, total: total, at: Date.now() }; emit(); }
  function BIG() { return Math.round(REQ_TIMEOUT * 1.5); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function abortInflight() { abortGen++; inflight.slice().forEach(function (rec) { rec.cancelled = true; try { if (rec.ctrl) rec.ctrl.abort(); } catch (e) {} }); }
  function httpErr(status, txt) {
    var m = "", st = ""; try { var j = JSON.parse(txt); if (j && j.error) { m = String(j.error.message || ""); st = String(j.error.status || ""); } } catch (e) {}
    var hay = st + " " + m;
    if (status === 401) return err("AUTH", "로그인이 만료되었거나 접근이 취소되었습니다(401)");
    if (status === 403) {
      if (/SERVICE_DISABLED|has not been used|is disabled|accessNotConfigured/i.test(hay)) return err("APIOFF", "이 Google Cloud 프로젝트에서 'Google Sheets API' 가 꺼져 있습니다(403). 관리자: Cloud 콘솔 → API 및 서비스 → 라이브러리 → Google Sheets API → 사용 설정, 1~2분 뒤 다시 시도하세요.");
      if (/RESOURCE_EXHAUSTED|rate|quota/i.test(hay)) return err("RATE", "Sheets API 호출 한도 초과(403) — 잠시 후 자동으로 다시 시도합니다");
      if (/insufficient|scope/i.test(hay)) return err("DENIED", "이 로그인에 시트 읽기 권한 범위(spreadsheets.readonly)가 없습니다(403). 로그인 창에서 '스프레드시트 보기' 권한을 허용하세요.");
      return err("DENIED", "이 계정에는 시트 열람 권한이 없습니다(403). 시트 소유자에게 '뷰어' 공유를 요청하세요.");
    }
    if (status === 404) return err("DENIED", "시트를 찾을 수 없거나 열람 권한이 없습니다(404) — 시트 ID와 공유 상태를 확인하세요.");
    if (status === 429) return err("RATE", "Sheets API 호출 한도 초과(429) — 잠시 후 자동으로 다시 시도합니다");
    if (status === 400) return err("BADREQ", "Sheets API 가 요청을 거절했습니다(400) — 탭 이름 또는 범위가 시트와 맞지 않습니다.");
    return err("HTTP", "Sheets API 오류(HTTP " + status + ")");
  }
  /* 요청 1건: 개별 타임아웃 + 재시도(네트워크·시간초과·5xx·한도) — 세부 로그만 남긴다 */
  function gfetch(url, o) {
    o = o || {}; var timeout = o.timeout || REQ_TIMEOUT, retries = o.retries == null ? 2 : o.retries, label = o.label || "요청", gen = abortGen;
    function once(n) {
      return getToken(false).then(function (tok) {
        var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null; var rec = { ctrl: ctrl, cancelled: false, timedOut: false }; inflight.push(rec);
        var t0 = Date.now(); var tm = ctrl ? setTimeout(function () { rec.timedOut = true; try { ctrl.abort(); } catch (e) {} }, timeout) : null;
        function fin() { if (tm) clearTimeout(tm); var i = inflight.indexOf(rec); if (i >= 0) inflight.splice(i, 1); }
        return fetch(url, { headers: { Authorization: "Bearer " + tok }, signal: ctrl ? ctrl.signal : undefined })
          .then(function (r) { return r.text().then(function (txt) { return { st: r.status, ok: r.ok, txt: txt }; }); })
          .then(function (x) {
            fin(); logd(label, x.st, Date.now() - t0, Math.round(x.txt.length / 1024), n);
            if (!x.ok) { var he = httpErr(x.st, x.txt); if (he.code === "AUTH") clearToken(); throw he; }
            try { return JSON.parse(x.txt); } catch (e) { throw err("HTTP", "Sheets API 응답을 해석하지 못했습니다 — " + label); }
          }, function (e) {
            fin(); var to = rec.timedOut; logd(label, rec.cancelled ? "CANCEL" : (to ? "TIMEOUT" : "NET"), Date.now() - t0, 0, n);
            if (rec.cancelled) throw err("CANCEL", "동기화를 취소했습니다");
            throw err(to ? "TIMEOUT" : "NET", to ? "응답 시간 초과(" + Math.round(timeout / 1000) + "초) — " + label : "네트워크 연결 실패 — " + label);
          });
      });
    }
    function run(n) { return once(n).catch(function (e) { var again = (e.code === "NET" || e.code === "TIMEOUT" || e.code === "HTTP" || e.code === "RATE") && n <= retries && gen === abortGen; if (!again) throw e; return sleep((e.code === "RATE" ? 3000 : 700) * n + Math.round(Math.random() * 300)).then(function () { return run(n + 1); }); }); }
    return run(1);
  }
  function pool(items, conc, fn) {
    return new Promise(function (resolve, reject) {
      var res = new Array(items.length), i = 0, active = 0, failed = false; if (!items.length) return resolve(res);
      function next() { if (failed) return; if (i >= items.length) { if (active === 0) resolve(res); return; } var k = i++; active++;
        Promise.resolve().then(function () { return fn(items[k], k); }).then(function (v) { res[k] = v; active--; next(); }, function (e) { if (!failed) { failed = true; reject(e); } }); }
      for (var c = 0; c < Math.min(conc, items.length); c++) next();
    });
  }
  function colLetter(n) { var s = ""; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function q(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }
  function norm(vals, header) { var w = header.length; return (vals || []).map(function (r) { var o = new Array(w); for (var i = 0; i < w; i++) { var v = r[i]; o[i] = (v === "" || v === undefined) ? null : v; } return o; }).filter(function (r) { return r.some(function (v) { return v !== null; }); }); }
  /* 탭 목록 + 행 수(A열 길이). 원문 탭은 필요할 때만 센다(큰 탭) */
  function gMeta(sid, countLedger) {
    return gfetch(API() + encodeURIComponent(sid) + "?fields=properties.title,sheets.properties(title,gridProperties(rowCount,columnCount))", { label: "시트 정보" }).then(function (j) {
      var tabs = {}; (j.sheets || []).forEach(function (s) { var g = s.properties.gridProperties || {}; tabs[s.properties.title] = { rows: null, cols: g.columnCount || 26, grid: g.rowCount || 0 }; });
      var names = Object.keys(tabs).filter(function (n) { return n !== LEDGER || countLedger; });
      var url = API() + encodeURIComponent(sid) + "/values:batchGet?majorDimension=COLUMNS" + names.map(function (n) { return "&ranges=" + encodeURIComponent(q(n) + "!A:A"); }).join("");
      return gfetch(url, { label: "행 수 확인", timeout: BIG() }).then(function (b) { (b.valueRanges || []).forEach(function (vr, i) { var col = (vr.values && vr.values[0]) || []; tabs[names[i]].rows = Math.max(0, col.length - 1); }); return { source: "sheet", auth: "google", title: (j.properties || {}).title || "", spreadsheetId: sid, lastUpdated: null, servedAt: new Date().toISOString(), tabs: tabs }; });
    });
  }
  function parseTabs(b, names) { var out = {}; (b.valueRanges || []).forEach(function (vr, i) { var vals = vr.values || []; var header = (vals[0] || []).map(function (h) { return h == null ? "" : String(h); }); out[names[i]] = { header: header, rows: norm(vals.slice(1), header) }; }); return out; }
  function gTabs(sid, names, label) {
    if (!names.length) return Promise.resolve({});
    var url = API() + encodeURIComponent(sid) + "/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING" + names.map(function (n) { return "&ranges=" + encodeURIComponent(q(n)); }).join("");
    return gfetch(url, { label: label || "탭 읽기", timeout: BIG() }).then(function (b) { return parseTabs(b, names); });
  }
  function tabSig(t) { if (!t) return ""; return fnv(JSON.stringify(t.header) + JSON.stringify(t.rows)).toString(16); }
  /* 탭을 6개씩 나눠 읽는다(요청 1건이 너무 커서 멈추는 일 방지). 끝에 KPI 탭을 다시 읽어 읽는 도중 시트가 바뀌었는지 확인 */
  function gTabsAll(sid, names, onProgress) {
    var groups = []; for (var i = 0; i < names.length; i += GROUP_SIZE) groups.push(names.slice(i, i + GROUP_SIZE));
    var done = 0, total = names.length; if (onProgress) onProgress("탭 읽는 중", 0, total);
    return pool(groups, CONC, function (g, gi) { return gTabs(sid, g, "탭 읽기 " + (gi + 1) + "/" + groups.length + " (" + g[0] + (g.length > 1 ? " 외 " + (g.length - 1) : "") + ")").then(function (r) { done += g.length; if (onProgress) onProgress("탭 읽는 중", done, total); return r; }); }).then(function (parts) {
      var out = {}; parts.forEach(function (p) { for (var k in p) out[k] = p[k]; });
      var K = "1.통합KPI"; if (!out[K]) return out;
      return gTabs(sid, [K], "KPI 재확인").then(function (again) { if (tabSig(again[K]) !== tabSig(out[K])) throw err("CHANGING", "읽는 도중 시트가 수정되어 이번 조회를 버렸습니다 — 곧 다시 시도합니다"); return out; });
    });
  }
  /* 판매 원문: 4,000행씩 나눠 3개 동시 조회 */
  function gLedger(sid, meta, onProgress) {
    var cols = (meta.tabs[LEDGER] || {}).cols || 26, total = (meta.tabs[LEDGER] || {}).rows || 0, L = colLetter(cols);
    return gfetch(API() + encodeURIComponent(sid) + "/values/" + encodeURIComponent(q(LEDGER) + "!A1:" + L + "1"), { label: "원문 머리글" }).then(function (h) {
      var header = ((h.values || [])[0] || []).map(function (x) { return x == null ? "" : String(x); });
      var ranges = []; for (var s = 2; s <= total + 1; s += LEDGER_CHUNK) ranges.push([s, Math.min(s + LEDGER_CHUNK - 1, total + 1)]);
      var loaded = 0; state.ledgerProgress = { loaded: 0, total: total }; if (onProgress) onProgress(state.ledgerProgress);
      return pool(ranges, LEDGER_CONC, function (r, ri) {
        return gfetch(API() + encodeURIComponent(sid) + "/values/" + encodeURIComponent(q(LEDGER) + "!A" + r[0] + ":" + L + r[1]) + "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING", { label: "원문 " + (ri + 1) + "/" + ranges.length, timeout: BIG() })
          .then(function (j) { var rows = norm(j.values, header); loaded += rows.length; state.ledgerProgress = { loaded: loaded, total: total }; if (onProgress) onProgress(state.ledgerProgress); return rows; });
      }).then(function (parts) { var rows = []; parts.forEach(function (p) { for (var i = 0; i < p.length; i++) rows.push(p[i]); }); state.ledgerProgress = null; return { header: header, rows: rows }; }, function (e) { state.ledgerProgress = null; throw e; });
    });
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
      return api(s, { action: "meta" }, 30000).then(function (mj) { var meta = mj.meta || {}; meta.auth = "appsscript"; var names = readTabs().filter(function (n) { return n !== LEDGER && meta.tabs && meta.tabs[n]; });
        return api(s, { action: "tabs", tabs: names.join(",") }, 90000).then(function (j) { var tabs = {}; names.forEach(function (n) { var t = j.tabs[n]; if (t) tabs[n] = { header: t.header, rows: t.rows }; }); return { meta: meta, tabs: tabs, ledger: prev && prev.ledger || null, ledgerReused: true }; }); });
    }
    setProgress("시트 정보 확인", 0, 1);
    return gMeta(s.sheetId, wantLedger).then(function (meta) {
      var names = readTabs().filter(function (n) { return n !== LEDGER && meta.tabs[n]; });
      return gTabsAll(s.sheetId, names, setProgress).then(function (tabs) {
        var fp = fingerprint(tabs); var lcount = wantLedger && meta.tabs[LEDGER] ? meta.tabs[LEDGER].rows : null;
        var changed = !prev || fp !== prev.fp || (wantLedger && lcount !== prev.ledgerCount);
        if (wantLedger && changed) return gLedger(s.sheetId, meta, function (p) { setProgress("판매 원문 읽는 중", p.loaded, p.total); }).then(function (led) { return { meta: meta, tabs: tabs, ledger: led, fp: fp, ledgerCount: lcount, changed: true }; });
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
    sy.fingerprint = fp; sy.ledgerCount = snap.ledgerCount != null ? snap.ledgerCount : sy.ledgerCount; sy.issues = issues; sy.consistency = []; sy.changed = firstLive ? null : !!changed; sy.lastOkAt = Date.now(); sy.status = "ok"; sy.stale = false; sy.message = ""; sy.expiredSince = null; sy.lastError = null; sy.progress = null;
    state.at = new Date();
  }
  /* 접근 취소·로그아웃: 조회한 데이터를 메모리에서 지운다(저장 데이터로 우회 불가) */
  function purge(status, msg) {
    state.tabs = embedded ? embedded.tabs : null; state.meta = embedded ? embedded.meta : null; state.mode = noData() ? "none" : "embedded"; state.frozenDiff = []; state.ledgerProgress = null;
    state.epoch++; state.version++; var sy = state.sync; sy.status = status; sy.message = msg; sy.stale = false; sy.fingerprint = ""; sy.ledgerCount = null; sy.consistency = []; sy.issues = { missingTabs: [], badTabs: [] }; sy.lastOkAt = null; stopTimer();
  }
  function classify(e) {
    var sy = state.sync; var code = (e && e.code) || "INTERNAL"; var msg = (e && e.message) || String(e); sy.lastError = { code: code, message: msg, at: Date.now() };
    if (code === "NOSESSION" || code === "AUTH" || code === "SILENT" || code === "CONFIG") {
      sy.expiredSince = sy.expiredSince || Date.now(); state.needSignIn = true;
      if (haveLive()) { if (Date.now() - sy.expiredSince > GRACE_MS) { purge("signedout", "로그인 만료 후 " + (GRACE_MS >= 60000 ? Math.round(GRACE_MS / 60000) + "분" : Math.round(GRACE_MS / 1000) + "초") + "이 지나 조회한 데이터를 화면에서 지웠습니다. 다시 로그인하세요."); return; } sy.status = "auth"; sy.stale = true; sy.message = "로그인 상태를 확인하지 못했습니다 — 재로그인이 필요합니다. 표시 중인 값은 이전 데이터입니다."; }
      else { sy.status = "auth"; sy.message = code === "CONFIG" ? msg : "Google 로그인이 필요합니다."; useEmbedded(null); state.needSignIn = true; }
      return;
    }
    if (code === "CHANGING") { setTimeout(function () { if (!syncing && configured(settings()) && state.sync.status !== "denied" && state.sync.status !== "signedout") syncNow("retry"); }, 15000); }
    if (code === "DENIED") { clearToken(); purge("denied", msg + " 조회한 데이터는 화면에서 지웠습니다."); state.needSignIn = true; return; }
    if (haveLive()) { sy.status = "stale"; sy.stale = true; sy.message = msg + " — 표시 중인 값은 이전 데이터입니다. 다음 자동 확인 때 다시 시도합니다."; }
    else { sy.status = "error"; useEmbedded(msg); }
  }
  function useEmbedded(reason) { state.mode = reason ? "fallback" : (noData() ? "none" : "embedded"); state.error = reason || null; state.tabs = embedded.tabs; state.meta = embedded.meta; state.frozenDiff = []; state.ledgerProgress = null; }

  /* ---------- 공개 보기(기본): 로그인·시트 연결 없이 공개용 집계값을 읽는다 ---------- */
  var PUBCONF = "./public-config.json"; var pubInflight = null, pubUrlCache = null;
  state.view = "public"; state.pub = { status: "idle", data: null, error: null, checkedAt: null, hash: null, url: null, serve: null };
  function isLocalHost() { var h = location.hostname; return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === ""; }
  function viewPref() { var s = settings(); return s && s.view === "detail" && configured(s) ? "detail" : "public"; }
  function okPubUrl(u) { return typeof u === "string" && u && (/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u) || /^\.{0,2}\/[\w./-]+$/.test(u) || isLocalHost()); }
  function pubUrl() {
    if (pubUrlCache) return Promise.resolve(pubUrlCache);
    var q = null; try { q = new URLSearchParams(location.search).get("pub"); } catch (e) {}
    if (q && isLocalHost()) { pubUrlCache = q; return Promise.resolve(q); }          /* 시험용: 로컬 주소에서만 ?pub= 허용(링크로 가짜 수치를 보여 주는 것을 막음) */
    if (okPubUrl(window.B2B_PUBLIC_URL)) { pubUrlCache = window.B2B_PUBLIC_URL; return Promise.resolve(pubUrlCache); }
    return fetch(PUBCONF, { cache: "no-store", credentials: "omit" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { var u = j && j.url; if (okPubUrl(u)) { pubUrlCache = u; return u; } return null; });
  }
  function fetchPublic(url) {
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 25000);
    var u = url + (url.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
    return fetch(u, { cache: "no-store", credentials: "omit", redirect: "follow", signal: ctl ? ctl.signal : undefined })
      .catch(function (e) { throw err(e && e.name === "AbortError" ? "TIMEOUT" : "NET", e && e.name === "AbortError" ? "공개 데이터 응답 시간 초과(25초)" : "공개 데이터를 불러오지 못했습니다(네트워크 확인)"); })
      .then(function (r) { if (!r.ok) throw err("HTTP", "공개 데이터 서버 응답 오류(" + r.status + ")"); return r.text(); })
      .then(function (txt) { clearTimeout(to); if (txt.length > 3000000) throw err("PUBBAD", "공개 데이터가 너무 큽니다"); var j; try { j = JSON.parse(txt); } catch (e) { throw err("PUBBAD", "공개 데이터 형식 오류(JSON 아님)"); } if (j && j.ok === false) throw err("PUBNO", j.message || "공개 데이터가 아직 없습니다"); var bad = window.B2BPublicPack ? window.B2BPublicPack.validate(j) : "공개 데이터 검증 모듈을 불러오지 못했습니다"; if (bad) throw err("PUBBAD", "공개 데이터 검증 실패: " + bad); return j; }, function (e) { clearTimeout(to); throw e; });
  }
  function applyPublic(j) {
    var sy = state.sync, p = state.pub, first = state.mode !== "public" || !p.data, changed = first || p.hash !== j.meta.hash;
    if (state.mode !== "public") state.epoch++;                                     /* 상세 보기에서 넘어온 화면 쪽 사본을 지운다 */
    if (changed) { var tabs = {}; Object.keys(j.tabs).forEach(function (n) { tabs[n] = { header: j.tabs[n].header, rows: j.tabs[n].rows }; }); state.tabs = tabs; state.version++; state.frozenDiff = []; }
    state.meta = { source: "public", title: "공개 집계", auth: "public", servedAt: j.meta.generatedAt, tabs: {} };
    p.status = "ok"; p.data = j; p.error = null; p.hash = j.meta.hash; p.checkedAt = Date.now(); p.serve = j.serve || null;
    state.mode = "public"; state.error = null; state.needSignIn = false; state.at = new Date();
    var stale = !!(j.serve && j.serve.state && j.serve.state !== "ok");
    sy.status = stale ? "stale" : "ok"; sy.stale = stale; sy.message = stale ? (j.serve.message || "새 집계 게시가 보류되어 이전 정상 집계를 표시합니다") : ""; sy.lastOkAt = Date.now(); sy.changed = first ? null : !!changed; sy.lastError = null; sy.progress = null; sy.consistency = []; sy.issues = { missingTabs: [], badTabs: [] };
  }
  function classifyPublic(e) {
    var sy = state.sync, p = state.pub, code = (e && e.code) || "INTERNAL", msg = (e && e.message) || String(e); sy.lastError = { code: code, message: msg, at: Date.now() }; p.error = { code: code, message: msg };
    if (p.data && state.mode === "public") { p.status = "stale"; sy.status = "stale"; sy.stale = true; sy.message = msg + " — 표시 중인 값은 마지막으로 받은 공개 집계입니다. 다음 자동 확인 때 다시 시도합니다."; return; }
    p.status = "error"; sy.status = "error"; sy.stale = false; sy.message = msg; useEmbedded(msg);
  }
  function syncPublic(reason) {
    if (pubInflight) return pubInflight; var sy = state.sync;
    state.loading = true; if (!state.pub.data || state.mode !== "public") sy.status = "syncing"; sy.lastAttemptAt = Date.now(); sy.startedAt = Date.now(); emit();
    pubInflight = pubUrl().then(function (url) { if (!url) throw err("PUBCONF", "공개 데이터 주소가 설정되지 않았습니다"); state.pub.url = url; return fetchPublic(url); }).then(applyPublic)
      .catch(function (e) { try { classifyPublic(e); } catch (x) { sy.status = "error"; sy.message = String((x && x.message) || x); } })
      .then(function () { state.loading = false; pubInflight = null; sy.startedAt = null; startTimer(); sy.nextAt = Date.now() + interval; state.at = new Date(); emit(); return state; });
    return pubInflight;
  }
  /* 보기 전환: 'public'(기본) ↔ 'detail'(기존 Google 로그인 연동 — 시트를 공유받은 직원용). 한쪽 데이터는 전환 시 메모리에서 지운다 */
  function setViewMode(v) {
    if (v === "detail") { var s0 = settings(); if (!configured(s0)) return Promise.reject(err("CONFIG", "상세 보기에는 연결 설정(OAuth 클라이언트 ID·시트 ID)이 필요합니다")); patchSettings({ view: "detail" }); }
    else patchSettings({ view: "public" });
    abortInflight(); stopTimer(); var sy = state.sync;
    state.epoch++; state.version++; state.tabs = embedded ? embedded.tabs : null; state.meta = embedded ? embedded.meta : null; state.mode = noData() ? "none" : "embedded"; state.frozenDiff = []; state.ledgerProgress = null; state.needSignIn = false; state.pub.hash = null; state.pub.data = null; state.pub.status = "idle";
    sy.fingerprint = ""; sy.ledgerCount = null; sy.consistency = []; sy.lastOkAt = null; sy.status = "idle"; sy.stale = false; sy.message = ""; sy.issues = { missingTabs: [], badTabs: [] };
    return syncNow("switch");
  }

  /* ---------- 동기화 ---------- */
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } state.sync.nextAt = null; }
  function startTimer() { if (timer) return; timer = setInterval(function () { if (document.hidden) return; syncNow("timer"); }, interval); }
  function scheduleNext() { var s = settings(); if (configured(s) && state.sync.status !== "denied" && state.sync.status !== "signedout") { startTimer(); state.sync.nextAt = Date.now() + interval; } }
  var runSeq = 0, curCancel = null;
  /* 동기화 1회: 어떤 경우에도 끝난다 — 전체 제한시간(워치독)·개별 요청 타임아웃·취소·예외 모두 finish 로 수렴 */
  function syncNow(reason) {
    if (!embedded) return Promise.resolve(state);
    if (viewPref() === "public") { state.view = "public"; state.authMode = null; return syncPublic(reason); }
    state.view = "detail"; if (syncing) return syncing;
    var s = settings(); state.authMode = s ? (s.mode === "appsscript" ? "appsscript" : "google") : null;
    if (!configured(s)) { useEmbedded(null); state.needSignIn = false; state.sync.status = "idle"; stopTimer(); state.at = new Date(); emit(); return Promise.resolve(state); }
    var sy = state.sync, run = ++runSeq, token = { dead: false }, wd = null, rejWd = null;
    state.loading = true; sy.status = "syncing"; sy.lastAttemptAt = Date.now(); sy.startedAt = Date.now(); sy.progress = null; emit();
    var prev = haveLive() ? { fp: sy.fingerprint, ledger: state.tabs[LEDGER] || null, ledgerCount: sy.ledgerCount } : null;
    function attempt() { return fetchSnapshot(s, prev); }
    var wdp = new Promise(function (_, rej) { rejWd = rej; });
    wd = setTimeout(function () { token.dead = true; abortInflight(); rejWd(err("DEADLINE", "동기화가 " + Math.round(SYNC_DEADLINE / 1000) + "초 안에 끝나지 않아 중단했습니다.")); }, SYNC_DEADLINE);
    curCancel = function () { token.dead = true; abortInflight(); rejWd(err("CANCEL", "동기화를 취소했습니다.")); };
    var work = Promise.resolve().then(attempt).catch(function (e) {
      if (s.mode !== "appsscript" && (e.code === "AUTH" || e.code === "NOSESSION") && (s.signedBefore || e.code === "AUTH")) return silentSignIn().then(attempt);
      throw e;
    }).then(function (snap) { if (token.dead) throw err("CANCEL", "동기화를 취소했습니다."); apply(snap); });
    work.catch(function () {});
    syncing = Promise.race([work, wdp]).catch(function (e) {
      try { classify(e); } catch (x) { sy.lastError = { code: "INTERNAL", message: String((x && x.message) || x), at: Date.now() }; sy.status = haveLive() ? "stale" : "error"; sy.stale = haveLive(); sy.message = "동기화 결과를 처리하는 중 오류가 났습니다: " + String((x && x.message) || x); }
    }).then(function () {
      clearTimeout(wd); if (run === runSeq) curCancel = null;
      state.loading = false; syncing = null; sy.startedAt = null; sy.progress = null;
      if (sy.status === "syncing") { sy.status = haveLive() ? "stale" : "error"; sy.stale = haveLive(); if (!sy.message) sy.message = "동기화가 정상적으로 끝나지 않았습니다. 다시 시도해 주세요."; }
      try { scheduleNext(); } catch (e) {}
      emit(); return state;
    });
    return syncing;
  }
  function cancelSync() { if (curCancel) curCancel(); }
  /* 시험·점검용: 제한값 조정(회사 데이터와 무관) */
  function setLimits(o) { o = o || {}; if (o.reqTimeout) REQ_TIMEOUT = o.reqTimeout; if (o.deadline) SYNC_DEADLINE = o.deadline; if (o.group) GROUP_SIZE = o.group; if (o.conc) CONC = o.conc; if (o.ledgerChunk) LEDGER_CHUNK = o.ledgerChunk; if (o.ledgerConc) LEDGER_CONC = o.ledgerConc; return { reqTimeout: REQ_TIMEOUT, deadline: SYNC_DEADLINE, group: GROUP_SIZE, conc: CONC, ledgerChunk: LEDGER_CHUNK, ledgerConc: LEDGER_CONC }; }
  /* 연결 진단: 단계별 상태·소요시간만 기록(셀 값·토큰·시트 ID 는 기록하지 않음). 사용자 클릭에서 호출 */
  function diagnose(onStep) {
    var rep = { startedAt: Date.now(), steps: [], ok: false, totalMs: 0 }; var s = settings();
    function push(name) { var st = { name: name, ok: null, ms: 0, detail: "" }; rep.steps.push(st); return st; }
    function tick() { if (onStep) { try { onStep(rep); } catch (e) {} } }
    function step(name, fn) {
      var st = push(name), t0 = Date.now(); tick();
      return Promise.resolve().then(fn).then(function (d) { st.ok = true; st.ms = Date.now() - t0; st.detail = d || ""; tick(); }, function (e) { st.ok = false; st.ms = Date.now() - t0; st.detail = (e && e.code ? "[" + e.code + "] " : "") + String((e && e.message) || e); tick(); throw e; });
    }
    if (!configured(s) || s.mode === "appsscript") { var st0 = push("연결 설정"); st0.ok = false; st0.detail = "Google 로그인 방식(A)이 설정되어 있지 않습니다."; rep.totalMs = 0; tick(); return Promise.resolve(rep); }
    var meta = null, names = [];
    return step("로그인 토큰", function () { return getToken(true).then(function () { return "토큰 있음"; }); })
      .then(function () { return step("시트 정보·행 수 (1/2 요청)", function () { return gMeta(s.sheetId, true).then(function (m) { meta = m; var have = Object.keys(m.tabs); var miss = expectedTabs().filter(function (n) { return !m.tabs[n]; }); names = expectedTabs().filter(function (n) { return n !== LEDGER && m.tabs[n]; }); return "탭 " + have.length + "개 확인" + (miss.length ? " · 누락 " + miss.length + "개: " + miss.join(", ") : "") + " · 원문 " + (m.tabs[LEDGER] ? m.tabs[LEDGER].rows : "-") + "행"; }); }); })
      .then(function () {
        var groups = []; for (var i = 0; i < names.length; i += GROUP_SIZE) groups.push(names.slice(i, i + GROUP_SIZE));
        var chain = Promise.resolve();
        groups.forEach(function (g, gi) { chain = chain.then(function () { return step("탭 읽기 " + (gi + 1) + "/" + groups.length + " (" + g.length + "개)", function () { var t0 = Date.now(); return gTabs(s.sheetId, g, "진단 탭 " + (gi + 1)).then(function (r) { var rows = 0; for (var k in r) rows += r[k].rows.length; var last = getLog()[getLog().length - 1] || {}; return g.length + "개 탭 · " + rows + "행 · " + (last.kb || 0) + "KB"; }); }); }); });
        return chain;
      })
      .then(function () { var L = meta && meta.tabs[LEDGER]; if (!L) return null; return step("판매 원문 첫 1,000행", function () { return gfetch(API() + encodeURIComponent(s.sheetId) + "/values/" + encodeURIComponent(q(LEDGER) + "!A1:" + colLetter(L.cols || 26) + "1000") + "?valueRenderOption=UNFORMATTED_VALUE", { label: "진단 원문", timeout: BIG() }).then(function (j) { var last = getLog()[getLog().length - 1] || {}; return ((j.values || []).length - 1) + "행 · " + (last.kb || 0) + "KB"; }); }); })
      .catch(function () {})
      .then(function () { rep.ok = rep.steps.length > 0 && rep.steps.every(function (x) { return x.ok === true; }); rep.totalMs = Date.now() - rep.startedAt; tick(); return rep; });
  }
  function ledger(onProgress) {
    if (state.mode === "public") return Promise.reject(new Error("공개 보기에서는 판매 원문을 제공하지 않습니다 — 상세 보기(로그인)에서 열람할 수 있습니다"));
    if (state.mode !== "live") { var t0 = embedded.tabs[LEDGER]; return t0 ? Promise.resolve(t0) : Promise.reject(new Error("연결 대기 — 구글시트에 연결한 뒤 원문을 읽을 수 있습니다")); }
    if (state.tabs[LEDGER]) return Promise.resolve(state.tabs[LEDGER]);
    var s = settings(); var ep = state.epoch;
    function done(acc) { if (ep !== state.epoch) return Promise.reject(new Error("로그아웃되어 원문 조회를 취소했습니다")); if (SCHEMA && SCHEMA[LEDGER] && SCHEMA[LEDGER].some(function (c) { return acc.header.indexOf(c) < 0; })) return Promise.reject(new Error("판매 원문 탭의 열 구조가 바뀌어 표시하지 않습니다(누락 열: " + SCHEMA[LEDGER].filter(function (c) { return acc.header.indexOf(c) < 0; }).join(", ") + ")")); state.tabs[LEDGER] = acc; state.sync.ledgerCount = acc.rows.length; state.sync.consistency = consistency(state.tabs, acc); state.version++; emit(); return acc; }
    if (s.mode !== "appsscript") return gMeta(s.sheetId, true).then(function (meta) { if (!meta.tabs[LEDGER]) return Promise.reject(new Error("시트에 '" + LEDGER + "' 탭이 없습니다")); state.sync.ledgerCount = meta.tabs[LEDGER].rows; return gLedger(s.sheetId, meta, onProgress); }).then(done);
    var acc = null, LIMIT = 5000;
    function step(off) { return api(s, { action: "tab", tab: LEDGER, offset: off, limit: LIMIT }, 120000).then(function (j) { if (!acc) acc = { header: j.header, rows: [] }; acc.rows = acc.rows.concat(j.rows); state.ledgerProgress = { loaded: acc.rows.length, total: j.total }; if (onProgress) onProgress(state.ledgerProgress); if (acc.rows.length < j.total && j.rows.length) return step(acc.rows.length); state.ledgerProgress = null; return acc; }); }
    return step(0).then(done);
  }
  function tab(name) { if (state.mode === "public") return (state.tabs && state.tabs[name]) || null; if (state.mode === "live") return (state.tabs && state.tabs[name]) || null; var t = state.tabs && state.tabs[name]; if (t) return t; return embedded ? embedded.tabs[name] || null : null; }
  /* 연결 테스트: google 은 사용자 클릭에서 호출(로그인 팝업) */
  function test(s) { if (s.mode === "appsscript") return api(s, { action: "meta" }, 30000).then(function (j) { return j.meta; }); if (!s.clientId || !s.sheetId) return Promise.reject(new Error("OAuth 클라이언트 ID 와 시트 ID 를 입력하세요")); var keep = settings(); saveSettings(s); return getToken(true).then(function () { return gMeta(s.sheetId, false); }).finally(function () { if (keep) localStorage.setItem(KEY, JSON.stringify(keep)); else localStorage.removeItem(KEY); }); }
  function signIn(opts) { state.sync.silentBlocked = false; return ((opts && opts.select) ? requestToken("select_account") : getToken(true)).then(function () { state.sync.expiredSince = null; return syncNow("signin"); }); }
  function signOut() { abortInflight(); var t = getStoredToken(); clearToken(); try { localStorage.removeItem(UKEY); } catch (e) {} patchSettings({ signedBefore: false }); state.email = ""; if (t && window.google && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.revoke) { try { google.accounts.oauth2.revoke(t, function () {}); } catch (e) {} } purge("signedout", "로그아웃했습니다. 조회한 데이터를 화면에서 지웠습니다."); state.needSignIn = configured(settings()); emit(); return Promise.resolve(state); }
  function setSyncInterval(ms, graceMs) { interval = Math.max(1000, Number(ms) || 300000); state.sync.interval = interval; if (graceMs) GRACE_MS = Math.max(1000, Number(graceMs)); stopTimer(); if (configured(settings()) && haveLive()) scheduleNext(); else if (viewPref() === "public" && state.mode === "public") { startTimer(); state.sync.nextAt = Date.now() + interval; } }

  document.addEventListener("visibilitychange", function () { if (!document.hidden && (configured(settings()) || viewPref() === "public") && state.sync.lastAttemptAt && Date.now() - state.sync.lastAttemptAt >= interval && state.sync.status !== "denied" && state.sync.status !== "signedout") syncNow("resume"); });

  loadEmbedded().then(function () { state.ready = true; state.embeddedMeta = embedded.meta; useEmbedded(null); state.at = new Date(); state.email = getHint(); emit(); return syncNow("load"); })
    .catch(function (e) { state.decodeError = e.message || String(e); state.ready = false; emit(); });

  window.B2BSheet = { viewMode: viewPref, setViewMode: setViewMode, noData: noData, state: state, refresh: function () { return syncNow("manual"); }, tab: tab, ledger: ledger, settings: settings, saveSettings: saveSettings, clearSettings: clearSettings, test: test, signIn: signIn, signOut: signOut, configured: configured, onChange: function (f) { listeners.push(f); }, setSyncInterval: setSyncInterval, cancel: cancelSync, setLimits: setLimits, diagnose: diagnose, getLog: getLog, expectedTabs: expectedTabs, schema: function () { return SCHEMA; }, LEDGER: LEDGER, KEY: KEY };
})();
