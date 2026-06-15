#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NEW_RELIC_NAMESPACE:-newrelic}"
RELEASE="${NEW_RELIC_RELEASE:-newrelic-bundle}"

helm status "$RELEASE" -n "$NAMESPACE"
echo
kubectl -n "$NAMESPACE" get pods,svc,deploy,daemonset
