/**
 * 기간 KPI 집계 탭(20.기간KPI집계) 정확성·보안 점검 — 읽기 전용
 *   node tools/check-period-tab.cjs <집계탭.json | 공개 집계 JSON | URL | (생략 시 public-config.json 의 url)>
 *   입력 형식: { header, rows } 또는 공개 집계 JSON({ tabs: { "20.기간KPI집계": { header, rows } } })
 * 점검: 열 구조 · 구분 허용 목록 · 숫자 열 형식 · 값 = 분자÷분모 · 월별 행(M2025-06…)의 부분 월 표시 · 메인 카드 값과 월별 마지막 값 일치 · 개인정보 패턴
 */
const fs = require('fs'), path = require('path');
const HEADER = ['구분', '지표', '값', '분자', '분모', '단위', '기간', '검증상태', '근거'];
const GROUPS = ['신규 업체 사용률', '재사용률', 'L3 도달률', '팀 행동', '월별 L3', '월별 공고', '월별 낙찰', '협약일', '관리 대상', '핵심 시공사', '결과 성과'];
const BAD = /@|https?:\/\/|www\.|\d{2,3}-\d{3,4}-\d{4}|\d{3}-\d{2}-\d{5}/i;
async function loadTab(arg) {
  let j;
  if (!arg) arg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public-config.json'), 'utf8')).url;
  if (/^https?:/.test(arg)) j = await fetch(arg).then(r => r.json()); else j = JSON.parse(fs.readFileSync(arg, 'utf8'));
  return j.tabs && j.tabs['20.기간KPI집계'] ? j.tabs['20.기간KPI집계'] : j;
}
(async () => {
  const t = await loadTab(process.argv[2]); let fails = 0, warns = 0;
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }, warn = (m) => { console.log('WARN ' + m); warns++; };
  ok(Array.isArray(t.header) && t.header.join('|') === HEADER.join('|'), '열 머리글이 약속과 같음');
  const R = (t.rows || []).map(r => { const o = {}; HEADER.forEach((h, i) => o[h] = r[i] === '' ? null : r[i]); return o; });
  ok(R.length > 0 && R.length <= 400, '행 수 ' + R.length + ' (1~400)');
  ok(R.every(r => GROUPS.includes(r.구분)), '모든 행의 구분이 허용 목록 안');
  ok(R.every(r => [r.값, r.분자, r.분모].every(v => v === null || (typeof v === 'number' && isFinite(v)))), '값·분자·분모는 숫자 또는 공란');
  const ratio = R.filter(r => r.단위 === '비율' && r.분모 > 0);
  ok(ratio.every(r => Math.abs(r.값 - r.분자 / r.분모) < 0.0005), '비율 행 ' + ratio.length + '개: 값 = 분자 ÷ 분모');
  ok(R.every(r => [r.지표, r.기간, r.검증상태, r.근거].every(v => v === null || (String(v).length <= 200 && !BAD.test(v)))), '문자열에 개인정보 패턴(이메일·URL·전화·사업자번호)·과도한 길이 없음');
  const months = R.filter(r => /^M\d{4}-\d{2}$/.test(String(r.지표)) && r.구분 === '월별 L3');
  if (months.length) { ok(months[0].지표 === 'M2025-06', '월별 첫 달이 2025-06(분석 시작월)'); ok(/6\/24|24일/.test(String(months[0].근거 || '') + String(R.find(r => /6\/24~30/.test(String(r.근거 || '')) ) ? '6/24' : '')), '2025-06 부분 기간(6/24~30) 표시가 집계 근거에 있음'); }
  const mk = g => R.filter(r => r.구분 === g && /^M\d{4}-\d{2}$/.test(String(r.지표)));
  const main1 = R.find(r => r.구분 === '신규 업체 사용률' && r.지표 === '관측 중(협약 후 1년 미만)'), m1 = mk('신규 업체 사용률');
  if (m1.length && main1) ok(m1[m1.length - 1].분자 === main1.분자 && m1[m1.length - 1].분모 === main1.분모, '신규 업체 사용률 월별 마지막 값이 메인 카드 분자·분모와 같음(' + main1.분자 + '/' + main1.분모 + ')'); else warn('신규 업체 사용률 월별 행 없음(집계 미반영)');
  const main2 = R.find(r => r.구분 === '재사용률' && /^첫 L3 후 60일 내/.test(String(r.지표))), m2 = mk('재사용률');
  if (m2.length && main2) ok(m2[m2.length - 1].분자 === main2.분자 && m2[m2.length - 1].분모 === main2.분모, '재사용률 월별 마지막 값이 60일 기준 메인 값과 같음'); else warn('재사용률 60일 기준 또는 월별 행 없음');
  const l4 = R.filter(r => r.구분 === 'L3 도달률' && /^L3 → L4/.test(String(r.지표)));
  if (l4.length) ok(l4.every(r => /L2 원천 없음|경로 미확정/.test(String(r.검증상태))), 'L3→L4 행은 모두 "경로 미확정/L2 원천 없음"으로 표시(직접 진입 확정 아님)'); else warn('L3→L4 행 없음(집계 미반영)');
  ok(!R.some(r => r.구분 === 'L3 도달률' && /L2 경유 L3 → L4/.test(String(r.지표)) && r.값 !== null), 'L2 경유 경로는 값을 만들지 않음(원천 없음)');
  console.log('\n' + (fails ? '실패 ' + fails + '건' : '모두 통과') + (warns ? ' · 경고 ' + warns + '건' : ''));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('점검 실패:', e.message); process.exit(2); });
