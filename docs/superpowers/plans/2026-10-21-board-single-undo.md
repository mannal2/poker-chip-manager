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
