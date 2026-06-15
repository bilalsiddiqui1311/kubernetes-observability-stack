#!/usr/bin/env bash
set -euo pipefail

APP_NAMESPACE="${APP_NAMESPACE:-local-app}"
SIGNOZ_NAMESPACE="${SIGNOZ_NAMESPACE:-signoz}"
SIGNOZ_RELEASE="${SIGNOZ_RELEASE:-signoz}"
ENDPOINT="${SIGNOZ_OTEL_ENDPOINT:-http://${SIGNOZ_RELEASE}-otel-collector.${SIGNOZ_NAMESPACE}.svc.cluster.local:4318}"

if ! kubectl cluster-info >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Kubernetes is not reachable.

Start the local cluster first:
  ./scripts/minikube-up.sh
EOF
  exit 1
fi

kubectl -n "$APP_NAMESPACE" set env deploy/auth-service deploy/profile-service \
  "OTEL_EXPORTER_OTLP_ENDPOINT=$ENDPOINT"

kubectl -n "$APP_NAMESPACE" rollout status deploy/auth-service --timeout=180s
kubectl -n "$APP_NAMESPACE" rollout status deploy/profile-service --timeout=180s

cat <<EOF
Application OpenTelemetry traces now go to SigNoz:
  $ENDPOINT

To route traces back to the local Tempo collector:
  kubectl -n $APP_NAMESPACE set env deploy/auth-service deploy/profile-service OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.observability.svc.cluster.local:4318
EOF
