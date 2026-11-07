#!/bin/sh
# Sets up Poppy's local web search: a SearXNG container (https://docs.searxng.org) that only listens
# on this Mac (127.0.0.1). No account or key. Docker restarts it whenever Docker runs.
# Run again any time to re-create the container; the config (with its secret) is kept.
set -eu

IMAGE="searxng/searxng:2026.10.19-81371861f@sha256:5ed0323b5f5f8701264ef65e239a2bd83cb57098f2b971fa30bf79c06eeae271"
NAME="poppy-searxng"
PORT="${POPPY_SEARXNG_PORT:-8890}"
DATA="${POPPY_DATA_DIR:-$HOME/Library/Application Support/poppy}"
CONF="$DATA/searxng"

command -v docker >/dev/null || { echo "Docker isn't installed (https://docs.docker.com/desktop/setup/install/mac-install/)."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker isn't running. Start Docker Desktop and try again."; exit 1; }

mkdir -p "$CONF"
if [ ! -f "$CONF/settings.yml" ]; then
  umask 077
  cat > "$CONF/settings.yml" <<YML
use_default_settings: true
general:
  instance_name: "Poppy search"
server:
  secret_key: "$(openssl rand -hex 32)"
  limiter: false
  public_instance: false
  image_proxy: false
search:
  safe_search: 0
  formats:
    - html
    - json
YML
  echo "Wrote $CONF/settings.yml"
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped -p "127.0.0.1:$PORT:8080" -v "$CONF:/etc/searxng" "$IMAGE" >/dev/null

printf "Starting local search on http://127.0.0.1:%s " "$PORT"
i=0
until curl -fs "http://127.0.0.1:$PORT/search?q=poppy&format=json" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then echo; echo "It didn't answer within a minute. See: docker logs $NAME"; exit 1; fi
  printf "."
  sleep 1
done
echo " ready."
