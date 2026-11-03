# Deployment on the current EC2 server

`deploy-frontend.sh` deploys the frontend and `deploy-backend.sh` the backend. Neither
restarts edge Nginx, changes certificates, deletes images, or deletes old assets.
`DEPLOYMENT_SPEC.md` holds the requirements and marks where this implementation
differs. The one-time multiplayer go-live, in its fixed order, is
[GO_LIVE.md](GO_LIVE.md); this file is the reference for each script.

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

The measured host has 1907MiB of memory and had no swap, which is below the backend
memory floor (see T79 in `TECH_DECISIONS.md`). The operator added a 2GiB swap
file on the server (verified: 2G, `vm.swappiness = 10`). This is a manual server
step and is not run by any script here:

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
adds the `/etc/fstab` line only once. `set -e` ends the shell it runs in when a
command fails, so type `bash` first to open a child shell, paste the block there,
and `exit` afterwards. Pasted straight into the SSH login shell, a failure would
close the session.

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
   For a manual run, `BACKEND_IMAGE` is the digest you are about to deploy. Before the
   first deployment through Actions that digest does not exist yet, so put a
   placeholder in the same form (`ghcr.io/mannal2/poker-chip-manager-backend@sha256:`
   followed by 64 zeros). Nothing pulls or starts it: a first deployment has no
   running backend to read it from, and the deployment rewrites the line.
2. Create the gate directory: `sudo install -d -m 0755 .local/deploy/gate`
3. Only then copy the new `compose.yaml` to the server. No script does this.
4. Install the edge configuration that routes `/api/` and `/ws` to `poker-backend`
   (`edge/nginx/pcm.conf`, `nginx -t` then graceful reload). The health check below
   goes through edge, so a first deployment fails while edge still sends those
   paths to the frontend.

The production Origin in `application.yaml` must match the `<origin>` argument:
the `/ws` health check is sent with that Origin and gets 403 otherwise.
[GO_LIVE.md](GO_LIVE.md) gives the commands, checks and rollback for each step.

### Running it

```bash
image=ghcr.io/mannal2/poker-chip-manager-backend
sudo docker pull "$image:main"
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
| 1 | `RECOVERY_REQUIRED` | Unfinished; run the recovery script. Starts are closed, except: open with `GATE_MOUNT_BROKEN`, unknown if the backend does not answer |
| 1 | other messages | Stopped before replacing; nothing was changed |
| 2 | | Invalid input or missing `.env` values |

`RECOVERY_REQUIRED` names the case: `NO_PREVIOUS_IMAGE` for a first deployment
that failed, `ROLLBACK_FAILED` when the previous image also failed, and
`GATE_MOUNT_BROKEN` when the new backend reads open while the gate file is closed.
That backend can accept games, so it is left running, as is any backend that does
not answer. Waiting never reopens
starts. A backend that is restarting does not answer prepare, so
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

After a deployment from Actions, run the copy in that run's directory instead (see
**Failure** under GitHub Actions); the stable copy above is not refreshed by CI.
It takes the same lock without waiting, so a live deployment is refused and left
alone. It then reads the running image and `backend-pending`:

- The new image is running after replacement began and passes health: it finishes
  the deployment (`RECOVERED completed`).
- The previous image is running and passes health: it reopens starts without
  restarting that server (`RECOVERED rolled-back`).
- Otherwise it restores the previous image and rechecks it, along with
  `backend-current` and `backend-lastHealthy`. If Docker cannot say what is
  running, recovery stops.
- A first deployment has nothing to restore. The failed backend is stopped, starts
  stay closed, and the next deployment may run.

One rule covers every replacement or stop, in both scripts and every phase: no
backend container is running, or status is readable with `startsClosed:true` and
0 tournaments. Anything else ends in `RECOVERY_REQUIRED`, so a running backend
that does not answer always needs an operator to stop it first.

| Exit | Output | Meaning |
|---|---|---|
| 0 | `NOTHING_TO_RECOVER` | No marker, and starts are open or no backend runs |
| 0 | `RECOVERED ...` | Completed, rolled back, or the gate was opened |
| 1 | `UNOWNED_GATE_CLOSED` | No marker, but this backend's starts are closed |
| 1 | `RECOVERY_REQUIRED` | Unresolved; the marker stays. Depending on where it stopped, the backend may have been stopped or restarted and starts may be open or closed, so check `docker compose ps backend` and status before rerunning |
| 1 | `NO_PREVIOUS_IMAGE` | Failed first deployment stopped; starts stay closed |
| 2 | | Invalid arguments |

**`GATE_MOUNT_BROKEN`.** The gate file is closed but the running new backend reads
open, so it can hold games. Recovery exits 1 and leaves `backend-current` and
`backend-lastHealthy` unchanged. Fix the `.local/deploy/gate` mount, then recreate
the backend so it boots closed, after checking status for tournaments, and rerun
recovery.

**A running backend that does not answer.** Recovery will not guess, whichever
image it runs. Find out why status fails. If you accept losing whatever that
backend holds, stop it with `sudo docker compose stop backend` and rerun recovery.

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

## Operational checks

Run on the server from `/home/ubuntu/poker-chip-manager`. None of these change
anything, and none print cookies, keys or request bodies. The scripts run as root
under `umask 077`, so after an automated deployment `.local/deploy` should be 0700
and `.env` 0600, both owned by root; hence the `sudo`. Those modes are derived from
the scripts; confirm them once with `sudo stat -c '%a %U %n' .local .local/deploy .env`.

```bash
# Service state, restarts and OOM kills
sudo docker compose ps
id=$(sudo docker compose ps -q backend)
sudo docker inspect --format '{{.State.Status}} restarts={{.RestartCount}} oom={{.State.OOMKilled}} started={{.State.StartedAt}}' "$id"

