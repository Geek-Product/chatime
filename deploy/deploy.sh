#!/usr/bin/env bash
# Runs on the deployment target. CI pipes env vars from Infisical into this script
# (via ssh) and passes the image reference as $1.
set -euo pipefail

IMAGE="${1:?usage: deploy.sh <image:tag>}"
DIR="${CHATIME_DIR:-/opt/chatime}"

mkdir -p "$DIR"
cd "$DIR"

# Keep compose + deploy script current.
if [ -f chatime.compose.yml.new ]; then mv chatime.compose.yml.new chatime.compose.yml; fi
if [ -f deploy.sh.new ]; then mv deploy.sh.new deploy.sh; fi

export CHATIME_IMAGE="$IMAGE"

docker pull "$IMAGE"

docker compose -f chatime.compose.yml up -d --remove-orphans

# Wait for the app to become healthy (max ~90 s).
for i in $(seq 1 30); do
  if docker inspect --format '{{.State.Health.Status}}' chatime-app 2>/dev/null | grep -q healthy; then
    echo "chatime-app healthy with $IMAGE"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 3
done

echo "chatime-app did not become healthy" >&2
docker logs --tail 50 chatime-app >&2 || true
exit 1