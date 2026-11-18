#!/usr/bin/env bash
# Runs on the deployment target. CI has already copied docker-compose.yml here and written
# /opt/chatime/.env from Infisical; the image reference is passed as $1.
set -euo pipefail

IMAGE="${1:?usage: deploy.sh <image:tag>}"
DIR="${CHATIME_DIR:-/opt/chatime}"

cd "$DIR"
export CHATIME_IMAGE="$IMAGE"

docker pull "$IMAGE"

# --no-build: the image was just pulled, so never build on the server.
docker compose up -d --no-build --remove-orphans

# Wait for app readiness (db must be healthy first): max ~120 s.
for i in $(seq 1 40); do
  if [ "$(docker inspect --format '{{.State.Health.Status}}' chatime-app 2>/dev/null)" = "healthy" ]; then
    echo "chatime-app healthy with $IMAGE"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 3
done

echo "chatime-app did not become healthy" >&2
docker compose logs --tail 50 app >&2 || true
exit 1
