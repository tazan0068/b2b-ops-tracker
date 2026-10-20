# 읽기 전용 Apps Script 웹앱 — 배포 순서와 보안 모델

`Code.gs`를 데이터 스프레드시트에 붙여 배포하면 트래커가 시트를 비공개로 둔 채 읽을 수 있습니다.

## 배포 (스프레드시트 소유자)
1. 스프레드시트 열기 → **확장 프로그램 → Apps Script**.
2. `Code.gs` 내용을 편집기에 붙여넣고 저장.
3. **⚙ 프로젝트 설정 → 스크립트 속성**: `ACCESS_KEY` = 32자 이상 무작위 문자열. (선택) `ALLOWED_SHEET_IDS` = 쉼표로 구분한 추가 허용 시트 ID(테스트 사본 등).
4. **배포 → 새 배포 → 웹 앱**: 실행 사용자 **나**, 액세스 권한 **모든 사용자** → 배포 → 액세스 승인.
5. 웹 앱 URL(`…/exec`)을 트래커의 **연결 설정**에 입력합니다. 키는 트래커 사용자가 직접 입력하며 어디에도 기록하지 않습니다.

자기 확인: 주소창에 `웹앱URL?action=meta&key=키` → `{"ok":true,"meta":{…}}`.

## 보안 모델
- 읽기 전용(쓰기 호출 없음). 사용하는 서비스: SpreadsheetApp · PropertiesService · CacheService · ContentService.
- 키는 요청 본문(POST, `text/plain` JSON)으로 받습니다. GET은 `action=meta` 자기 확인만 허용합니다.
- 키 상수 시간 비교, 16자 미만 거부, 10분당 300회 호출 한도, 허용 시트 ID 외 거부.
- 응답은 `{ok, …}` JSON이며 오류에 데이터·키를 포함하지 않습니다.
- "모든 사용자" 배포는 URL을 아는 사람이 호출할 수 있다는 뜻이지만 키 없이는 데이터가 반환되지 않습니다. 키 유출이 의심되면 스크립트 속성에서 키만 교체하면 됩니다(재배포 불필요).

## 요청·응답 형식
```
POST <웹앱URL>  Content-Type: text/plain
{ "key": "...", "action": "meta" }
{ "key": "...", "action": "tab", "tab": "탭이름", "offset": 0, "limit": 5000 }
{ "key": "...", "action": "tabs", "tabs": "탭A,탭B" }
```
응답: `{ ok:true, meta:{ title, spreadsheetId, servedAt, tabs:{name:{rows,cols}} } }` / `{ ok:true, tab, header, rows, offset, total }` / `{ ok:true, tabs:{…}, meta }`.
