# Frontend deployment on the current EC2 server

This script deploys the existing frontend only. It does not restart edge Nginx,
change certificates, deploy a backend, delete images, or delete old assets.
The separate `DEPLOYMENT_SPEC.md` remains the broader implementation plan.

Prerequisites: Ubuntu with Bash, util-linux `flock`, curl, Docker Compose;
the existing project at `/home/ubuntu/poker-chip-manager`, `.env`, a healthy
frontend, the external `poker-edge` network and `poker-frontend-assets` volume.
The root Docker account must already have GHCR read access.

The service address is `https://pcm.jwlee.xyz/local/`. Before merging the workflow
that switches health checks to this domain, complete the one-time
[domain and HTTPS setup](edge/DOMAIN_SETUP.md) and verify its HTTPS response.
The IP endpoint remains available during the transition for existing local data.

## Upload from Windows PowerShell

Run from the repository root. Replace the address with the server's Tailscale IP.

```powershell
$deployHost = '100.x.x.x'
ssh -i "$env:USERPROFILE\.ssh\poker-actions" "ubuntu@$deployHost" 'mkdir -p /home/ubuntu/poker-chip-manager/deploy'
scp -i "$env:USERPROFILE\.ssh\poker-actions" ./deploy/deploy-frontend.sh "ubuntu@${deployHost}:/home/ubuntu/poker-chip-manager/deploy/"
```

## First manual deployment on EC2

```bash
cd /home/ubuntu/poker-chip-manager
bash -n deploy/deploy-frontend.sh
image=ghcr.io/mannal2/poker-chip-manager-frontend
sudo docker pull "$image:main"
digest=$(sudo docker image inspect --format '{{index .RepoDigests 0}}' "$image:main")
revision=$(sudo docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$digest")
printf 'Image: %s\nCommit: %s\n' "$digest" "$revision"
unit="poker-deploy-$(date +%s)"
sudo systemd-run --unit="$unit" --service-type=exec --wait --collect \
  /usr/bin/bash /home/ubuntu/poker-chip-manager/deploy/deploy-frontend.sh \
  "$digest" "$revision" https://pcm.jwlee.xyz
sudo journalctl -u "$unit" --no-pager -n 100
sudo docker compose ps frontend
sudo cat .local/deploy/current
```

Use a transient systemd **service**, without `--pipe`, `--pty` or `--scope`, so
deployment is managed independently of the SSH session. See the
[systemd-run manual](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html).
`--wait` reports the deployment result; detailed output is in the journal.
If SSH disconnects, reconnect and inspect that unit before requesting another deployment.

The script checks image revision, disk space, the existing HTTPS baseline, then
copies new assets without replacing previous asset files. It replaces only the
frontend and verifies its image ID and HTTPS file hashes. HTTP checks can retry
for approximately 120 seconds; individual requests also have timeouts.
During container replacement there may be a brief interruption.

On failure, it attempts to restore the previous exact image using a retained
local rollback tag. A successful rollback still returns failure for the deployment.
`.local/deploy/previous.env` stores the prior settings. Successful deployments
record the verified image in `current` and `lastHealthy`.

An interrupted deployment or failed rollback leaves `.local/deploy/pending`.
Further deployments stop with `RECOVERY_REQUIRED`. Inspect the journal, pending
record, running image and HTTPS response under the same deployment lock before
deciding to complete or roll back. Do not remove this marker merely to retry.

## Checking the host and adding swap

Before the backend rollout, run the read-only host check on the server and keep
its output. It prints `key=value` lines for architecture, memory, swap, disk,
Docker access and versions, container memory and the HTTP status of the service
address (`unknown` when unavailable), and no secrets:

```bash
cd /home/ubuntu/poker-chip-manager
bash deploy/check-host.sh
```

The measured host has 1907MiB of memory and no swap, which is below the backend
memory floor (see T79 in `TECH_DECISIONS.md`). The operator adds a 2GiB swap
file on the server; this is a manual server step and is not run by any script
here:

```bash
set -e
if ! swapon --show | grep -q '^/swapfile'; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
fi
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-poker-swap.conf
sudo sysctl --system
```

The block is safe to repeat: it skips creation while `/swapfile` is active and
adds the `/etc/fstab` line only once. Run it in a fresh shell, since `set -e`
would end an interactive session on failure.

Verify:

```bash
swapon --show
free -m
grep swapfile /etc/fstab
sysctl vm.swappiness
```

`swapon --show` should list `/swapfile` at 2G, `free -m` should show about 2047
in the Swap row, the fstab grep should print one line, and `sysctl` should print
`vm.swappiness = 10`. Run `bash deploy/check-host.sh` again to record it.

## Local verification and remaining work

```bash
bash -n deploy/deploy-frontend.sh
bash deploy/test-deploy-frontend.sh
```

The tests simulate Docker, HTTPS, time and lock refusal. They cover successful
deployment, lock refusal, interrupted state, pull failure, revision mismatch,
replacement failure, HTTPS failure, incorrect HTTPS content, and rollback
failure. They do not verify actual Docker behavior, kernel locking, systemd,
or EC2 networking. Those require the server trial above.

CI also runs `test-copy-frontend-assets.sh` inside the built Nginx image. This
executes the deployment script's actual copy command with BusyBox and verifies
that new files reach an existing shared directory without overwriting old files.
Copying `assets/.` with BusyBox `cp -n` skips the already-existing destination
directory, so the script passes Vite's asset files individually instead.

## GitHub Actions

`.github/workflows/ci-images.yml` runs checks for PRs. For main, successful
checks are followed by image publishing and then deployment over Tailscale/SSH.
PR checks also run the deployment script's syntax check and simulated tests.
The publishing job passes the pushed image digest to the deployment job;
deployment does not resolve the mutable `main` image tag again on the server.
Only the latest main commit at the pre-deployment check is eligible. Rerunning
an older commit skips deployment and does not update the main image tag.
A push arriving after that check can still allow the already-starting deployment
to complete; the next run deploys the newer commit. Main workflow runs are
serialized without cancelling the running workflow, and the server script
also takes a deployment lock.

Required repository Actions secrets (already used for the connection check):
`TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE`, `DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_SSH_KEY`, `DEPLOY_HOST_KEY`. The deployment job needs OIDC token write
permission for Tailscale; image publishing uses the built-in `GITHUB_TOKEN`.
See [job outputs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/pass-job-outputs)
and [workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

The server's Ubuntu account must support noninteractive `sudo` for systemd-run,
journalctl, and the existing root Docker setup. Actions checks out the exact
commit being deployed and uploads its deployment script over SCP before running
it. Each run and attempt gets a separate script filename in the project's
`deploy/` directory, so an already-running script is not overwritten. Failed
uploads stop deployment. These small script files are retained for diagnosis.
App code and deployment script updates therefore follow PR checks and main
merge without a manual script upload. Compose, edge configuration and the
initial server setup remain separately provisioned infrastructure.

The first automated deployment must still be verified in Actions and in the
browser after merging this workflow. The server script alone does not prove
Git ancestry or reject an older valid commit supplied by a manual operator.
Force-push and divergent-history protection are outside this initial workflow;
protect main against force pushes in repository settings.
It supports the current frontend's file paths; the shared volume preserves
`/assets/` files. Migration to Oracle ARM requires a matching ARM image and
verification on that server.
