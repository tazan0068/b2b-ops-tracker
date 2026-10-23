/**
 * 시장 전체 공고 탭(26.시장전체공고) 점검 — 읽기 전용
 *   node tools/check-market-tab.cjs <탭.tsv> [시트 5b 자사 반영 공고 동일기간 건수: 2025=467,2026=576]
 * 확인: 머리글 · 건수 숫자 · 자사 반영 구분(POUR·다특허(PD)·DO·CNC)만 Y · 연도·기간별 합계와 점유율 · (선택) 시트 5b 합계와 일치
 */
const fs = require('fs');
const f = process.argv[2]; if (!f) { console.error('사용: node tools/check-market-tab.cjs <탭.tsv> [2025=467,2026=576]'); process.exit(2); }
const L = fs.readFileSync(f, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean).map(l => l.split('\t')), H = ['연도', '기간', '기간구분', '구분', '건수', '자사 반영 공고(시트 5b 기준)', '구분 설명', '원천'];
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
ok(L[0].join('|') === H.join('|'), '머리글이 약속과 같음');
const R = L.slice(1).map(r => { const o = {}; H.forEach((h, i) => o[h] = r[i]); return o; });
ok(R.length > 0 && R.every(r => /^\d{4}$/.test(r.연도) && /^[1-9]\d*$/.test(r.건수) && ['동일기간', '연간'].includes(r.기간구분)), '행 ' + R.length + '개: 연도·건수(양의 정수)·기간구분 형식');
const OWN = new Set(['POUR', '다특허(PD)', 'DO', 'CNC']);
ok(R.every(r => (r['자사 반영 공고(시트 5b 기준)'] === 'Y') === OWN.has(r.구분)), '자사 반영 Y 는 POUR·다특허(PD)·DO·CNC 구분에만 있음(DO공법·타사·일반·다특허는 N)');
const S = {}; R.forEach(r => { const k = r.연도 + '|' + r.기간구분, o = S[k] = S[k] || { total: 0, own: 0 }; o.total += Number(r.건수); if (r['자사 반영 공고(시트 5b 기준)'] === 'Y') o.own += Number(r.건수); });
Object.entries(S).forEach(([k, o]) => console.log('  ' + k + ': 전체 ' + o.total + ' · 자사 반영 ' + o.own + ' · 점유 ' + (o.own / o.total * 100).toFixed(1) + '%'));
ok(Object.values(S).every(o => o.own <= o.total && o.total > 0), '자사 반영 ≤ 전체');
const exp = (process.argv[3] || '').split(',').filter(Boolean).map(x => x.split('='));
exp.forEach(([y, n]) => ok(S[y + '|동일기간'] && S[y + '|동일기간'].own === Number(n), y + '년 동일기간 자사 반영 ' + (S[y + '|동일기간'] || {}).own + ' = 시트 5b ' + n));
console.log(fails ? '\n실패 ' + fails : '\n모두 통과'); process.exit(fails ? 1 : 0);
