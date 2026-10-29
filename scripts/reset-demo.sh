#!/usr/bin/env bash
# Resets the Rina/Andi demo before going on stage. Pass --warning to raise a fresh flood warning, --unlink to redo the Buddy invite.
# Usage: ./scripts/reset-demo.sh [--warning] [--unlink]
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose exec -T backend python -m scripts.reset_demo "$@"
