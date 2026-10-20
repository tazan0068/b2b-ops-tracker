/** 탭 데이터 사전 인코딩/디코딩 — 반복되는 문자열 열을 사전+색인으로 줄인다(값 손실 없음). 트래커(sheet-source.js)에 같은 디코더가 있다. */
function encodeTab(t) {
  const n = t.rows.length; if (!n) return t;
  const cols = t.header.map((_, i) => { const vals = t.rows.map(r => r[i]); const strs = vals.filter(v => typeof v === 'string'); if (strs.length < n * 0.5) return null; const u = new Map(); strs.forEach(s => u.set(s, (u.get(s) || 0) + 1)); if (u.size > n * 0.6) return null; return [...u.keys()]; });
  if (!cols.some(Boolean)) return t;
  const idx = cols.map(d => d ? new Map(d.map((s, i) => [s, i])) : null);
  const rows = t.rows.map(r => r.map((v, i) => { if (!idx[i]) return v; if (v == null) return null; if (typeof v !== 'string') return { v }; const k = idx[i].get(v); return k === undefined ? { v } : k; }));
  return { header: t.header, enc: { cols }, rows };
}
function decodeTab(t) { if (!t.enc) return t; const cols = t.enc.cols; return { header: t.header, rows: t.rows.map(r => r.map((v, i) => { const d = cols[i]; if (!d) return v; if (v == null) return null; if (typeof v === 'object') return v.v; return d[v]; })) }; }
module.exports = { encodeTab, decodeTab };
