/**
 * B2B 통합 구글시트 읽기 전용 API (Google Apps Script 웹앱) — v3
 *
 * 보안 설계
 *  - 시트는 비공개 그대로. 스크립트가 시트 소유자 권한으로 "읽기만" 하고 JSON 을 돌려준다. (setValue·deleteRow 등 쓰기 호출 없음)
 *  - 액세스 키는 요청 본문(POST, JSON)으로 받는다. URL 에 키를 싣지 않으므로 브라우저 기록·로그에 남지 않는다.
 *    (GET 은 주소창 자기 확인용 action=meta 만 허용하고, 그때도 키가 필요하다)
 *  - 키는 스크립트 속성 ACCESS_KEY 와 상수 시간 비교. 키가 없거나 다르면 어떤 데이터도 돌려주지 않는다. 16자 미만이면 동작 거부.
 *  - 호출 한도: 키당 10분에 300회(CacheService). 초과 시 거부 → 키 유출 시 대량 수집을 늦춘다.
 *  - 조회 대상 시트: 기본은 이 스크립트가 붙은 시트. 스크립트 속성 ALLOWED_SHEET_IDS(쉼표 구분)에 적힌 ID 만 sheetId 로 추가 허용(테스트 사본용).
 *  - 트래커 HTML 에는 URL·키가 들어가지 않는다. 사용자가 [연결 설정]에 입력하면 그 브라우저의 localStorage 에만 저장된다.
 *  - 사용하는 서비스: SpreadsheetApp · PropertiesService · CacheService · ContentService 만. Drive 권한 불필요.
 *  - 오류 응답에 데이터·키·내부 경로를 넣지 않는다.
 *
 * 요청 (POST, Content-Type: text/plain, 본문 JSON)
 *   { key, action:"meta" }
 *   { key, action:"tab", tab, offset, limit }          (limit 최대 5000)
 *   { key, action:"tabs", tabs:"A,B,C" }               (각 5,000행 이하 탭만)
 *   선택: sheetId (ALLOWED_SHEET_IDS 에 있는 ID 만)
 * 응답: 트래커 build/sheet-source.js 와 동일 형식 { ok, ... }
 */
var MAX_LIMIT = 5000;
var SMALL_TAB_MAX = 5000;
var RATE_LIMIT = 300;        // 10분당 요청 수
var RATE_WINDOW_SEC = 600;

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return out_({ ok: false, error: '요청 본문이 JSON 이 아닙니다' }); }
  return handle_(body);
}
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action !== 'meta') return out_({ ok: false, error: 'GET 은 action=meta(자기 확인)만 허용합니다. 데이터 조회는 POST 로 보내세요.' });
  return handle_({ key: p.key, action: 'meta', sheetId: p.sheetId });
}

function handle_(p) {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('ACCESS_KEY');
  if (!key || key.length < 16) return out_({ ok: false, error: '스크립트 속성 ACCESS_KEY 가 설정되지 않았거나 너무 짧습니다(16자 이상)' });
  if (!p.key || !safeEqual_(String(p.key), key)) return out_({ ok: false, error: '액세스 키 불일치' });
  if (!rateOk_()) return out_({ ok: false, error: '호출 한도 초과(10분당 ' + RATE_LIMIT + '회). 잠시 후 다시 시도하세요' });
  try {
    var ss = openSheet_(p.sheetId, props); if (!ss) return out_({ ok: false, error: '허용되지 않은 시트 ID' });
    if (p.action === 'meta') return out_({ ok: true, meta: meta_(ss) });
    if (p.action === 'tab') return out_(tab_(ss, p.tab, Number(p.offset || 0), Number(p.limit || MAX_LIMIT)));
    if (p.action === 'tabs') {
      var names = String(p.tabs || '').split(',').filter(String); var tabs = {};
      for (var i = 0; i < names.length; i++) { var r = tab_(ss, names[i], 0, SMALL_TAB_MAX); if (!r.ok) return out_(r); if (r.total > SMALL_TAB_MAX) return out_({ ok: false, error: '큰 탭은 action=tab 으로 나눠 조회: ' + names[i] }); tabs[names[i]] = { header: r.header, rows: r.rows, total: r.total }; }
      return out_({ ok: true, tabs: tabs, meta: meta_(ss) });
    }
    return out_({ ok: false, error: 'action 은 meta | tab | tabs' });
  } catch (err) { return out_({ ok: false, error: '조회 중 오류: ' + String(err && err.message || err).slice(0, 200) }); }
}

function openSheet_(sheetId, props) {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!sheetId || sheetId === active.getId()) return active;
  var allowed = String(props.getProperty('ALLOWED_SHEET_IDS') || '').split(',').map(function (s) { return s.trim(); }).filter(String);
  if (allowed.indexOf(sheetId) < 0) return null;
  return SpreadsheetApp.openById(sheetId);
}

/* 상수 시간 비교(키 길이·문자 누출 완화) */
function safeEqual_(a, b) { if (a.length !== b.length) return false; var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/* 호출 한도 (10분 창) */
function rateOk_() {
  var cache = CacheService.getScriptCache(); var k = 'rate:' + Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC);
  var n = Number(cache.get(k) || 0) + 1; cache.put(k, String(n), RATE_WINDOW_SEC);
  return n <= RATE_LIMIT;
}

function meta_(ss) {
  var tabs = {}; var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) { var sh = sheets[i]; tabs[sh.getName()] = { rows: Math.max(0, sh.getLastRow() - 1), cols: sh.getLastColumn() }; }
  /* 시트 수정 시각은 Drive 권한이 필요해 제공하지 않는다(권한 최소화). 응답 생성 시각만 돌려준다. */
  return { source: 'sheet', title: ss.getName(), spreadsheetId: ss.getId(), lastUpdated: null, servedAt: new Date().toISOString(), tabs: tabs };
}

function tab_(ss, name, offset, limit) {
  var sh = ss.getSheetByName(name); if (!sh) return { ok: false, error: '탭 없음: ' + name };
  var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn(); if (lastRow < 1 || lastCol < 1) return { ok: true, tab: name, header: [], rows: [], offset: 0, total: 0 };
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return h === '' ? '' : String(h); });
  var total = lastRow - 1; offset = Math.max(0, offset | 0); limit = Math.max(1, Math.min(limit | 0 || MAX_LIMIT, MAX_LIMIT));
  var n = Math.max(0, Math.min(limit, total - offset)); var rows = [];
  if (n > 0) { var vals = sh.getRange(2 + offset, 1, n, lastCol).getValues(); for (var r = 0; r < vals.length; r++) { var row = []; for (var c = 0; c < lastCol; c++) { var v = vals[r][c]; if (v === '') v = null; else if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd'); row.push(v); } rows.push(row); } }
  return { ok: true, tab: name, header: header, rows: rows, offset: offset, total: total };
}

function out_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
