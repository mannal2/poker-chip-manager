# 2026-10-23 폴드 제한·실행 시 업데이트 안내

기준 origin/main ff01f14, codex/fold-guard-startup-update. 사용자 승인: 최신 원격 main에서 새 브랜치. 로컬 작업별 검증/커밋, push/PR/배포 제외.

1. UI 콜0에서 폴드 비활성 및 동작 차단 → verify: BB옵션/각스트리트/베팅 응답/짧은 올인. 규칙엔진의 유효 폴드와 과거 저장은 유지.
2. 앱 실행 홈 백그라운드 업데이트 확인, ready 새 버전에만 안내 → verify: 최신/오프라인/오류 무표시, 게임중 억제/홈복귀, 나중에/바깥클릭 이번실행 재표시방지/재실행, 안전한 적용/저장실패/수동창.
3. 전체 회귀/독립 리뷰/production preview → verify: 단위/타입/린트/브라우저/PWA.

Ruling: 실행은 새 document 로드 기준. 저장복구로 LocalGame이 재마운트되어도 같은 document에서는 자동 안내 횟수를 보존한다. 재시작/새로고침은 새로운 실행.
Ruling: 업데이트 확인은 앱 사용을 막지 않으며 기존 수동 확인/안전한 적용 경로 재사용. 홈에서 다른 대화상자가 열렸으면 닫힌 뒤 안내. 최초 설치 자체는 업데이트로 오인하지 않는다.
Pre-flight: Task1 UI만 변경, Task2 PWA/홈 대화상자만 변경. 공유 GameState/저장 스키마 변경 없음.
진행: 완료.

- 구현 커밋: 3e578fb(콜0 폴드 제한), 93a0554(실행 시 업데이트 안내), 7933118(적용 중 늦은 설치 제안 경합 수정).
- 일반 브라우저 회귀392 PASS/2 SKIP/0 FAIL. 2건은 WebKit에서 지원하지 않는 Chromium CDP 터치 검사이며, 이 전체 실행은 마지막 경합 수정 전에 수행했다.
- 경합 수정 후 PWA 전체24 PASS, 단위157 PASS, 전체 src/e2e/tests ESLint·TypeScript·production build PASS. 자동 적용 중 설치 이벤트 경합도 RED→GREEN으로 확인했다.
- 최신 production preview4173 HTTP200, main-DPVJqOk8.js. production 산출물에 e2e 없음.
- 실기기 확인은 미수행. 로컬 커밋만 수행했으며 push/PR/merge/배포는 하지 않았다.
