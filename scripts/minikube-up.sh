#!/usr/bin/env bash
set -euo pipefail

PROFILE="${MINIKUBE_PROFILE:-local-platform}"
DRIVER="${MINIKUBE_DRIVER:-docker}"
CPUS="${MINIKUBE_CPUS:-4}"
MEMORY="${MINIKUBE_MEMORY:-6144}"

if minikube status -p "$PROFILE" >/dev/null 2>&1; then
  echo "Minikube profile '$PROFILE' is already running."
else
  minikube start -p "$PROFILE" --driver="$DRIVER" --cpus="$CPUS" --memory="$MEMORY"
fi

kubectl config use-context "$PROFILE" >/dev/null
minikube addons enable metrics-server -p "$PROFILE" >/dev/null || true

echo "Minikube profile '$PROFILE' is ready."

