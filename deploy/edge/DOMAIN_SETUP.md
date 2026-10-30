# pcm.jwlee.xyz로 전환하기

대상 주소는 `https://pcm.jwlee.xyz/local/`다. 가비아 네임서버를 사용하고,
`pcm` A 레코드를 현재 EC2 Elastic IP에 연결한다(기존 IP는 `54.180.47.226`).
현재 서버 경로는 `/home/ubuntu/edge`이며 기존 IP용 Nginx와 Certbot이
가동 중이고, `www`와 인증서 볼륨을 공유한다는 전제다.

**순서: DNS 확인 → 인증서 발급 → 도메인 Nginx 적용·HTTPS 확인 → PR 병합.**
새 워크플로는 도메인의 HTTPS를 검사하므로 서버 준비 전에 main에 병합하지 않는다.
이 문서의 명령은 아직 실제 서버에서 실행·검증하지 않았다.
앱 코드와 배포 스크립트는 계속 Actions로 배포한다. 최초 도메인 인증과 edge 설정은
별도 인프라 작업이며, 일반 앱 배포는 edge를 재시작하거나 인증서를 바꾸지 않는다.

## 1. DNS와 HTTP 인증 경로 확인

Windows PowerShell에서 A 레코드가 현재 Elastic IP인지 확인한다.
AAAA 레코드가 있다면 실제 서비스하는 IPv6 주소인지도 확인한다.

```powershell
Resolve-DnsName pcm.jwlee.xyz -Type A
```

EC2의 80/443 포트가 인터넷에 열려 있어야 한다. EC2 SSH 터미널에서:

```bash
cd /home/ubuntu/edge
sudo mkdir -p www/.well-known/acme-challenge
printf 'pcm-domain-check\n' | sudo tee www/.well-known/acme-challenge/pcm-domain-check > /dev/null
curl --fail --noproxy '*' http://pcm.jwlee.xyz/.well-known/acme-challenge/pcm-domain-check
```

`pcm-domain-check`가 출력되어야 한다. 현재 IP용 Nginx의 기본 HTTP 서버도
이 인증 경로를 처리하므로, 새 도메인 설정을 로드하기 전에 인증서를 받을 수 있다.
응답이 다르거나 실패하면 중단하고 DNS·HTTP 라우팅부터 확인한다.

## 2. 도메인 인증서 발급

EC2의 같은 터미널에서 알림을 받을 이메일을 입력한다.
IP용 `poker-ip` 인증서와 별개의 인증서를 만든다.

```bash
read -r -p '인증서 알림 이메일: ' certEmail
sudo docker compose run --rm -T certbot certonly \
  --webroot -w /var/www/certbot \
  --cert-name pcm.jwlee.xyz -d pcm.jwlee.xyz \
  --email "$certEmail" --agree-tos --non-interactive
```

발급 성공을 확인한 다음 단계로 진행한다. 새 설정은 이 인증서 파일을 참조하므로
인증서 발급 전에 Nginx 설정을 설치하지 않는다.
[Certbot webroot 설명](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot).

## 3. 도메인 Nginx 설정 설치

로컬 PowerShell의 저장소 루트에서 실행한다. `100.x.x.x`는 서버 Tailscale IP다.

```powershell
$deployHost = '100.x.x.x'
scp -i "$env:USERPROFILE\.ssh\poker-actions" ./deploy/edge/nginx/pcm.conf "ubuntu@${deployHost}:/home/ubuntu/edge/pcm.conf.upload"
```

EC2 SSH 터미널에서 설치·문법 검사·reload한다.
기존 `nginx/default.conf`와 IP용 인증서는 유지한다.

```bash
cd /home/ubuntu/edge
# 이미 도메인 설정이 있다면 덮어쓰기 전에 보관한다.
if [ -f nginx/pcm.conf ]; then
  sudo cp -p nginx/pcm.conf "pcm.conf.backup-$(date +%s)"
fi
sudo install -m 0644 pcm.conf.upload nginx/pcm.conf
sudo docker compose exec -T nginx nginx -t && \
  sudo docker compose exec -T nginx nginx -s reload
```

검사 실패 시 reload하지 않는다. 최초 설치라면
`sudo mv nginx/pcm.conf pcm.conf.failed`로 새 파일을 로드 대상에서 빼고 원인을 확인한다.
기존 설정을 수정한 경우에는 위에서 보관한 파일을 복원한 후 다시 검사한다.
reload는 기존 연결을 처리하면서 새 설정을 적용한다.
[Nginx reload 설명](https://nginx.org/en/docs/beginners_guide.html#control).

## 4. HTTPS·갱신 확인 후 자동 배포 전환

EC2에서 아래 HTTPS 요청이 성공하는지 확인한다. `-k`로 인증서 검사를 우회하지 않는다.
브라우저에서도 `https://pcm.jwlee.xyz/local/` 접속을 확인한다.

```bash
curl --fail --noproxy '*' https://pcm.jwlee.xyz/local/ -o /dev/null
sudo docker compose run --rm -T certbot renew --cert-name pcm.jwlee.xyz --dry-run
sudo systemctl status poker-cert-renew.timer --no-pager
sudo systemctl cat poker-cert-renew.service
```

기존 갱신 서비스가 `/home/ubuntu/edge`에서 `certbot renew`를 인증서 이름 제한 없이
실행하고, 성공 후 `nginx -t`와 reload를 수행하는지 확인한다. 이 구성이라면 새 도메인
인증서도 갱신 대상에 포함된다. 서비스가 다르면 실제 설정을 확인한 후 수정한다.
[Certbot 갱신 설명](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates).

위 확인이 끝나면 도메인 변경 커밋을 PR로 main에 병합한다. Actions가 이미지를
배포하고 `https://pcm.jwlee.xyz`를 통해 실행 이미지와 파일 내용을 검사한다.
`DEPLOY_HOST`는 Tailscale 주소로 유지한다. 이 값은 SSH 배포 대상이며 웹 도메인과 별개다.

IP에서 저장한 게임·기록·설치된 PWA는 도메인 주소에 자동으로 이전되지 않는다.
기존 IP의 HTTPS 접속은 당분간 유지하며, IP용 인증서·갱신도 삭제하지 않는다.
도메인으로 새 PWA를 설치할 수 있지만 중요한 기존 기록의 보존 방법을 먼저 확인한다.
