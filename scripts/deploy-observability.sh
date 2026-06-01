#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

kubectl apply -k "$ROOT_DIR/k8s/observability"
kubectl -n observability rollout restart deploy/grafana >/dev/null 2>&1 || true

for deployment in \
  tempo \
  otel-collector \
  prometheus \
  grafana \
  elasticsearch \
  logstash \
  kibana
do
  kubectl -n observability rollout status "deploy/$deployment" --timeout=900s
done

echo "Observability stack is deployed."
