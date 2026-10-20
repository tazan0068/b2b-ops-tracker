/**
 * Google Sheets API v4 모의 서버 (Google 로그인 모드 로컬 검증용) — 데이터는 탭 JSON(내보내기)에서
 *   node mock-sheets-api.cjs [포트=5185] [데이터=sheet-data.json] [토큰=test-token]
 *   GET /v4/spreadsheets/:id?fields=…                       → { properties:{title}, sheets:[{properties:{title,gridProperties}}] }
 *   GET /v4/spreadsheets/:id/values:batchGet?ranges=…       → { valueRanges:[{range, values}] }  (majorDimension=COLUMNS 지원)
 *   GET /v4/spreadsheets/:id/values/:range                  → { values }
 *   Authorization: Bearer <토큰> 없거나 다르면 401, 시트 ID 다르면 404, 토큰 'denied-token' 이면 403
 * 시험용 제어(인증 없음, 모의 서버 전용):
 *   /__admin/mode?m=normal|revoked|expired|down|netfail|slow   revoked=403(공유 취소), expired=401(토큰 만료/취소), down=503, netfail=연결 끊기, slow=3초 지연
 *   /__admin/edit?tab=&row=&col=&value=                         row=데이터 행 번호(1부터), col=열 머리글 — 시트 값 수정(숫자면 숫자로)
 *   v5 추가: mode=hang(응답 없음) / hangpat(요청 URL에 pat 가 들어간 것만 응답 없음: /__admin/pat?p=) / apioff(403 SERVICE_DISABLED) / scope(403 insufficient scope) / bad400
 *            /__admin/flaky?n=3 (다음 n개 요청 503) · /__admin/delay?ms=1500 (모든 요청 지연) · /__admin/log (요청 로그)
 *   /__admin/dropTab?tab=   /__admin/renameCol?tab=&from=&to=   /__admin/reset   /__admin/stats
 */
