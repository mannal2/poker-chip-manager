# 새 구현 대화 인계 — Sol 모델

작성일: 2026-10-18. 이 파일은 새 대화에서 이전 긴 대화 없이 구현을 시작하기 위한 안내다.

## 목표와 시작 순서

사용자는 기획과 프로토타입 수정을 마무리하고, 새 대화에서 Sol 모델로 단일 기기 모드를 먼저 구현할 예정이다. 다음 사용자에게 ‘이제 기획부터 하자’고 다시 제안하거나 작은 선택마다 질문을 이어가지 않는다. 사용자가 구현 시작을 요청하면 아래 문서와 실제 저장소 상태를 확인하고 A00부터 진행한다.

1. `AGENTS.md`가 있으면 읽고 현재 사용자 지침과 함께 적용한다. 없는 경우에도 최소 변경·단순 구조·관련 검증·불확실성 공개 원칙을 따른다.
2. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): 전체 계획, 즉시 실행 범위A00~A11.
3. [DESIGN_BASELINE.md](DESIGN_BASELINE.md): 최종 디자인 계약. 고정 HTML을 실제 브라우저로 열어 확인한다.
4. [PLANNING.md](PLANNING.md)와 [UX_SPEC.md](UX_SPEC.md)의 최신 결정, [GAME_SPEC.md](GAME_SPEC.md)의 전체 계산·사례.
5. [SYSTEM_SPEC.md](SYSTEM_SPEC.md)의 로컬 저장·권한·순번·스키마. [TECH_DECISIONS.md](TECH_DECISIONS.md)의 이미 선택한 기술.
6. [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md): 실제 완료된 작업과 다음 작업.

## 최종 결정 요약

- React/TypeScript/Vite, 순수 규칙 함수, useReducer/필요한Context, IndexedDB+idb, Vitest/Playwright, 로컬 전용PWA.
- 2~9인 노리밋,1000/5/10 기본,5단위. 수동 승자, side pot/동률/짧은 all-in/턴/최소 raise/되돌리기 모두 MVP 필수.
- 디자인은 최종 시안 유지. 원형에 가까운 고정 테이블, 카드 이름+왼쪽핸드누적/오른쪽잔액, 화면별 테이블 크기 변화 없음.
- 베팅은 두 줄: 취소/콜·체크/폴드/올인, C/원형5/10/50/100/BET. 별도 금액 입력칸 없음.
- 카드 왼쪽은 H+d. 스트리트가 바뀌어도 H 유지, 다음 핸드에 초기화 및 새블라인드 납부. B는 내부 콜·레이즈 계산용.
- 전체 배경 통일, HAND 아래 블라인드 숫자, 우상단 관리 메뉴. 아래 초기화·기록 버튼 없음.
- 준비 입력의 항목명은 칸 내부 오른쪽. 정산은 테이블카드 선택·배경/테두리 강조, 체크동그라미 없음.
- 정산 하단은 `0명 선택` 등 인원만 WIN 바로 위 중앙. 중앙테이블의 팟은 유지.
- WIN 저장 완료 후 정산·탈락·D/SB/BB·블라인드납부·첫차례까지 한 번 처리. 최종1명은 토너먼트종료. 별도 핸드완료화면 없음.
- 상태/기록 저장 성공 전 확정UI 금지. 실패 시 기존값 보존·재시도. 다른탭 인수는 세대로 검증.
- `/local/`만 PWA. 온라인은 후속. 실기기 iPhoneSafari/AndroidChrome 양쪽 목표.

## 절대 혼동하지 말 것

`prototype/index.html`은 제품 게임 엔진이 아니다. 폴드·side pot·정규 턴·데드 버튼·영속 저장·전체 validation이 생략되어 있다. 디자인만 기준으로 삼고 계산은 GAME_SPEC을 실제로 구현한다. ‘시안 체험’ 메뉴로 단계를 강제 이동하는 코드도 제품에 옮기지 않는다.

과거 시안 이미지 `prototype/mobile-*.png`, `variant-*.png`, `revision-4*.png` 등은 최종 정산 조정 이전일 수 있다. 유일한 시각 기준은 `prototype/approved-2026-10-18/`와 DESIGN_BASELINE이다. 현재 임시 미리보기 주소의 서버가 켜져 있다고 가정하지 않는다. HTML은 직접 열 수 있다.

## 작업 환경·보호 범위

- Windows PowerShell, 저장소 경로 `C:\Users\dlwjd\Desktop\poker-chip-manager`.
- 작성 당시 제품 scaffold 없음, 문서·시안은 untracked, origin은 사용자가 지정한 GitHub 저장소. 실제 상태를 다시 읽는다. 기존 변경을 지우지 않는다.
- `.local/`은 ignore된 OCI 도구·자격 증명 영역이다. 키 원문·비밀파일을 읽거나 공개하지 않는다. OCI 재시도프로세스는 건드리지 않는다.
- 이 대화에서 server/domain/CI 설정을 실제 적용하지 않았다. 자동 생성·재시작·배포 금지. 로컬 구현·검증을 먼저 완료한다.
- 기본 shell 실행이 MXC 볼륨 오류로 실패했던 환경이다. 같은 오류가 나면 코드 문제로 오인하지 말고 필요한 명령의 실행 권한 경로를 확인한다. 실패한 검사를 PASS로 적지 않는다.

## 진행 방식

사용자는 질문이 끝없이 늘어나는 것을 싫어한다. 이미 확정한 선택을 다시 묻지 말고 자율적으로 구현한다. 새 주요 기술/제품정책의 선택만 근거·대안을 묶어 질문한다. 기술/코드 구조 선택은 TECH_DECISIONS, 기능정책은 PLANNING/UX_SPEC, 실제진척은 IMPLEMENTATION_PROGRESS에 기록한다.

작업마다 진행상황·관련테스트·남은검증을 간결하게 알려준다. 컨텍스트가 끝나기 전에 코드상태·테스트명령·실패·다음작업을 남긴다. 실제 앱과 실기기를 실행하지 않고 구현/검증완료를 주장하지 않는다.

## 새 대화에 붙여넣을 요청

> 이 저장소의 START_HERE.md와 IMPLEMENTATION_PLAN.md를 읽고 단일 기기 모드 A00~A11 구현을 시작해줘. DESIGN_BASELINE.md와 prototype/approved-2026-10-18/의 최종 디자인을 유지해. 시안의 임시 게임 로직은 옮기지 말고 GAME_SPEC.md의 규칙을 테스트 가능한 구조로 구현해. 관련 명세와 TECH_DECISIONS.md도 확인하고, 완료한 작업·실행한 검증·다음 작업을 IMPLEMENTATION_PROGRESS.md에 계속 기록해. 멀티플레이와 실제 서버 배포는 아직 시작하지 마.
