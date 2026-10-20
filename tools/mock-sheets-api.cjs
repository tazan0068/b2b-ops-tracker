/**
 * Google Sheets API v4 모의 서버 (Google 로그인 모드 로컬 검증용) — 데이터는 탭 JSON(내보내기)에서
 *   node mock-sheets-api.cjs [포트=5185] [데이터=build/sheet-data.json] [토큰=test-token]
 *   GET /v4/spreadsheets/:id?fields=…                       → { properties:{title}, sheets:[{properties:{title,gridProperties}}] }
 *   GET /v4/spreadsheets/:id/values:batchGet?ranges=…       → { valueRanges:[{range, values}] }  (majorDimension=COLUMNS 지원)
 *   GET /v4/spreadsheets/:id/values/:range                  → { values }
 *   Authorization: Bearer <토큰> 없거나 다르면 401, 시트 ID 다르면 404, 토큰 'denied-token' 이면 403
 */
const http = require('http'); const fs = require('fs'); const path = require('path'); const url = require('url');
const PORT = Number(process.argv[2] || 5185); const DATA = process.argv[3] || path.join(process.cwd(), 'sheet-data.json'); const TOKEN = process.argv[4] || 'test-token';
const { decodeTab } = require('./sheet-codec.cjs');
const D = JSON.parse(fs.readFileSync(DATA, 'utf8')); for (const k of Object.keys(D.tabs)) D.tabs[k] = decodeTab(D.tabs[k]);
const SID = D.meta.spreadsheetId || 'SHEET';
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const colIdx = s => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
function parseRange(r) { const m = String(r).match(/^'?([^'!]+)'?(?:!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?)?$/); if (!m) return null; return { tab: m[1].replace(/''/g, "'"), c1: m[2] ? colIdx(m[2]) : 1, r1: m[3] ? Number(m[3]) : 1, c2: m[4] ? colIdx(m[4]) : null, r2: m[5] ? Number(m[5]) : null }; }
function grid(tab) { const t = D.tabs[tab]; if (!t) return null; return [t.header].concat(t.rows); }
function values(rangeStr, major) {
  const p = parseRange(rangeStr); if (!p) return null; const g = grid(p.tab); if (!g) return null;
  const c2 = p.c2 || Math.max(...g.map(r => r.length)); const r2 = p.r2 || g.length; let rows = g.slice(p.r1 - 1, r2).map(r => r.slice(p.c1 - 1, c2).map(v => v == null ? '' : v));
  rows = rows.map(r => { let e = r.length; while (e > 0 && r[e - 1] === '') e--; return r.slice(0, e); }); while (rows.length && !rows[rows.length - 1].length) rows.pop();
  if (major === 'COLUMNS') { const w = Math.max(0, ...rows.map(r => r.length)); const cols = []; for (let c = 0; c < w; c++) { const col = rows.map(r => r[c] == null ? '' : r[c]); let e = col.length; while (e > 0 && col[e - 1] === '') e--; cols.push(col.slice(0, e)); } return { range: rangeStr, majorDimension: 'COLUMNS', values: cols }; }
  return { range: rangeStr, majorDimension: 'ROWS', values: rows };
}
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET' }); return res.end(); }
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!auth || (auth !== TOKEN && auth !== 'denied-token')) return send(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
  if (auth === 'denied-token') return send(res, 403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } });
  const u = url.parse(req.url, true); const m = u.pathname.match(/^\/v4\/spreadsheets\/([^/]+)(?:\/values(?::batchGet|\/(.+)))?$/);
  if (!m) return send(res, 404, { error: { code: 404, message: 'not found' } });
  if (decodeURIComponent(m[1]) !== SID) return send(res, 404, { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } });
  if (/values:batchGet$/.test(u.pathname)) { const rs = [].concat(u.query.ranges || []); const out = rs.map(r => values(r, u.query.majorDimension)); if (out.some(x => !x)) return send(res, 400, { error: { code: 400, message: 'Unable to parse range', status: 'INVALID_ARGUMENT' } }); return send(res, 200, { spreadsheetId: SID, valueRanges: out }); }
  if (m[2]) { const v = values(decodeURIComponent(m[2]), u.query.majorDimension); if (!v) return send(res, 400, { error: { code: 400, message: 'Unable to parse range' } }); return send(res, 200, v); }
  return send(res, 200, { spreadsheetId: SID, properties: { title: D.meta.title }, sheets: Object.keys(D.tabs).map(n => ({ properties: { title: n, gridProperties: { rowCount: D.tabs[n].rows.length + 1 + 100, columnCount: Math.max(26, D.tabs[n].header.length) } } })) });
}).listen(PORT, () => console.log('mock sheets api on http://localhost:' + PORT + '/v4/spreadsheets/' + SID + '  (Bearer ' + TOKEN + ')'));
