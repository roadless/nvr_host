#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/nvr_host}"
COMPOSE="${COMPOSE:-docker compose}"
SKIP_PULL="${SKIP_PULL:-0}"
PRUNE_IMAGES="${PRUNE_IMAGES:-1}"

cd "$APP_DIR"

mkdir -p data

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Edit ADMIN_PASSWORD after this run."
fi

if [ ! -f data/cameras.yaml ]; then
  cp data/cameras.example.yaml data/cameras.yaml
  echo "Created data/cameras.yaml from data/cameras.example.yaml. Edit RTSP URLs before production use."
fi

if [ ! -f data/go2rtc.yaml ]; then
  cp data/go2rtc.example.yaml data/go2rtc.yaml
  echo "Created initial data/go2rtc.yaml."
fi

if [ "$SKIP_PULL" != "1" ] && [ -d .git ]; then
  git pull --ff-only
fi

$COMPOSE up -d --build

if [ "$PRUNE_IMAGES" = "1" ]; then
  docker image prune -f
fi

$COMPOSE ps
