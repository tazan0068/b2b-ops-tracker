/**
 * Apps Script 웹앱 응답 방식 시뮬레이터 — 브라우저 호환성 점검용 (데이터는 build/sheet-data.json 또는 지정 파일)
 *   node mock-appsscript-redirect.cjs [포트=5183] [데이터] [키=test-key]
 *   · POST/GET http://localhost:<포트>/macros/s/TEST/exec  → doPost/doGet 처리 후 302 Location: http://127.0.0.1:<포트+1>/macros/echo?user_content_key=…
 *     (Apps Script 와 같이 응답 본문은 다른 출처(googleusercontent 역할 = 127.0.0.1)에서 GET 으로 내려준다)
 *   · 302 응답과 최종 JSON 응답 모두 Access-Control-Allow-Origin: * (Apps Script 동작과 동일), 사전 요청(OPTIONS)은 처리하지 않음(Apps Script 도 처리 안 함)
 *   · Content-Type 이 text/plain 이 아니면(=사전 요청이 필요한 요청) Apps Script 처럼 실패하도록 OPTIONS 에 405 응답
 *   · 규칙: POST 본문 JSON 의 key 검사, GET 은 action=meta 만, 허용되지 않은 sheetId 거부 (Code.gs v3 와 동일)
 */
const http = require('http'); const fs = require('fs'); const path = require('path'); const url = require('url'); const crypto = require('crypto');
const PORT = Number(process.argv[2] || 5183); const DATA = process.argv[3] || path.join(process.cwd(), 'sheet-data.json'); const KEY = process.argv[4] || 'test-key';
const { decodeTab } = require('./sheet-codec.cjs');
const D = JSON.parse(fs.readFileSync(DATA, 'utf8')); for (const k of Object.keys(D.tabs)) D.tabs[k] = decodeTab(D.tabs[k]);
const stash = new Map(); // user_content_key → JSON 문자열 (1회성)
const json = obj => JSON.stringify(obj);
function handle(q) {
  if (q.key !== KEY) return { ok: false, error: '액세스 키 불일치' };
  const meta = { source: 'sheet', title: D.meta.title, spreadsheetId: D.meta.spreadsheetId, lastUpdated: null, servedAt: new Date().toISOString(), tabs: D.meta.tabs };
  if (q.sheetId && q.sheetId !== D.meta.spreadsheetId) return { ok: false, error: '허용되지 않은 시트 ID' };
  if (q.action === 'meta') return { ok: true, meta };
  if (q.action === 'tab') { const t = D.tabs[q.tab]; if (!t) return { ok: false, error: '탭 없음: ' + q.tab }; const off = Number(q.offset || 0), lim = Math.min(Number(q.limit || 5000), 5000); return { ok: true, tab: q.tab, header: t.header, rows: t.rows.slice(off, off + lim), offset: off, total: t.rows.length }; }
  if (q.action === 'tabs') { const out = {}; for (const n of String(q.tabs || '').split(',').filter(Boolean)) { const t = D.tabs[n]; if (!t) return { ok: false, error: '탭 없음: ' + n }; if (t.rows.length > 5000) return { ok: false, error: '큰 탭은 action=tab 으로 나눠 조회: ' + n }; out[n] = { header: t.header, rows: t.rows, total: t.rows.length }; } return { ok: true, tabs: out, meta }; }
  return { ok: false, error: 'action 은 meta | tab | tabs' };
}
// script.google.com 역할
http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    if (req.method === 'OPTIONS') { res.writeHead(405); return res.end(); }  // Apps Script 는 사전 요청을 처리하지 않는다
    let q = url.parse(req.url, true).query; let result;
    if (req.method === 'POST') { try { q = Object.assign({}, q, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); result = handle(q); } catch (e) { result = { ok: false, error: '요청 본문이 JSON 이 아닙니다' }; } }
    else if (q.action === 'meta') result = handle({ key: q.key, action: 'meta', sheetId: q.sheetId });
    else result = { ok: false, error: 'GET 은 action=meta(자기 확인)만 허용합니다. 데이터 조회는 POST 로 보내세요.' };
    const id = crypto.randomBytes(16).toString('hex'); stash.set(id, json(result)); setTimeout(() => stash.delete(id), 60000);
    res.writeHead(302, { Location: 'http://127.0.0.1:' + (PORT + 1) + '/macros/echo?user_content_key=' + id + '&lib=TEST', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end();
  });
}).listen(PORT, () => console.log('[sim] script.google.com 역할  http://localhost:' + PORT + '/macros/s/TEST/exec'));
// script.googleusercontent.com 역할 (다른 출처: 127.0.0.1)
http.createServer((req, res) => {
  const q = url.parse(req.url, true).query; const body = stash.get(q.user_content_key);
  if (!body) { res.writeHead(404, { 'access-control-allow-origin': '*' }); return res.end('expired'); }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(body);
}).listen(PORT + 1, () => console.log('[sim] googleusercontent 역할 http://127.0.0.1:' + (PORT + 1) + '/macros/echo'));
