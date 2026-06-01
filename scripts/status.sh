#!/usr/bin/env bash
set -euo pipefail

kubectl get nodes -o wide
echo
kubectl -n local-app get pods,svc
echo
kubectl -n observability get pods,svc

