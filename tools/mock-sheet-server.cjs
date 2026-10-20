/**
 * 구글시트 읽기 전용 API 모의 서버 (Apps Script 웹앱과 같은 응답 형식) — 트래커 실시간 조회 경로를 로컬에서 검증하기 위한 용도
 *   node mock-sheet-server.cjs [포트=5180] [데이터=build/sheet-data.json] [키=test-key]
 *   GET ?action=meta&key=K
 *   GET ?action=tab&tab=NAME&offset=0&limit=5000&key=K
 *   GET ?action=tabs&tabs=A,B&key=K
 *   CORS: Access-Control-Allow-Origin * (file:// 에서 연 트래커도 호출 가능)
 */
const http = require('http'); const fs = require('fs'); const path = require('path'); const url = require('url');
const PORT = Number(process.argv[2] || 5180); const DATA = process.argv[3] || path.join(process.cwd(), 'sheet-data.json'); const KEY = process.argv[4] || 'test-key';
const { decodeTab } = require('./sheet-codec.cjs');
const D = JSON.parse(fs.readFileSync(DATA, 'utf8')); for (const k of Object.keys(D.tabs)) D.tabs[k] = decodeTab(D.tabs[k]);
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
function handle(req, res, q) {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); return res.end(); }
  if (q.key !== KEY) return send(res, 200, { ok: false, error: '액세스 키 불일치' });
  const meta = { ...D.meta, source: 'sheet', title: D.meta.title, lastUpdated: new Date().toISOString(), tabs: D.meta.tabs };
  if (q.action === 'meta') return send(res, 200, { ok: true, meta });
  if (q.action === 'tab') { const t = D.tabs[q.tab]; if (!t) return send(res, 200, { ok: false, error: '탭 없음: ' + q.tab }); const off = Number(q.offset || 0), lim = Math.min(Number(q.limit || 5000), 20000); return send(res, 200, { ok: true, tab: q.tab, header: t.header, rows: t.rows.slice(off, off + lim), offset: off, total: t.rows.length }); }
  if (q.action === 'tabs') { const names = String(q.tabs || '').split(',').filter(Boolean); const out = {}; for (const n of names) { const t = D.tabs[n]; if (!t) return send(res, 200, { ok: false, error: '탭 없음: ' + n }); if (t.rows.length > 20000) return send(res, 200, { ok: false, error: '큰 탭은 action=tab 으로 나눠 조회: ' + n }); out[n] = { header: t.header, rows: t.rows, total: t.rows.length }; } return send(res, 200, { ok: true, tabs: out, meta }); }
  send(res, 200, { ok: false, error: 'action 은 meta | tab | tabs' });
}
http.createServer((req, res) => { const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { let q = url.parse(req.url, true).query; if (req.method === 'OPTIONS') return handle(req, res, q); if (req.method === 'POST') { try { q = Object.assign({}, q, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { return send(res, 200, { ok: false, error: '요청 본문이 JSON 이 아닙니다' }); } } else if (q.action !== 'meta') return send(res, 200, { ok: false, error: 'GET 은 action=meta(자기 확인)만 허용합니다. 데이터 조회는 POST 로 보내세요.' }); if (q.sheetId && q.sheetId !== D.meta.spreadsheetId && q.sheetId !== 'TEST-COPY') return send(res, 200, { ok: false, error: '허용되지 않은 시트 ID' }); handle(req, res, q); }); }).listen(PORT, () => console.log('mock sheet api on http://localhost:' + PORT + '/?action=meta&key=' + KEY));
