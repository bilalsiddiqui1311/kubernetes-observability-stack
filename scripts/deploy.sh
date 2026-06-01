#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

kubectl apply -k "$ROOT_DIR/k8s/base"

kubectl -n local-app rollout status deploy/postgres --timeout=180s
kubectl -n local-app rollout status deploy/profile-service --timeout=180s
kubectl -n local-app rollout status deploy/auth-service --timeout=180s
kubectl -n local-app rollout status deploy/frontend --timeout=120s
kubectl -n local-app rollout status deploy/admin-frontend --timeout=120s
kubectl -n local-app rollout status deploy/gateway --timeout=120s

echo "Application stack is deployed."

