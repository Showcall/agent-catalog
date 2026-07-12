#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo"
APP_DIR="${DEMO_BACKSTAGE_DIR:-$DEMO_DIR/.backstage-app}"
APP_NAME="${DEMO_BACKSTAGE_APP_NAME:-agent-catalog-demo}"
FRONTEND_PORT="${DEMO_BACKSTAGE_PORT:-3001}"
BACKEND_PORT="${DEMO_BACKSTAGE_BACKEND_PORT:-7008}"
LITELLM_PORT="${DEMO_LITELLM_PORT:-4400}"
APP_CONFIG="$APP_DIR/app-config.yaml"
DEMO_APP_CONFIG="$APP_DIR/app-config.agent-catalog-demo.yaml"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need node
need npx

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "Creating disposable Backstage app in ${APP_DIR} ..."
  mkdir -p "$(dirname "$APP_DIR")"
  printf '%s\n' "$APP_NAME" | npx @backstage/create-app@latest \
    --path "$APP_DIR" \
    --skip-install
else
  echo "Reusing disposable Backstage app in ${APP_DIR}."
fi

echo "Syncing local Agent Catalog plugins into the disposable app..."
mkdir -p "$APP_DIR/plugins"
for plugin in plugin-agent-catalog-backend plugin-agent-catalog; do
  rm -rf "$APP_DIR/plugins/$plugin"
  cp -R "$ROOT_DIR/plugins/$plugin" "$APP_DIR/plugins/$plugin"
done

DEMO_BACKSTAGE_PORT="$FRONTEND_PORT" \
DEMO_BACKSTAGE_BACKEND_PORT="$BACKEND_PORT" \
DEMO_LITELLM_PORT="$LITELLM_PORT" \
node "$DEMO_DIR/scripts/patch-backstage-demo.mjs" "$ROOT_DIR" "$APP_DIR"

if command -v yarn >/dev/null 2>&1; then
  YARN_CMD=(yarn)
elif [[ -f "$APP_DIR/.yarn/releases/yarn-4.13.0.cjs" ]]; then
  YARN_CMD=(node "$APP_DIR/.yarn/releases/yarn-4.13.0.cjs")
else
  echo "Missing yarn and no scaffolded Yarn release found in ${APP_DIR}." >&2
  exit 1
fi

if [[ "${DEMO_BACKSTAGE_SKIP_INSTALL:-0}" == "1" ]]; then
  echo "Skipping Backstage dependency install because DEMO_BACKSTAGE_SKIP_INSTALL=1."
else
  echo "Installing Backstage dependencies..."
  (
    cd "$APP_DIR"
    "${YARN_CMD[@]}" install
  )
fi

if [[ "${DEMO_BACKSTAGE_NO_START:-0}" == "1" ]]; then
  echo "Backstage demo app is prepared at ${APP_DIR}."
  echo "Skipping server start because DEMO_BACKSTAGE_NO_START=1."
  exit 0
fi

cat <<EOF

Starting Agent Catalog Backstage demo.

Frontend: http://localhost:${FRONTEND_PORT}/agents
Backend:  http://localhost:${BACKEND_PORT}

EOF

(
  cd "$APP_DIR"
  export LITELLM_SPEND_KEY="${LITELLM_SPEND_KEY:-demo-token}"
  "${YARN_CMD[@]}" start --config "$APP_CONFIG" --config "$DEMO_APP_CONFIG"
)
