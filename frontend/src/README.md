# 프런트엔드 코드 구조

같은 게임 UI는 모드에 관계없이 `features/gameplay`의 컴포넌트를 사용합니다. 모드별 화면은 상태와 권한을 해석하고, 공통 UI의 콜백을 저장 또는 통신 명령에 연결합니다.

| 위치                              | 책임                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| `app/`                            | 진입점 공통 시작(`mount`), 루트 이동과 온라인 준비 중 화면           |
| `game/`                           | React·저장소·통신에 의존하지 않는 순수 게임 규칙과 타입              |
| `features/gameplay/`              | `GameScreen` 화면 조립과 모드가 채우는 `GameSession` 계약            |
| `features/gameplay/components/`   | 테이블·플레이어 카드·보드·입력·기록·정산 UI                          |
| `features/gameplay/hooks/`        | 공통 입력 상태, 준비 편집, 좌석 드래그와 칩 애니메이션               |
| `features/gameplay/model/`        | 화면 표시 데이터, 좌석 배치, 기록 변환과 칩 이동 타입                |
| `features/gameplay/styles/`       | 기존 게임 화면과 컨트롤 스타일                                       |
| `features/local-game/`            | 로컬 화면 조합과 복구 상태의 수명                                    |
| `features/local-game/hooks/`      | 로컬 세션·인원·회전·칩 이동 연결                                     |
| `features/local-game/storage/`    | IndexedDB, 저장 원자성, 조작권, 복원과 제한 시간                     |
| `features/local-game/model/`      | 로컬 화면 상태와 로컬 명령 기반 칩 이동 계산                         |
| `features/local-game/components/` | 로컬 홈·관리 메뉴                                                    |
| `features/pwa/`                   | 로컬 전용 서비스 워커 등록, 설치·업데이트와 안내 정책                |
| `shared/`                         | 범용 다이얼로그, 화면 크기 조절, 토스트, 브라우저 정책과 전역 스타일 |

## 의존성 기준

- `gameplay`는 `game`과 `shared`를 사용할 수 있으며 로컬 저장소나 모드별 운영 코드를 가져오지 않습니다.
- `local-game`은 공통 게임 UI·규칙·PWA를 조합합니다. 저장 확정·동일 요청 재시도·조작권 검사는 로컬 영역에 둡니다.
- `pwa`는 필요한 범용 UI를 사용합니다. 공통 게임 UI가 서비스 워커를 등록하지 않습니다.
- `shared`는 기능 폴더와 게임 규칙을 가져오지 않습니다.
- 입력 Hook에 전달하는 scope는 호출자가 정합니다. 베팅은 상태 버전도 검사하고, 승자 선택 scope는 버전만 바뀌었다고 바꾸지 않습니다.

## 멀티플레이 추가 시

실제 구현이 시작되면 `features/online-game`에 페이지·통신·재접속·권한 처리를 둡니다. 공통 UI에는 필요한 표시 값과 조작 가능 여부, 사용자 의도 콜백을 전달합니다. 서버 계약과 화면 데이터의 변환은 온라인 영역에서 담당합니다. 로컬 칩 이동 예측을 온라인의 확정 결과로 사용하지 않습니다.

`/local/`과 `/online/` 사이의 문서 탐색, 로컬 전용 PWA 범위와 업데이트 정책을 유지합니다. 진입점은 `main.local.tsx`·`main.online.tsx`·`main.home.tsx`로 나뉘어 있고, precache 목록은 `e2e/entry-routes.spec.ts`가 로컬 진입점의 실제 의존 파일과 비교합니다. 소스 폴더를 나누는 것만으로 서비스 워커 캐시가 분리되지는 않습니다.

현재 CSS 파일의 선택자와 로딩 순서는 유지합니다. 컨트롤 스타일에 포함된 다이얼로그 등 전역 선택자를 나누는 작업은 별도의 스타일 변경으로 취급합니다. 테스트 위치와 저장소 루트의 `shared/game-fixtures`도 유지합니다.
