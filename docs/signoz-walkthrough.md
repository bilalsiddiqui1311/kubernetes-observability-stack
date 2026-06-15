# SigNoz Walkthrough

SigNoz is an OpenTelemetry-native observability platform. You can use SigNoz Cloud, or self-host it. This repo deploys the self-hosted Kubernetes chart plus the SigNoz `k8s-infra` chart so the local cluster can send logs, Kubernetes metrics, events, and annotated Prometheus metrics into SigNoz.

SigNoz is heavier than the Grafana/Prometheus demo stack because it runs ClickHouse. For local Minikube, start with at least 8 GB memory.

## Deploy

1. Start Minikube with enough resources:

   ```bash
   MINIKUBE_MEMORY=8192 MINIKUBE_CPUS=4 ./scripts/minikube-up.sh
   ```

2. Deploy or refresh the app so the SigNoz scrape annotations are present:

   ```bash
   ./scripts/deploy.sh
   ```

3. Deploy SigNoz:

   ```bash
   ./scripts/deploy-signoz.sh
   ```

4. Open the UI:

   ```bash
   kubectl -n signoz port-forward svc/signoz 3301:8080
   ```

   Then open `http://localhost:3301`.

5. Optional: route the app's OpenTelemetry traces from Tempo to SigNoz:

   ```bash
   ./scripts/route-app-otel-to-signoz.sh
   ```

## Walkthrough In SigNoz

1. Open Dashboards or Infrastructure to inspect cluster and workload telemetry.
2. Open Logs Explorer and filter for `local-app`.
3. Generate app traffic from the login UI.
4. Open Metrics and search for app metrics such as:
   - `http_requests_total`
   - `http_request_duration_seconds`
   - `db_query_duration_seconds`
   - `frontend_*`
5. If you routed app traces to SigNoz, open Traces and filter for `auth-service` or `profile-service`.
6. Create an alert for either pod health, error rate, or latency.

## Notes

- SigNoz self-hosted does not need a SaaS license key.
- Persistent data is stored through the cluster StorageClass. The script uses Minikube's `standard` class when available.
- Default UI port `8080` conflicts with the local app, so this repo forwards SigNoz to local port `3301`.
- Re-running `./scripts/deploy.sh` routes app traces back to the local Tempo collector because that endpoint is defined in the base Kubernetes manifests.

## Useful Commands

```bash
./scripts/signoz-status.sh
kubectl -n signoz get pods
kubectl -n signoz logs statefulset/signoz
kubectl -n signoz logs deploy/signoz-otel-collector
helm status signoz -n signoz
helm status signoz-k8s-infra -n signoz
helm uninstall signoz-k8s-infra -n signoz
helm uninstall signoz -n signoz
```
