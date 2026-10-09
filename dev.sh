#!/usr/bin/env bash
# Usage: ./dev.sh            backend + iOS simulator
#        ./dev.sh phone      backend + Metro for a physical iPhone (Mac's Wi-Fi IP)
#        ./dev.sh --build    rebuild the backend image first (after backend edits)
set -euo pipefail
cd "$(dirname "$0")"

SIM="B48703C7-F2F4-4FF9-8E3E-D25EF4E75A77" # "EvacuAid iPhone 17"
MODE=sim BUILD=
for arg in "$@"; do
  case $arg in
    phone) MODE=phone ;;
    --build) BUILD=--build ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop..."
  open -a Docker
  for _ in $(seq 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || { echo "Docker didn't start in 2 min. Quit Docker Desktop fully (menu bar whale → Quit) and rerun." >&2; exit 1; }
fi

echo "Starting backend..."
docker compose --profile routing --profile hazards up -d $BUILD
for _ in $(seq 60); do curl -fs http://localhost:8000/health >/dev/null && break; sleep 2; done
curl -fs http://localhost:8000/health >/dev/null || { echo "Backend not healthy after 2 min. Check: docker compose logs backend" >&2; exit 1; }
echo "Backend ready on :8000"

if [ "$MODE" = phone ]; then
  IP=$(ipconfig getifaddr en0)
  API="http://$IP:8000"
else
  API="http://localhost:8000"
  echo "Booting simulator..."
  xcrun simctl bootstatus "$SIM" -b >/dev/null # boots if needed and waits until it's fully up
  open /Applications/Xcode.app/Contents/Applications/DeviceHub.app
  xcrun simctl location "$SIM" set -6.2,106.8 # Jakarta, where the demo shelters are
fi

echo "App will use $API"
cd frontend
# Inline env wins over frontend/.env, so .env is left untouched.
EXPO_PUBLIC_API_BASE_URL="$API" exec npx expo start --dev-client $([ "$MODE" = sim ] && echo --ios)
