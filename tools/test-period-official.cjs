/**
 * 공식 분석 기간(2026-06-01~) 덧붙임 행 점검 시험 — 합성 자료만 사용
 *   node tools/test-period-official.cjs
 * 확인: ① 합성 공식 행이 check-period-tab.cjs 의 모든 점검을 통과 ② 운영 화면이 읽는 그룹(월별 L3)에 공식 행을 넣으면 실패
 *       ③ 공식 월별 합계가 어긋나면 실패
 */
const fs = require('fs'), path = require('path'), cp = require('child_process'), os = require('os');
const run = f => cp.spawnSync(process.execPath, [path.join(__dirname, 'check-period-tab.cjs'), f], { encoding: 'utf8' });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'period-official-sample.json'), 'utf8'));
const tmp = (name, obj) => { const f = path.join(os.tmpdir(), 'b2b-' + name + '.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };
ok(run(tmp('ok', fx)).status === 0, '합성 공식 행 20개가 모든 점검을 통과');
const bad1 = JSON.parse(JSON.stringify(fx)); bad1.rows.push(['월별 L3', '[공식] M2026-08', 300, null, null, '건', 'M2026-08', '시험', '시험']);
ok(run(tmp('bad1', bad1)).status === 1, '공식 행을 월별 L3 그룹에 넣으면 실패(운영 화면이 월로 읽음)');
const bad2 = JSON.parse(JSON.stringify(fx)); bad2.rows.find(r => r[1] === '[공식] 월별 L3 M2026-06')[2] = 999;
ok(run(tmp('bad2', bad2)).status === 1, '공식 월별 L3 합계가 유효 L3 건수와 다르면 실패');
const bad3 = JSON.parse(JSON.stringify(fx)); bad3.rows.push(['팀 행동', '[공식] └ 유형: 시험', 1, null, null, '건', '2026.06.01~2026.10.20', '시험', '시험']);
ok(run(tmp('ok3', bad3)).status === 0, '"[공식] └ 유형:" 접두 행은 운영 화면의 유형 합산과 겹치지 않아 통과');
/* ───── 시장 점유 행([시장]) ───── */
{
  let f2 = 0; const ok2 = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) f2++; };
  const mk = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'period-market-sample.json'), 'utf8'));
  ok2(run(tmp('mk-ok', mk)).status === 0, '시장 행 10개가 모든 점검을 통과(건수·비중·증감·2022~2024 원천 없음)');
  const b1 = JSON.parse(JSON.stringify(mk)); b1.rows.find(r => /비중\(시장 점유\) · 2026/.test(r[1]))[3] = 577;
  ok2(run(tmp('mk-b1', b1)).status === 1, '점유 분자가 건수 행과 다르면 실패');
  const b2 = JSON.parse(JSON.stringify(mk)); b2.rows.find(r => /우리 특허 포함 공고 · 2025/.test(r[1]))[8] = '우리 특허 포함 공고 합계';
  ok2(run(tmp('mk-b2', b2)).status === 1, '"POUR 단독이 아님" 표시가 없으면 실패(467·576을 POUR 단독으로 오해하지 않게)');
  const b3 = JSON.parse(JSON.stringify(mk)); b3.rows.push(JSON.parse(JSON.stringify(mk.rows[1])));
  ok2(run(tmp('mk-b3', b3)).status === 1, '같은 (구분, 지표) 키가 중복되면 실패(기존 지표와 키 충돌 방지)');
  const b4 = JSON.parse(JSON.stringify(mk)); b4.rows.find(r => /2022~2024/.test(r[1]))[2] = 1234;
  ok2(run(tmp('mk-b4', b4)).status === 1, '2022~2024 시장 전체 값을 만들어 넣으면 실패(추정 금지)');
  if (f2) fails += f2;
}
console.log(fails ? '\n실패 ' + fails : '\n모두 통과'); process.exit(fails ? 1 : 0);
