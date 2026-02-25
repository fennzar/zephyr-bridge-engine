#!/usr/bin/env bash
set -euo pipefail
ENV_FILE=".env"
if [ -f ".env.local" ]; then
  ENV_FILE=".env.local"
fi
if [ -f "$ENV_FILE" ]; then
  set -a
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
      *) export "$line" ;;
    esac
  done < "$ENV_FILE"
  set +a
fi
exec pnpm exec prisma "$@"