const http = require('http'); const fs = require('fs'); const path = require('path'); const url = require('url');
const PORT = Number(process.argv[2] || 5185); const DATA = process.argv[3] || path.join(process.cwd(), 'sheet-data.json'); const TOKEN = process.argv[4] || 'test-token';
const { decodeTab } = require('./sheet-codec.cjs');
const raw = JSON.parse(fs.readFileSync(DATA, 'utf8')); const load = () => { const d = JSON.parse(JSON.stringify(raw)); for (const k of Object.keys(d.tabs)) d.tabs[k] = decodeTab(d.tabs[k]); return d; };
let D = load(); const SID = raw.meta.spreadsheetId || 'SHEET'; let MODE = 'normal'; let FLAKY = 0, DELAY = 0, PAT = ''; const reqLog = []; const stats = { requests: 0, bytes: 0, byMode: {} };
const send = (res, code, obj) => { const body = JSON.stringify(obj); stats.bytes += body.length; res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'cache-control': 'no-store' }); res.end(body); };
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
function admin(u, res) {
  const q = u.query; const p = u.pathname.replace('/__admin/', '');
  if (p === 'mode') { MODE = q.m || 'normal'; return send(res, 200, { ok: true, mode: MODE }); }
  if (p === 'pat') { PAT = q.p || ''; return send(res, 200, { ok: true, pat: PAT }); }
  if (p === 'flaky') { FLAKY = Number(q.n || 0); return send(res, 200, { ok: true, flaky: FLAKY }); }
  if (p === 'delay') { DELAY = Number(q.ms || 0); return send(res, 200, { ok: true, delay: DELAY }); }
  if (p === 'log') return send(res, 200, { ok: true, log: reqLog.slice(-200) });
  if (p === 'reset') { D = load(); MODE = 'normal'; FLAKY = 0; DELAY = 0; PAT = ''; reqLog.length = 0; return send(res, 200, { ok: true }); }
  if (p === 'stats') return send(res, 200, { ok: true, mode: MODE, stats });
  if (p === 'edit') { const t = D.tabs[q.tab]; if (!t) return send(res, 404, { ok: false, error: 'no tab' }); const ci = t.header.indexOf(q.col); const r = t.rows[Number(q.row) - 1]; if (ci < 0 || !r) return send(res, 404, { ok: false, error: 'no cell' }); const old = r[ci]; r[ci] = (q.value !== '' && !isNaN(Number(q.value))) ? Number(q.value) : q.value; return send(res, 200, { ok: true, old, now: r[ci] }); }
  if (p === 'dropTab') { delete D.tabs[q.tab]; return send(res, 200, { ok: true }); }
  if (p === 'renameCol') { const t = D.tabs[q.tab]; const i = t ? t.header.indexOf(q.from) : -1; if (i < 0) return send(res, 404, { ok: false }); t.header[i] = q.to; return send(res, 200, { ok: true }); }
  return send(res, 404, { ok: false });
}
http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname.startsWith('/__admin/')) return admin(u, res);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET' }); return res.end(); }
  stats.requests++; stats.byMode[MODE] = (stats.byMode[MODE] || 0) + 1;
  if (u.pathname === '/oauth2/v3/userinfo') { const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (t !== TOKEN) return send(res, 401, { error: 'invalid' }); return send(res, 200, { email: 'tester@example.com' }); }
  reqLog.push({ t: Date.now(), path: decodeURIComponent(u.pathname).slice(0, 60), ranges: [].concat(u.query.ranges || []).length, mode: MODE });
  if (MODE === 'netfail') { req.socket.destroy(); return; }
  if (MODE === 'hang') return;
  if (MODE === 'hangpat' && PAT && decodeURIComponent(req.url).includes(PAT)) return;
  const go = () => {
    if (FLAKY > 0) { FLAKY--; return send(res, 503, { error: { code: 503, message: 'Service Unavailable', status: 'UNAVAILABLE' } }); }
    if (MODE === 'apioff') return send(res, 403, { error: { code: 403, message: 'Google Sheets API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/', status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } });
    if (MODE === 'scope') return send(res, 403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED' } });
    if (MODE === 'bad400') return send(res, 400, { error: { code: 400, message: 'Unable to parse range', status: 'INVALID_ARGUMENT' } });
    if (MODE === 'down') return send(res, 503, { error: { code: 503, message: 'Service Unavailable', status: 'UNAVAILABLE' } });
    const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!auth || (auth !== TOKEN && auth !== 'denied-token')) return send(res, 401, { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } });
    if (MODE === 'expired') return send(res, 401, { error: { code: 401, message: 'Invalid Credentials', status: 'UNAUTHENTICATED' } });
    if (auth === 'denied-token' || MODE === 'revoked') return send(res, 403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } });
    const m = u.pathname.match(/^\/v4\/spreadsheets\/([^/]+)(?:\/values(?::batchGet|\/(.+)))?$/);
    if (!m) return send(res, 404, { error: { code: 404, message: 'not found' } });
    if (decodeURIComponent(m[1]) !== SID) return send(res, 404, { error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' } });
    if (/values:batchGet$/.test(u.pathname)) { const rs = [].concat(u.query.ranges || []); const out = rs.map(r => values(r, u.query.majorDimension)); if (out.some(x => !x)) return send(res, 400, { error: { code: 400, message: 'Unable to parse range', status: 'INVALID_ARGUMENT' } }); return send(res, 200, { spreadsheetId: SID, valueRanges: out }); }
    if (m[2]) { const v = values(decodeURIComponent(m[2]), u.query.majorDimension); if (!v) return send(res, 400, { error: { code: 400, message: 'Unable to parse range' } }); return send(res, 200, v); }
    return send(res, 200, { spreadsheetId: SID, properties: { title: raw.meta.title }, sheets: Object.keys(D.tabs).map(n => ({ properties: { title: n, gridProperties: { rowCount: D.tabs[n].rows.length + 1 + 100, columnCount: Math.max(26, D.tabs[n].header.length) } } })) });
  };
  if (MODE === 'slow') setTimeout(go, 3000); else if (DELAY) setTimeout(go, DELAY); else go();
}).listen(PORT, () => console.log('mock sheets api on http://localhost:' + PORT + '/v4/spreadsheets/' + SID + '  (Bearer ' + TOKEN + ')  admin: /__admin/mode|edit|dropTab|renameCol|reset|stats'));
