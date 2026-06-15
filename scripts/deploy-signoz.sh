#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NAMESPACE="${SIGNOZ_NAMESPACE:-signoz}"
RELEASE="${SIGNOZ_RELEASE:-signoz}"
INFRA_RELEASE="${SIGNOZ_INFRA_RELEASE:-signoz-k8s-infra}"
CLUSTER_NAME="${SIGNOZ_CLUSTER_NAME:-local-platform}"
LOCAL_PORT="${SIGNOZ_LOCAL_PORT:-3301}"
STORAGE_CLASS="${SIGNOZ_STORAGE_CLASS:-}"

if ! kubectl cluster-info >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Kubernetes is not reachable.

Start the local cluster first. SigNoz needs more memory than the default local stack:
  MINIKUBE_MEMORY=8192 MINIKUBE_CPUS=4 ./scripts/minikube-up.sh
EOF
  exit 1
fi

if [[ -z "$STORAGE_CLASS" ]]; then
  if kubectl get storageclass standard >/dev/null 2>&1; then
    STORAGE_CLASS="standard"
  else
    STORAGE_CLASS="$(kubectl get storageclass -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
  fi
fi

if [[ -z "$STORAGE_CLASS" ]]; then
  cat >&2 <<'EOF'
No Kubernetes StorageClass found.

SigNoz needs persistent storage for ClickHouse. Check available classes with:
  kubectl get storageclass
EOF
  exit 1
fi

if ! helm repo list 2>/dev/null | awk '{print $1}' | grep -qx signoz; then
  helm repo add signoz https://charts.signoz.io
fi
helm repo update signoz

helm upgrade --install "$RELEASE" signoz/signoz \
  --namespace "$NAMESPACE" \
  --create-namespace \
  --values "$ROOT_DIR/k8s/signoz/signoz-values.yaml" \
  --set "global.storageClass=$STORAGE_CLASS" \
  --set "global.clusterName=$CLUSTER_NAME" \
  --set "clusterName=$CLUSTER_NAME" \
  --wait \
  --timeout 1h

helm upgrade --install "$INFRA_RELEASE" signoz/k8s-infra \
  --namespace "$NAMESPACE" \
  --values "$ROOT_DIR/k8s/signoz/k8s-infra-values.yaml" \
  --set "global.clusterName=$CLUSTER_NAME" \
  --set "clusterName=$CLUSTER_NAME" \
  --set "otelCollectorEndpoint=http://${RELEASE}-otel-collector.${NAMESPACE}.svc.cluster.local:4318" \
  --wait \
  --timeout 20m

cat <<EOF
SigNoz is deployed.

Namespace:     $NAMESPACE
Release:       $RELEASE
Infra release: $INFRA_RELEASE
Cluster:       $CLUSTER_NAME
StorageClass:  $STORAGE_CLASS

Open the UI:
  kubectl -n $NAMESPACE port-forward svc/$RELEASE $LOCAL_PORT:8080
  http://localhost:$LOCAL_PORT

Optional app traces:
  ./scripts/route-app-otel-to-signoz.sh
EOF