# Running image against the deployment records
sudo docker inspect --format '{{.Image}}' "$id"
sudo grep -E '^(BACKEND|FRONTEND)_IMAGE=' .env
sudo cat .local/deploy/backend-current .local/deploy/current
sudo ls .local/deploy/       # backend-pending or pending means RECOVERY_REQUIRED

# Version through edge, and rooms, games and the start gate inside the container
curl -fsS https://pcm.jwlee.xyz/api/health
sudo docker compose exec -T backend curl -fsS http://127.0.0.1:8080/internal/deploy/status

# Recent errors
sudo docker compose logs --since 1h --no-color backend | grep -E ' (ERROR|WARN) ' | tail -n 50

# Memory against BACKEND_MEM_LIMIT=768m, and host swap
sudo docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.MemPerc}} {{.CPUPerc}}'
free -m

# Disk
df -h /
sudo docker system df

# Certificate expiry and the renewal timer
echo | openssl s_client -connect pcm.jwlee.xyz:443 -servername pcm.jwlee.xyz 2> /dev/null \
  | openssl x509 -noout -enddate
sudo systemctl list-timers poker-cert-renew.timer --no-pager
sudo journalctl -u poker-cert-renew.service --no-pager -n 30
```

`/internal/deploy/status` answers only inside the container (edge returns 404 for
`/internal/`). It reports `processId`, `startsClosed`, `deploymentId`,
`activeTournaments` and `rooms`. `startsClosed:true` with no `backend-pending` is the
unowned-gate case under Recovery. A restart or OOM kill loses every room; check
memory and the logs around `started=` first.

## Local verification

```bash
bash -n deploy/*.sh
bash deploy/test-deploy-frontend.sh
bash deploy/test-deploy-backend.sh
bash deploy/test-plan-release.sh
bash deploy/test-backend-image.sh   # needs real Docker
```

`test-deploy-backend.sh` simulates Docker, HTTPS, time and the internal API. Where
`flock` is missing, as on Git Bash, it prints a `SKIP` for the one real-lock check
and stubs lock refusal instead; it is also slow there. File modes only bite on
Linux, so run it there as well (CI does). It does not prove a real replacement;
that needs the go-live run on the server.

The frontend tests simulate Docker, HTTPS, time and lock refusal. They cover successful
deployment, lock refusal, interrupted state, pull failure, revision mismatch,
replacement failure, HTTPS failure, incorrect HTTPS content, and rollback
failure. None of these tests verify actual Docker behavior, kernel locking,
systemd, or EC2 networking.

`test-plan-release.sh` covers `plan-release.sh` and `check-revision.sh` on a
temporary Git history: which service changed, the ancestor check, and when the
frontend is held. `test-backend-image.sh` builds the backend image and runs it
with Compose values and edge in real Docker.

CI also runs `test-copy-frontend-assets.sh` inside the built Nginx image. This
executes the deployment script's actual copy command with BusyBox and verifies
that new files reach an existing shared directory without overwriting old files.
Copying `assets/.` with BusyBox `cp -n` skips the already-existing destination
directory, so the script passes Vite's asset files individually instead.

## GitHub Actions

`.github/workflows/ci-images.yml` ("CI and images") runs on pull requests, pushes
to main and by hand. Its jobs:

| Job | When | What |
|---|---|---|
| `checks` | always | frontend deployment and release-planning tests, lint, unit tests, three core browser specs, frontend image and asset copy |
| `backend` | always | calls `backend-ci.yml`: Gradle tests, backend script tests, backend image build |
| `online-e2e` | always | real-server browser suite. Pull requests: Chromium only, without `@slow` and the serial `deploy-gate` project. Elsewhere: both browsers, everything |
| `restart-e2e` | main only | `test:e2e:restart` kills and restarts the backend; both screens must show the lost-room notice within 45 seconds |
| `plan` | main only | after all four checks; compares main with the revisions recorded on the server |
| `publish`, `publish-backend` | main only | build and push each changed service's image and pass on its digest; move the `main` tag only if still the latest commit |
| `deploy` | main only | calls `deploy.yml` with the published digests |

`plan` needs all four checks, so a failure in any of them stops every publish and
deploy.

**`BACKEND_DEPLOY_ENABLED`.** This repository variable gates the backend. Unless it
is exactly `true`, `plan` reports `frontend=true backend=false` without contacting
the server, `publish-backend` is skipped, and `deploy.yml` deploys the frontend as
before and leaves the backend alone. Set it to `true` only after the server's
`.env`, gate directory, `compose.yaml` and edge configuration are in place
(see [GO_LIVE.md](GO_LIVE.md)).

**Deciding what to deploy.** With the variable on, `plan` reads `revision=` from
`.local/deploy/current` and `.local/deploy/backend-current` over SSH with
`sudo -n bash -s` (`release-remote.sh read-revisions`). `check-revision.sh changed`
then compares those commits with the target: `frontend/` and `shared/` for the
frontend, `backend/` for the backend. A missing record (`absent`) or an unreadable
one (`unknown`) makes both count as changed. In `deploy.yml`,
`check-revision.sh ancestor` proceeds when the recorded commit is an ancestor of the
target or nothing is recorded, skips an older target, and stops on diverged or
unprovable history. If `sudo -n` fails for the deploy user, both revisions read
`unknown`, so every enabled deployment stops at this check. `plan-release.sh`
holds the frontend when the backend changed and came back `held` or `failed`,
because that frontend may need the new backend.

**Order on the server.** The backend goes first. `release-remote.sh backend`
uploads `deploy-backend.sh`, `recover-backend.sh` and `backend-lib.sh` into
`deploy/run-poker-backend-deploy-<run>-<attempt>/`, checks their syntax, and runs
the deployment as the transient unit `poker-backend-deploy-<run>-<attempt>` with
`<run>-<attempt>` as the deployment id. Exit 0 is `backend=deployed`, exit 3 is
`backend=held` (not a failure), anything else is `backend=failed`, which fails the
job after the frontend decision. The frontend script is uploaded as
`deploy/deploy-frontend-poker-deploy-<run>-<attempt>.sh` and runs as
`poker-deploy-<run>-<attempt>`. Run directories and script copies are kept for
diagnosis and never pruned. Failed uploads stop the deployment.

**HELD.** The job summary says a tournament was in progress, nothing was replaced,
and names the commit. When the games end, open the Deploy workflow
(`.github/workflows/deploy.yml`), choose Run workflow on main, and enter that full
commit SHA as `ref`. It requires `BACKEND_DEPLOY_ENABLED` to be `true` and the commit
to be on main, reads the deployed revisions again, pulls the already published
`sha-<commit>` images and deploys only what still differs, backend first. A held
frontend comes back the same way. Nothing is rebuilt. The CI run and the dispatch
share the `poker-deploy` concurrency group, which never cancels a deployment in
progress.

**Failure.** The summary gives the exit code and, if the log says
`RECOVERY_REQUIRED`, the recovery command inside that run's directory:

```bash
sudo bash /home/ubuntu/poker-chip-manager/deploy/run-poker-backend-deploy-<run>-<attempt>/recover-backend.sh
```

Use the copy from the run that failed, or from a later run, never an older one. The
scripts find the project two levels up from a run directory. The workflow does not
refresh the stable `deploy/recover-backend.sh`, so that copy is only as new as the
last manual upload.

Required repository Actions secrets: `TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE`,
`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_HOST_KEY`. The `plan` job
and the `deploy` job inside the called `deploy.yml` need OIDC token write permission
for Tailscale, so a Tailscale trust that pins the workflow file must accept
`deploy.yml` as well. Image publishing uses the built-in `GITHUB_TOKEN`. The
server's Ubuntu account must support noninteractive `sudo` (`sudo -n`) for `bash`,
`systemd-run`, `journalctl` and the existing root Docker setup. See
[job outputs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/pass-job-outputs)
and [workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

Compose, edge configuration and the initial server setup remain separately
provisioned infrastructure; no workflow copies `compose.yaml` or edge files.
Ancestry is proved by the workflow, not by the server scripts, so a manual run of
`deploy-backend.sh` with an older commit is not refused. Main has no branch
protection today; [GO_LIVE.md](GO_LIVE.md) recommends what to turn on.
