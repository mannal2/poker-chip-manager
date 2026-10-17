# Oracle 무료 A1 확보 — 로컬 실행 안내

## 현재 상태

- 사용자가 오사카 가입과 VCN 생성·SSH 키 다운로드를 완료했다.
- 수동 A1 생성은 AD-1 `Out of capacity`로 실패했다.
- 사용자 승인: 자동 재시도 도구를 PC에 준비하고 **2 OCPU·12GB**로 요청한다.
- OCI API 인증을 확인하고 `jwlee-vcn`의 유일한 사용 가능한 공개 서브넷을 로컬 설정에 연결했다. 사용자 저장 파일 `config.txt`를 `config`로 바로잡았다. 지정 폴더의 SSH 공개키만 복사해 연결했으며 SSH 비밀키는 원래 위치에 그대로 두었다.
- 2026-10-17 자동 생성을 숨김 로컬 프로세스로 시작했다. 첫 생성 요청은 18:34 KST에 `500 InternalError: Out of host capacity.`로 실패했고 프로세스가 다음 재시도를 기다리는 것을 확인했다. VM 확보 성공은 아직 아니다.
- 실행 PID는 `.local/oci-instance-creation/runner.pid`, 표준 출력/오류는 `runner.stdout.log`와 `runner.stderr.log`에 기록한다. 숨김 실행은 터미널의 Ctrl+C로 중단되지 않는다. 중단 시 PID가 현재 이 도구 프로세스인지 확인한 뒤 자식 프로세스까지 종료해야 하며, 에이전트에게 중단을 요청할 수 있다. PC 재부팅 후 자동 시작은 설정하지 않았다.
- 앱 구현과 별개인 일회성 인프라 준비 작업이다.

## 도구와 변경 범위

- 원본: https://github.com/mohankumarpaluru/oracle-freetier-instance-creation
- 검토한 커밋: `7350a6e8ac946b653b67964225869d08a34c38de`
- 로컬 경로: `.local/oci-instance-creation/` (프로젝트 Git에서 제외)
- Python 3.10 가상환경을 사용한다. 설치된 의존성은 완료 후 `requirements.lock.txt`에 기록한다.
- 원본의 Linux 셸 설치 스크립트 대신 Windows용 `run_local.py`를 사용한다.
- 고정 요청: `ap-osaka-1`, `VM.Standard.A1.Flex`, 2 OCPU, 12GB, 부트 디스크 50GB, Ubuntu 24.04 ARM 호환 플랫폼 이미지, 공개 IPv4.
- 300초 간격으로 명확한 용량 부족 또는 요청 제한 거절만 재시도한다. PC 종료·절전 중에는 실행되지 않는다.
- 생성 요청 직전에 디스크에 배타적 pending 기록을 남긴다. 성공 또는 결과 불명 시 기록을 유지하여 재실행·동시 실행에 의한 중복 요청을 차단한다. SDK 내부 자동 재시도를 끄고 요청 토큰을 전달한다.
- 성공 응답 후 추가 생성 요청을 중단한다. 생성 요청 접수는 Running/SSH 접속 성공과 다르므로 콘솔에서 확인한다.
- 이메일·Discord·Telegram 알림은 사용하지 않는다.
- 읽기 전용 사전 검사: root 구획의 기존 A1(중지 포함), 공개 서브넷, 부트+블록 볼륨과 신규 50GB 합계 200GB 이내, 호환 이미지. 자식 구획이 있으면 사용량을 누락하지 않도록 중단한다.
- 한계: 계정 전체 청구·타 리전 자원 감사가 아니다. 실행 중 다른 창/도구로 VM을 병행 생성하지 않는다. 무료 확보·성공 시점·무과금을 보장하지 않는다.

## 사용자가 준비할 로컬 파일

비밀키 내용은 채팅이나 GitHub에 붙여넣지 않는다.

1. Oracle 프로필의 API Keys에서 별도 API 서명 키를 생성/등록한다. VM 접속용 SSH 키와 다르다.
2. API 비밀키를 `.local/oci-secrets/api-private.pem`에 보관한다.
3. 콘솔이 보여주는 Configuration File Preview를 `.local/oci-secrets/config`에 저장한다. `config.example`을 참고해 `key_file`을 비밀키 절대 경로로 지정하고 `region=ap-osaka-1`을 확인한다.
4. 앞서 받은 **SSH 공개키**를 `.local/oci-secrets/ssh-public.key`로 복사한다. SSH 비밀키는 기존 안전한 장소에 보관한다.
5. `.local/oci-settings.json`의 `subnet_id`에 `jwlee-vcn` 아래 **공개 서브넷 OCID**를 넣는다. VCN OCID와 다르다.

인증정보에는 현재 Windows 사용자만 접근하도록 파일 권한을 확인한다. 도구 준비 폴더를 공유하거나 전체 압축해 업로드하지 않는다. API 키의 권한은 해당 OCI 사용자의 IAM 권한을 따른다. 확보가 끝나면 일회성 API 키를 OCI에서 삭제해 폐기할 수 있다.

## 실행 (프로젝트 폴더의 PowerShell)

로컬 설정 검사 — OCI 요청 없음:

```powershell
& .\.local\oci-instance-creation\.venv\Scripts\python.exe .\.local\oci-instance-creation\run_local.py
```

읽기 전용 Oracle 사전 검사 — VM 생성 없음:

```powershell
& .\.local\oci-instance-creation\.venv\Scripts\python.exe .\.local\oci-instance-creation\run_local.py --preflight
```

위 검사를 통과하고 계정의 무료 사용량을 확인한 뒤 실행:

```powershell
& .\.local\oci-instance-creation\.venv\Scripts\python.exe .\.local\oci-instance-creation\run_local.py --run
```

- 실행은 한 창에서만 한다. 중단은 `Ctrl+C`.
- 생성 시도 로그: `.local/oci-instance-creation/launch_instance.log`.
- 생성 접수 기록: `.local/oci-instance-creation/state/created.json`.
- `launch-pending.json`이 남아 있으면 자동 재실행하지 않는다. 콘솔에서 생성 중·실행 중·중지된 인스턴스와 부트 볼륨을 확인한다. 요청 결과를 확실히 확인하기 전에는 이 파일을 지우지 않는다.
- 인증 실패·요금/한도 관련 오류는 설정을 확인한다. 유료 전환하지 않는다.

## 검증

- 네트워크 없이 수행한 10개 테스트: 성공 후 재생성 차단, 응답 유실 후 재시작 차단, 동시 요청 차단, 두 종류의 용량 부족 메시지/429 재시도, 알 수 없는 오류 중단, 중지된 A1 차단, 공개 서브넷 검증, 디스크 한도 검증.
- 인증정보 미설정 시 생성 전에 중단하는 것을 확인했다.
- 실제 OCI 인증과 오사카 root 구획 읽기 전용 조회를 수행했다. 활성 자식 구획 0개, 미종료 인스턴스 0개, 기존 디스크 0GB, 공개 서브넷의 기본 인터넷 경로와 활성 인터넷 게이트웨이를 확인했다.
- A1 호환 Ubuntu 24.04 이미지 3개를 조회했으며 현재 최신 이미지는 `Canonical-Ubuntu-24.04-aarch64-2026.09.18-0`이다. 이 조회는 A1 호스트의 실제 여유를 보장하지 않는다.
- SSH 공개키 연결 후 통합 사전 검사를 통과했고 첫 생성 요청 및 용량 부족 응답을 확인했다. VM 확보, SSH 연결은 아직 검증하지 않았다.
