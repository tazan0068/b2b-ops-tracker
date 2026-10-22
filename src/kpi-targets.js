/* 핵심 KPI 3개 목표치 — 팀장 확정 목표(설정값). 실적 숫자는 여기에 없고, 화면이 구글시트 집계에서 읽어 이 목표와 비교한다.
   · targets: 비율(0~1). base=기준 목표 · official=상향 공식 목표(달성률 기준) · challenge=도전 목표 · long=장기 목표(선택)
   · verification: 현재 실적이 이 목표와 "같은 정의"인지 확인한 결과(사람·검증이 갱신). match 가 true 가 아니면 목표는 표시하되 달성률은 '검증 필요'.
       match: true(확인됨) | false(정의 다름) | null(미확정) — 같은 숫자가 나와도 산식·원천·기준일 확인 전에는 true 로 두지 않는다.
   · 목표를 바꾸려면 이 파일의 숫자만 고친다(화면 코드는 숫자를 갖지 않는다). 분석 시작일은 2025-06-24 유지. */
(function (root) {
  root.B2B_KPI_TARGETS = {
    version: "2026-10-22", source: "팀장 확정 목표(2026-10-22 전달)", analysisStart: "2025-06-24",
    kpis: {
      kpi1: { name: "신규 MOU → 첫 인정 요청 활성화율", short: "신규 업체 사용률", targets: { base: 0.5, official: 0.6, challenge: 0.7, long: 0.8 } },
      kpi2: { name: "첫 L3 후 60일 다른 단지 재사용률", short: "재사용률", targets: { base: 0.8, official: 0.85, challenge: 0.9 } },
      kpi3: { name: "현장·공종·시공사별 L3 도달률", short: "L3 도달률", targets: { base: 0.3, official: 0.35, challenge: 0.4 } }
    },
    verification: {
      kpi1: { match: true, checkedAt: "2026-10-22", basis: "정의 v2.1(팀장 회의 기준 2026-10-22 전달): 협약일 +1년 이내 유효 L3(확정+요청) 1건 이상 ÷ 협약일 있는 신규 업체(협약일 ≥ 2025-06-24). 협약일은 고객관리카드 기준.",
        caution: "현재 실적은 협약 후 1년이 지나지 않은 업체를 포함한 '현재까지 확인' 값입니다. 회의표의 37.5%(3/8)는 산식·원천·기준일을 확인하지 못한 임시 고정값이라 현재 관측 완료 값과 같은 지표로 보지 않습니다." },
      kpi2: { match: false, checkedAt: "2026-10-22", basis: "현재 재사용률은 '분석 기간 내 첫 L3 이후 같은 시공사가 다른 아파트에서 다시 L3'(기간 제한 없음, 업체 확인 하한)입니다.",
        caution: "목표는 '첫 L3 후 60일 이내'인데 현재 값에는 60일 제한이 없어 같은 지표가 아닙니다. 60일 기준 집계가 시트에 반영되기 전에는 달성률을 계산하지 않습니다." },
      kpi3: { match: null, checkedAt: "2026-10-22", basis: "현재 집계는 L3 도달 업체×현장 조합까지만 있고, 공종 단위 조합과 분모(L2 경유 포함 모집단)가 확정되지 않았습니다.",
        caution: "분모 기준과 공종 단위 조합이 확정되고 L2(영업보고) 경유 자료가 연결되기 전에는 현재 실적을 만들지 않습니다." }
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
