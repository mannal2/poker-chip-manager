# 2026-10-21 보드·직전 행동 무르기

기준: origin/main 533a844. 브랜치: codex/board-single-undo-main.
사용자 승인: CLEAR, 중앙 단계 보드, 테이블 아래 팟, 1회 무르기, 마지막 폴드 확인 없이 다음 핸드 시작.

1. 게임 행동 snapshot과 기록 취소 확장 → verify: 스트리트/핸드/종료 경계, 예약, 1회 제한, 저장 재로드 단위 테스트.
2. 화면 무르기 및 마지막 폴드 자동 진행 → verify: 확인창 없음, 정산/종료에서도 복원, 저장 실패 보존.
3. 보드/CLEAR/팟 배치 → verify: 단계 강조, 복원/무르기, 2~10명/가로/작은 화면, 기존 디자인 계약.
4. 전체 테스트와 독립 리뷰 → verify: 단위/타입/린트/브라우저/PWA, production build.

각 작업 검증 후 로컬 커밋. push/PR/배포 제외.
Ruling: 사용자 요청대로 현재 checkout에서 origin/main 기반 새 브랜치 사용. 기존 preview 주소 유지.
Ruling: 새 게임 행동만 snapshot 교체. 블라인드 예약과 시점 변경은 기회를 소모하지 않음. 자동 정산/새 핸드는 원 행동과 함께 복원.
Ruling: 기존 저장 호환 유지. undo에 취소 대상 이벤트 ID를 추가해 RETURN/PAYOUT/HAND_START까지 정확히 취소; 구버전 UNDO는 기존 해석 유지.
진행: 시작.

## 완료 기록
- Task 1 complete: 7a30715 — 경계/기록/저장 재연결, 단위152 PASS.
- Task 2 complete: ea9c3eb — 화면 무르기·확인 없는 폴드, 게임 브라우저34 PASS.
- Task 3 complete: 640afce — 보드/CLEAR/팟, 관련206 + 보드8 PASS, 실제 스크린샷 확인.
- Review fix complete: 7b987a5 — 저장 재시도 후 승자 초안, RED2 → GREEN6, 단위152/린트 PASS.
- Test update complete: 42c210f — 폐기된 확인창 기대 제거, manager2 PASS.
- Final: 비-PWA 전체 실행372 PASS/구형 테스트2 FAIL/Chrome전용2 SKIP. 갱신된 실패2건 재실행 PASS. PWA14 PASS, 타입/린트/build PASS. 자세한 경과 IMPLEMENTATION_PROGRESS.md.
- Ruling: 최종 리뷰의 미검증 항목 중 geometry는 브라우저 스크린샷/겹침/반응형 테스트로 확인. 실기기 OS 저장 동작과 임의 손상 데이터의 진위 검증은 이번 범위 밖이며 기존 구조검증 유지.
- 브랜치는 사용자가 PR할 수 있도록 로컬 그대로 보존.
