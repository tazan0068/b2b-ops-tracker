/**
 * 성장 분석 공고 증감 시험 (합성 자료만 사용)
 *   node tools/test-growth-notices.cjs
 * 확인: ① 자사 반영 공고 합계는 구분이 없던 해(2024)와 구분이 생긴 해(2025)를 같은 기준으로 비교
 *       ② POUR 단독 · 다특허/브랜드 증감은 구분이 생긴 첫 해(2025)에 '비교 불가'(이유 포함), 그 다음 해(2026)부터 계산
 *       ③ 다특허/브랜드 = 합계 − POUR 단독 ④ 공고 건수·증감률 산식(동일기간 공고일 ≤ 10-20)과 시공사별 낙찰 합계 = 전체 낙찰
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'growth-core.js'), 'utf8'), ctx); const G = ctx.window.B2BGrowth;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
let n = 0; const N = (y, md, kind, scope, extra) => Object.assign({ 공고기록ID: 'N' + (++n), 연도: String(y), 집계대상: 'Y', 공고일: y + '-' + md, 현장명: '시험단지' + n, 공고구분: kind, 공종그룹: '재도장', 통합ID: '', 원천범위: scope, 동일기간: 'Y' }, extra || {});
const rows5b = [];
for (let i = 0; i < 10; i++) rows5b.push(N(2024, '03-' + String(i + 1).padStart(2, '0'), 'POUR', 'POUR 공고만'));          /* 2024: 구분 없는 목록 10건(자사 반영 공고) */
rows5b.push(N(2024, '11-05', 'POUR', 'POUR 공고만'));                                                                   /* 2024-11-05 → 동일기간(~10/20) 밖 */
for (let i = 0; i < 8; i++) rows5b.push(N(2025, '04-' + String(i + 1).padStart(2, '0'), 'POUR', '전체 공고'));            /* 2025: POUR 8 + 다특허 4 + DO 1 = 13 */
for (let i = 0; i < 4; i++) rows5b.push(N(2025, '05-0' + (i + 1), '다특허(PD)', '전체 공고'));
rows5b.push(N(2025, '06-01', 'DO', '전체 공고'));
for (let i = 0; i < 9; i++) rows5b.push(N(2026, '04-' + String(i + 1).padStart(2, '0'), 'POUR', '전체 공고'));             /* 2026: POUR 9 + 다특허 6 = 15 */
for (let i = 0; i < 6; i++) rows5b.push(N(2026, '05-0' + (i + 1), '다특허(PD)', '전체 공고'));
const A = (y, md, id, amt) => ({ 공고기록ID: 'A' + y + md, 연도: String(y), 공고일: y + '-' + md, 현장명: '낙찰단지' + y + md, 낙찰시공사: id, 통합ID: id, 낙찰금액: amt, 공종그룹: '재도장', 연결상태: '확정' });
const tabs = {
  '1.통합KPI': [2024, 2025, 2026].map(y => ({ 연도: y, 기준: y === 2026 ? '~10/20' : '연간', 전체자재순매출: 1000, 메인자재순매출: 500, 동일기간_전체매출: 1000, 동일기간_메인매출: 500 })),
  '2.시공사마스터': [{ 통합ID: 'T1', 대표업체명: '시험업체A' }, { 통합ID: 'T2', 대표업체명: '시험업체B' }],
  '4.메인자재구매현황': [], '5.POUR공고낙찰': [A(2024, '03-01', 'T1', 100), A(2025, '04-01', 'T1', 200), A(2025, '04-02', 'T2', 300), A(2026, '04-01', 'T2', 400)], '5b.POUR반영공고': rows5b, '12.거래처연결검토': []
};
const m = G.build({ has: x => !!tabs[x], objs: x => tabs[x], ledger: () => null }, {});
const c = y => m.metrics('ytd', y), g = (y, k) => m.growth('ytd', y, k);
ok(c('2024').notices === 10 && c('2025').notices === 13 && c('2026').notices === 15, '동일기간 공고 합계: 2024 10(11월 공고 제외) · 2025 13 · 2026 15');
ok(c('2025').noticesPour === 8 && c('2026').noticesPour === 9 && c('2025').notices - c('2025').noticesPour === 5, 'POUR 단독 2025 8 · 2026 9 / 다특허·브랜드 2025 5(=합계−POUR)');
ok(g('2025', 'notices').state === 'ok' && Math.abs(g('2025', 'notices').pct - 0.3) < 1e-9, '합계 증감 2025 = (13−10)÷10 = +30% (구분이 나뉘기 전 해와도 같은 기준으로 비교)');
ok(g('2025', 'noticesPour').state === 'na' && /나누지 않고/.test(g('2025', 'noticesPour').why), 'POUR 단독 증감 2025 = 비교 불가(이유: 전년 목록은 구분 없음)');
ok(g('2025', 'noticesOther').state === 'na' && /나누지 않고/.test(g('2025', 'noticesOther').why), '다특허·브랜드 증감 2025 = 비교 불가');
ok(g('2026', 'noticesPour').state === 'ok' && Math.abs(g('2026', 'noticesPour').pct - 0.125) < 1e-9, 'POUR 단독 증감 2026 = (9−8)÷8 = +12.5%');
ok(g('2026', 'noticesOther').state === 'ok' && Math.abs(g('2026', 'noticesOther').pct - 0.2) < 1e-9, '다특허·브랜드 증감 2026 = (6−5)÷5 = +20%');
ok(m.splitYear() === '2025', '구분이 생긴 첫 해 = 2025');
const sumV = y => { const by = {}; m.awardRows('ytd', y).forEach(r => { by[r.통합ID] = (by[r.통합ID] || 0) + 1; }); return Object.values(by).reduce((s, v) => s + v, 0); };
ok(['2024', '2025', '2026'].every(y => sumV(y) === c(y).awards), '시공사별 낙찰 합 = 전체 낙찰 (2024·2025·2026)');
console.log(fails ? '\n실패 ' + fails : '\n모두 통과'); process.exit(fails ? 1 : 0);
