#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${SIGNOZ_NAMESPACE:-signoz}"
RELEASE="${SIGNOZ_RELEASE:-signoz}"
INFRA_RELEASE="${SIGNOZ_INFRA_RELEASE:-signoz-k8s-infra}"
LOCAL_PORT="${SIGNOZ_LOCAL_PORT:-3301}"

helm status "$RELEASE" -n "$NAMESPACE"
echo
helm status "$INFRA_RELEASE" -n "$NAMESPACE"
echo
kubectl -n "$NAMESPACE" get pods,svc,deploy,daemonset,statefulset,pvc
echo
cat <<EOF
Open SigNoz:
  kubectl -n $NAMESPACE port-forward svc/$RELEASE $LOCAL_PORT:8080
  http://localhost:$LOCAL_PORT
EOF
