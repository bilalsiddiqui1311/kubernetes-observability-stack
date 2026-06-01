# Local Minikube Platform

This workspace contains a complete local Kubernetes setup for:

- `frontend`: user login UI
- `admin-frontend`: operational admin UI
- `auth-service`: login API with Postgres calls, metrics, logs, and traces
- `profile-service`: backend microservice called by `auth-service`
- `postgres`: local PostgreSQL database
- Observability: Prometheus, Grafana, Tempo traces, Elasticsearch, Logstash, and Kibana

## Quick Start

```bash
./scripts/minikube-up.sh
./scripts/build-images.sh
./scripts/deploy.sh
./scripts/deploy-observability.sh
./scripts/expose-local.sh start
```

The first observability deployment can take 15-20 minutes while Minikube pulls the Elastic, Grafana, Prometheus, Tempo, and collector images.

## Local URLs

- App: http://localhost:8080
- Admin UI: http://localhost:8080/admin/
- Grafana: http://localhost:3000
- Prometheus: http://localhost:9090
- Kibana: http://localhost:5601
- Tempo API: http://localhost:3200
- Elasticsearch: http://localhost:9200

Grafana credentials are `admin` / `admin`.

Demo login credentials:

- Email: `demo@example.com`
- Password: `password123`

## What To Look At

After logging in from the app, open Grafana:

- `Minikube Overview`: cluster CPU, memory, and pod activity from Prometheus.
- `Kubernetes Pod Resources`: pod CPU/memory pressure, OOM events, and top pod tables.
- `Kubernetes Node and Kubelet`: node capacity, kubelet health, image pulls, and runtime latency.
- `Namespace Workloads`: namespace-level CPU, memory, filesystem, network, and top containers.
- `Application and Database`: app traffic, login health, service latency, DB latency, and Postgres resources.
- `Logs and Traces`: Tempo trace panels plus application logs from Elasticsearch.
- `App Login Flow`: API traffic, login latency, database timings, and a Tempo TraceQL panel for login traces.

Kibana will receive application events through Logstash under daily indices named `local-app-*`.

Grafana is configured in dark mode by default.

Alert rules are provisioned for pod CPU over 70%, pod memory over 70%, target-down, login latency, and DB latency. To enable real email delivery, configure SMTP and the recipient:

```bash
GRAFANA_ALERT_EMAIL_TO=you@example.com \
GF_SMTP_HOST=smtp.example.com:587 \
GF_SMTP_USER=your-smtp-user \
GF_SMTP_PASSWORD=your-smtp-password \
GF_SMTP_FROM_ADDRESS=grafana@example.com \
./scripts/configure-grafana-email.sh
```

## Useful Commands

```bash
./scripts/status.sh
./scripts/expose-local.sh status
./scripts/expose-local.sh stop
kubectl -n local-app get pods
kubectl -n observability get pods
```
