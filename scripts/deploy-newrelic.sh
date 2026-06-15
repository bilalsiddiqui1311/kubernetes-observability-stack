#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NAMESPACE="${NEW_RELIC_NAMESPACE:-newrelic}"
RELEASE="${NEW_RELIC_RELEASE:-newrelic-bundle}"
CLUSTER_NAME="${NEW_RELIC_CLUSTER_NAME:-local-platform}"
LICENSE_KEY="${NEW_RELIC_LICENSE_KEY:-${NR_LICENSE_KEY:-}}"

if [[ -z "$LICENSE_KEY" ]]; then
  cat >&2 <<'EOF'
Missing New Relic license key.

Run with one of:
  NEW_RELIC_LICENSE_KEY=<your-license-key> ./scripts/deploy-newrelic.sh
  NR_LICENSE_KEY=<your-license-key> ./scripts/deploy-newrelic.sh

Optional:
  NEW_RELIC_CLUSTER_NAME=local-platform
  NEW_RELIC_NAMESPACE=newrelic
  NEW_RELIC_RELEASE=newrelic-bundle
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

if ! helm repo list 2>/dev/null | awk '{print $1}' | grep -qx newrelic; then
  helm repo add newrelic https://helm-charts.newrelic.com
fi
helm repo update newrelic

kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NAMESPACE" create secret generic newrelic-license-key \
  --from-literal=licenseKey="$LICENSE_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -

helm upgrade --install "$RELEASE" newrelic/nri-bundle \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --values "$ROOT_DIR/k8s/newrelic/newrelic-values.yaml" \
  --set "global.cluster=$CLUSTER_NAME"

kubectl -n "$NAMESPACE" rollout status daemonset -l app.kubernetes.io/instance="$RELEASE" --timeout=300s || true
kubectl -n "$NAMESPACE" rollout status deploy -l app.kubernetes.io/instance="$RELEASE" --timeout=300s || true
kubectl -n "$NAMESPACE" rollout status statefulset -l app.kubernetes.io/instance="$RELEASE" --timeout=300s || true

cat <<EOF
New Relic Kubernetes integration is deployed.

Namespace: $NAMESPACE
Release:   $RELEASE
Cluster:   $CLUSTER_NAME

Next checks:
  ./scripts/newrelic-status.sh
  kubectl -n $NAMESPACE get pods
EOF
