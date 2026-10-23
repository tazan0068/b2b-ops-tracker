/**
 * 업체별 메인자재 구매 연결 시험 (합성 자료만 사용 — 실제 업체·거래 데이터 없음)
 *   node tools/test-vendor-buy.cjs
 * 확인: ① 구매 확인 / 구매 미확인(미구매로 단정하지 않음) ② 최초·최근 구매일·재구매 ③ 원문이 없으면 이력을 만들지 않음
 *       ④ 낙찰 현장별 사용 확인에 '확정'이 없고 후보/미확인만 있음
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'growth-core.js'), 'utf8'), ctx); const G = ctx.window.B2BGrowth;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const L = (d, id, item, amt, cls, memo) => ({ 거래일자: d, 연도: Number(d.slice(0, 4)), 통합ID: id, 거래처명: id, '품목명·규격': item, 수량: 10, 공급가액: amt, 순매출포함: '포함', 메인자재분류: cls || '핵심 메인', '적요(현장명)': memo || '' });
const tabs = {
  '1.통합KPI': [{ 연도: 2026, 기준: '1/1~10/20', 전체자재순매출: 1000000, 메인자재순매출: 500000, 동일기간_전체매출: 1000000, 동일기간_메인매출: 500000 }],
  '2.시공사마스터': [{ 통합ID: 'T001', 대표업체명: '시험업체A' }, { 통합ID: 'T002', 대표업체명: '시험업체B' }, { 통합ID: 'T003', 대표업체명: '시험업체C' }],
  '4.메인자재구매현황': [], '5.POUR공고낙찰': [{ 공고기록ID: 'N1', 연도: 2026, 공고일: '2026-04-01', 현장명: '시험단지하늘채', 공종: '우레탄', 공종그룹: '우레탄', 낙찰시공사: '시험업체A', 통합ID: 'T001', 낙찰금액: 1000, 연결상태: '확정' },
    { 공고기록ID: 'N2', 연도: 2026, 공고일: '2026-05-01', 현장명: '다른현장', 공종: '에폭시', 공종그룹: '에폭시', 낙찰시공사: '시험업체B', 통합ID: 'T002', 낙찰금액: 1000, 연결상태: '확정' }],
  '5b.POUR반영공고': [], '12.거래처연결검토': []
};
const led = [L('2026-03-01', 'T001', 'POUR 써밋페인트 [20kg]', 100000, '핵심 메인', '시험단지하늘채 3동'), L('2026-05-20', 'T001', 'POUR 우레탄 중도', 200000, '핵심 메인'), L('2026-06-01', 'T003', '운송비', 5000, '비자재·용역')];
const src = withLedger => ({ has: n => !!tabs[n], objs: n => tabs[n], ledger: () => withLedger ? led : null });
const m = G.build(src(true), {}), m0 = G.build(src(false), {});
const a = m.vendorMainBuy('T001'), b = m.vendorMainBuy('T002'), c = m.vendorMainBuy('T003');
ok(a.state === 'confirmed' && a.first === '2026-03-01' && a.last === '2026-05-20' && a.repurchase === true && a.count === 2, '구매 업체: 구매 확인 · 최초 2026-03-01 · 최근 2026-05-20 · 재구매');
ok(a.items.length === 2 && a.items.some(x => x.공종 === '우레탄') && a.items.some(x => x.공종 === '재도장'), '구매 품목에 공종(품목군)이 붙음');
ok(b.state === 'unknown' && b.label === '구매 미확인' && /미구매로 단정하지 않/.test(b.note), '구매 기록 없는 업체는 "구매 미확인"(미구매 단정 없음)');
ok(c.state === 'unknown', '비자재·용역만 있는 업체는 메인자재 구매로 보지 않음(구매 미확인)');
ok(m0.vendorMainBuy('T001').state === 'wait', '원문이 없는 공개 보기에서는 구매 이력을 만들지 않음');
const rows = m.awardRows('ann', '2026');
ok(rows.length === 2 && rows.every(r => r.사용확인코드 !== 'ok'), '낙찰 현장별 사용 확인에 "확정"이 없음');
ok(rows.find(r => r.통합ID === 'T001').사용확인 === '후보' && rows.find(r => r.통합ID === 'T002').사용확인 === '미확인', '적요에 비슷한 현장명이 있으면 후보, 없으면 미확인');
ok(m.vendorDetail('T001').mainBuy.state === 'confirmed', 'vendorDetail 에 구매 정보 연결');
console.log(fails ? '\n실패 ' + fails : '\n모두 통과'); process.exit(fails ? 1 : 0);
