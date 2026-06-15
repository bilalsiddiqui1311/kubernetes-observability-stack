#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NAMESPACE="${DD_NAMESPACE:-datadog}"
RELEASE="${DD_RELEASE:-datadog-agent}"
CLUSTER_NAME="${DD_CLUSTER_NAME:-local-platform}"
SITE="${DD_SITE:-${DATADOG_SITE:-datadoghq.com}}"
API_KEY="${DD_API_KEY:-${DATADOG_API_KEY:-}}"

if [[ -z "$API_KEY" ]]; then
  cat >&2 <<'EOF'
Missing Datadog API key.

Run with one of:
  DD_API_KEY=<your-api-key> ./scripts/deploy-datadog.sh
  DATADOG_API_KEY=<your-api-key> ./scripts/deploy-datadog.sh

Optional:
  DD_SITE=datadoghq.com
  DD_CLUSTER_NAME=local-platform
  DD_NAMESPACE=datadog
  DD_RELEASE=datadog-agent
EOF
  exit 1
fi

if ! kubectl cluster-info >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Kubernetes is not reachable.

Start the local cluster first:
  ./scripts/minikube-up.sh
EOF
  exit 1
fi

if ! helm repo list 2>/dev/null | awk '{print $1}' | grep -qx datadog; then
  helm repo add datadog https://helm.datadoghq.com
fi
helm repo update datadog

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NAMESPACE" create secret generic datadog-secret \
  --from-literal=api-key="$API_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -

helm upgrade --install "$RELEASE" datadog/datadog \
  --namespace "$NAMESPACE" \
  --values "$ROOT_DIR/k8s/datadog/datadog-values.yaml" \
  --set "datadog.site=$SITE" \
  --set "datadog.clusterName=$CLUSTER_NAME"

kubectl -n "$NAMESPACE" rollout status deploy -l app.kubernetes.io/component=cluster-agent --timeout=300s
kubectl -n "$NAMESPACE" rollout status daemonset -l app.kubernetes.io/component=agent --timeout=300s

cat <<EOF
Datadog Agent is deployed.

Namespace: $NAMESPACE
Release:   $RELEASE
Site:      $SITE
Cluster:   $CLUSTER_NAME

Next checks:
  ./scripts/datadog-status.sh
  kubectl -n $NAMESPACE logs deploy/${RELEASE}-cluster-agent
EOF
