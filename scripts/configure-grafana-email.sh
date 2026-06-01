#!/usr/bin/env bash
set -euo pipefail

: "${GRAFANA_ALERT_EMAIL_TO:?Set GRAFANA_ALERT_EMAIL_TO to the alert recipient email address.}"
: "${GF_SMTP_HOST:?Set GF_SMTP_HOST, for example smtp.gmail.com:587.}"

GF_SMTP_ENABLED="${GF_SMTP_ENABLED:-true}"
GF_SMTP_USER="${GF_SMTP_USER:-}"
GF_SMTP_PASSWORD="${GF_SMTP_PASSWORD:-}"
GF_SMTP_FROM_ADDRESS="${GF_SMTP_FROM_ADDRESS:-grafana@example.com}"
GF_SMTP_FROM_NAME="${GF_SMTP_FROM_NAME:-Local Grafana}"

kubectl -n observability create secret generic grafana-smtp \
  --from-literal=GF_SMTP_ENABLED="$GF_SMTP_ENABLED" \
  --from-literal=GF_SMTP_HOST="$GF_SMTP_HOST" \
  --from-literal=GF_SMTP_USER="$GF_SMTP_USER" \
  --from-literal=GF_SMTP_PASSWORD="$GF_SMTP_PASSWORD" \
  --from-literal=GF_SMTP_FROM_ADDRESS="$GF_SMTP_FROM_ADDRESS" \
  --from-literal=GF_SMTP_FROM_NAME="$GF_SMTP_FROM_NAME" \
  --from-literal=GRAFANA_ALERT_EMAIL_TO="$GRAFANA_ALERT_EMAIL_TO" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n observability rollout restart deploy/grafana
kubectl -n observability rollout status deploy/grafana --timeout=180s

echo "Grafana email alerting settings updated."
