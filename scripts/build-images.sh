#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${MINIKUBE_PROFILE:-local-platform}"

eval "$(minikube -p "$PROFILE" docker-env)"

docker build -t local/auth-service:dev "$ROOT_DIR/apps/auth-service"
docker build -t local/profile-service:dev "$ROOT_DIR/apps/profile-service"
docker build -t local/frontend:dev "$ROOT_DIR/apps/frontend"
docker build -t local/admin-frontend:dev "$ROOT_DIR/apps/admin-frontend"
docker build -t local/gateway:dev "$ROOT_DIR/docker/nginx-gateway"

echo "Local images built inside the '$PROFILE' Minikube Docker daemon."

