# Frontend deployment on the current EC2 server

`deploy-frontend.sh` deploys the existing frontend only. It does not restart edge Nginx,
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

## Backend deployment

`deploy-backend.sh` replaces only the backend. It never restarts edge or the
frontend, and it shares `.local/deploy/lock` with every other script here.

### First-time server order

Do these manual steps in this order. Compose refuses to read a `compose.yaml`
with a backend service until the variables exist, and refuses a missing gate
directory, because an absent directory must never read as an open gate.

1. Add `BACKEND_IMAGE`, `BACKEND_MEM_LIMIT=768m` and `BACKEND_HEAP=384m` to `.env`.
   `BACKEND_IMAGE` must be the digest you are about to deploy.
2. Create the gate directory: `sudo install -d -m 0755 .local/deploy/gate`
3. Only then copy the new `compose.yaml` to the server. No script does this.

The production Origin in `application.yaml` must match the `<origin>` argument:
the `/ws` health check is sent with that Origin and gets 403 otherwise.

### Running it

```bash
image=ghcr.io/mannal2/poker-chip-manager-backend
digest=$(sudo docker image inspect --format '{{index .RepoDigests 0}}' "$image:main")
revision=$(sudo docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$digest")
unit="poker-backend-deploy-$(date +%s)"
sudo systemd-run --unit="$unit" --service-type=exec --wait --collect \
  /usr/bin/bash /home/ubuntu/poker-chip-manager/deploy/deploy-backend.sh \
  "$digest" "$revision" https://pcm.jwlee.xyz "$unit"
sudo journalctl -u "$unit" --no-pager -n 100
```

| Exit | Output | Meaning |
|---|---|---|
| 0 | `DEPLOYED` | The new backend is healthy and starts are open |
| 3 | `HELD` | A tournament is in progress; nothing changed. Run it again later |
| 1 | `ROLLED_BACK` | The new image failed; the previous one runs and starts are open |
| 1 | `RECOVERY_REQUIRED` | Starts stay closed; run the recovery script |
| 1 | other messages | Stopped before replacing; nothing was changed |
| 2 | | Invalid input or missing `.env` values |

`RECOVERY_REQUIRED` names the case: `NO_PREVIOUS_IMAGE` for a first deployment
that failed, `ROLLBACK_FAILED` when the previous image also failed. Waiting
never reopens starts. A backend that is restarting does not answer prepare, so
the deployment stops without replacing it; investigate that backend first.

The order follows `DEPLOYMENT_SPEC.md` section 4: checks and image pull, prepare,
closed `gate/start-gate.json`, a final status check, replacement, up to 120 seconds
of health checks through edge, then `backend-current` and `backend-lastHealthy`,
a `COMPLETE` gate file, and release. A release is believed only after status
reads `startsClosed:false`. Health means the target commit in `/api/health`,
HTML from `/online/`, and 401 from `/ws` for an upgrade request with no session.

`.local/deploy/backend-pending` exists from before prepare until the end of the
deployment, and a closed gate file is written before prepare too. `HELD` or an
abandoned attempt restores `COMPLETE` before removing the marker. While the marker
exists, `deploy-backend.sh` and `deploy-frontend.sh` refuse to run; the frontend's
`pending` file stops `deploy-backend.sh` the same way. Do not delete either to retry.

The script needs `backend-lib.sh` beside it. It also refuses a running backend that
does not answer, or one whose starts are closed with no marker.

### Recovery

```bash
sudo bash deploy/recover-backend.sh
```

It takes the same lock without waiting, so a live deployment is refused and left
alone. It then reads the running image and `backend-pending`:

- The new image is running after replacement began and passes health: it finishes
  the deployment (`RECOVERED completed`).
- The previous image is running and passes health: it reopens starts without
  restarting that server (`RECOVERED rolled-back`).
- Otherwise it restores the previous image and rechecks it, along with
  `backend-current` and `backend-lastHealthy`. It replaces a backend only when it
  is proved free of games: status reads closed with 0 tournaments, or status is
  unreadable but the deployment was proved closed and has not reached the
  `releasing` phase. From `releasing` on, unreadable status stops recovery. If
  Docker cannot say what is running, recovery stops too.
- A first deployment has nothing to restore. The failed backend is stopped, starts
  stay closed, and the next deployment may run.

| Exit | Output | Meaning |
|---|---|---|
| 0 | `NOTHING_TO_RECOVER` | No marker, and starts are open or no backend runs |
| 0 | `RECOVERED ...` | Completed, rolled back, or the gate was opened |
| 1 | `UNOWNED_GATE_CLOSED` | No marker, but this backend's starts are closed |
| 1 | `RECOVERY_REQUIRED` | Unresolved; the marker and gate stay. Fix the cause and rerun |
| 1 | `NO_PREVIOUS_IMAGE` | Failed first deployment stopped; starts stay closed |
| 2 | | Invalid arguments |

**Closed starts with no marker.** Find out why before opening them, then:

```bash
sudo bash deploy/recover-backend.sh --open-unowned-gate https://pcm.jwlee.xyz
```

It takes the lock and refuses a marker. It needs readable status showing closed
starts with 0 tournaments and a passing health check. It then writes `COMPLETE`,
releases with the holder and process id from status, and re-reads status.

**A previous server that stays unhealthy.** Recovery never replaces it, because it
may hold games. If you accept losing whatever it holds, read the status once:

```bash
sudo docker compose exec -T backend curl -fsS http://127.0.0.1:8080/internal/deploy/status
```

Then stop it with `sudo docker compose stop backend` and rerun recovery. With no
container running, recovery starts the previous image and rechecks it. This is a
manual decision; no script makes it.

### Pruning images

```bash
sudo bash deploy/prune-images.sh
```

Under the lock it recalculates what to keep: images used by this project's
containers, everything named by the `current`, `lastHealthy` and `pending` files of
both services and by `.env`, plus the five newest other images per service. It
removes only names in the two project repositories and the `poker-backend` and
`poker-frontend` rollback tags, never with force. Docker refuses to remove an image
in use, and the script reports that and carries on. It does not touch volumes,
assets or certificates, and it never runs `docker system prune`.

## Local verification and remaining work

```bash
bash -n deploy/*.sh
bash deploy/test-deploy-frontend.sh
bash deploy/test-deploy-backend.sh
```

`test-deploy-backend.sh` simulates Docker, HTTPS, time and the internal API. Where
`flock` is missing, as on Git Bash, it prints a `SKIP` for the one real-lock check
and stubs lock refusal instead. File modes only bite on Linux, so run it there as
well. It does not prove a real replacement; that needs a trial on the server.

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
