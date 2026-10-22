/**
 * 시공사 추적 — 21.잔디등_L3활동 · 22.영업보고 · 23.경로전환_시공사별 연결 시험 (합성 자료만 사용)
 *   node tools/test-ops-path.cjs
 * 확인: ① 선택 탭이 없으면 기존 동작(path = null) ② 21탭 L3가 L3 활동에 더해짐(대표·확정/요청만, 업체 미기재 제외)
 *       ③ 23탭 경로가 시공사에 연결됨 ④ 22.영업보고가 비어 있으면 L2 원천 없음 유지, 행이 있으면 있음
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const w = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'ops-core.js'), 'utf8'), { window: w }); const Ops = w.B2BOps;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const base = {
  '17.장기무활동': [{ 통합ID: 'T001', 업체명: '시험업체A', 기준일: '2026-10-20', 판정: '정상', 마지막활동일: '2026-09-01', 핵심협력사: 'Y' }, { 통합ID: 'T002', 업체명: '시험업체B', 기준일: '2026-10-20', 판정: '정상', 마지막활동일: '2026-09-01' }],
  '2.시공사마스터': [{ 통합ID: 'T001', 대표업체명: '시험업체A', 협약일: '2025-01-01', 연결상태: '확정' }, { 통합ID: 'T002', 대표업체명: '시험업체B', 협약일: '2025-01-01', 연결상태: '확정' }],
  '7.기술자문문의': [{ 통합ID: 'T001', 업체명: '시험업체A', 접수일: '2026-08-01', 현장명: '시험단지', 공종그룹: '우레탄' }]
};
const L3 = (id, d, extra) => Object.assign({ 단계: 'L3', 활동유형: '잔디 기술문의', 출처: '잔디', 활동일: d, 통합ID: id, 업체명: id, 현장ID: 'S1', 현장원문: '시험단지', 공종그룹: '우레탄', 대표여부: 'Y', 내부테스트: '', L3인정: '확정' }, extra || {});
const extra = {
  '21.잔디등_L3활동': [L3('T002', '2026-03-01'), L3('T002', '2026-03-02', { 대표여부: 'N' }), L3('T002', '2026-03-03', { L3인정: '제외' }), L3('', '2026-03-04'), L3('T002', '2026-03-05', { 내부테스트: 'Y' })],
  '23.경로전환_시공사별': [{ 통합ID: 'T002', 업체명: '시험업체B', '조합 수(업체×현장×공종)': '4', 'L2 건수': '0', 'L3 건수': '5', 'L4 공고 도달 조합': '2', 'L4 낙찰 도달 조합(누구든)': '1', '같은 업체 낙찰 조합': '1', '경로 구분(조합 수)': 'B L3만(L2 기록 없음) 4' }],
  '22.영업보고': []
};
const mk = ex => ({ has: n => !!base[n] || !!(ex && n in ex), objs: n => base[n] || (ex && ex[n]) || [] });
const a = Ops.build(mk(null), {}), b = Ops.build(mk(extra), {});
ok(!a.error && !b.error, 'ops 모델 생성(선택 탭 없음 / 있음)');
const ra = Object.fromEntries(a.rows.map(r => [r.id, r])), rb = Object.fromEntries(b.rows.map(r => [r.id, r]));
ok(a.rows.every(r => r.path === null), '21·23 탭이 없으면 path 는 null(기존 동작)');
ok(ra.T002.l3n === 0 && rb.T002.l3n === 1, '21탭 L3는 대표·확정/요청·업체 기재·내부테스트 아님인 1건만 반영 (' + ra.T002.l3n + ' → ' + rb.T002.l3n + ')');
ok(rb.T001.l3n === ra.T001.l3n, '21탭에 없는 시공사의 L3 건수는 변하지 않음');
ok(rb.T002.path && rb.T002.path.n === 4 && rb.T002.path.pub === 2 && rb.T002.path.win === 1 && rb.T002.path.winSame === 1, '23탭 경로(조합 4 · 공고 2 · 낙찰 1)가 시공사에 연결');
ok(rb.T001.path === null, '23탭에 없는 시공사는 path 없음');
ok(b.summary.hasL2Source === false, '22.영업보고 탭이 비어 있으면 L2 원천 없음 유지');
extra['22.영업보고'] = [{ 보고일: '2026-01-05', 업체: '시험업체B', 현장명: '시험단지', 주소: '', 공종: '우레탄', 구분: '영업보고', 원본ID: 'R1', 최종분류: 'L2 확정' }];
ok(Ops.build(mk(extra), {}).summary.hasL2Source === true, '22.영업보고에 L2 확정 행이 있으면 L2 원천 있음으로 전환');
console.log(fails ? '\n실패 ' + fails : '\n모두 통과'); process.exit(fails ? 1 : 0);
