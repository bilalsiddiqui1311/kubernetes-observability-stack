#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${DD_NAMESPACE:-datadog}"
RELEASE="${DD_RELEASE:-datadog-agent}"

helm status "$RELEASE" -n "$NAMESPACE"
echo
kubectl -n "$NAMESPACE" get pods,svc,deploy,daemonset
echo
echo "Agent status:"
agent_pod="$(kubectl -n "$NAMESPACE" get pod -l app.kubernetes.io/component=agent -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
if [[ -n "$agent_pod" ]]; then
  kubectl -n "$NAMESPACE" exec "$agent_pod" -c agent -- agent status
else
  echo "No Datadog Agent pod found in namespace '$NAMESPACE'."
fi
