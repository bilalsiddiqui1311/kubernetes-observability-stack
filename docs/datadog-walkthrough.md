# Datadog Walkthrough

Datadog is a hosted observability and security platform. In Kubernetes, the usual pattern is to install the Datadog Agent on every node, plus the Datadog Cluster Agent for cluster-level metadata, Kubernetes events, Kubernetes state metrics, admission control, and orchestration views.

This repo uses the official Datadog Helm chart. The local setup sends:

- Kubernetes node, pod, container, deployment, service, and event telemetry.
- Container logs from all pods.
- Live container metadata and Orchestrator Explorer data.
- Custom app metrics from `auth-service` and `profile-service` through Datadog Autodiscovery annotations.
- Optional trace intake ports for Datadog APM and OpenTelemetry OTLP.

## Deploy

1. Start the local Kubernetes cluster:

   ```bash
   ./scripts/minikube-up.sh
   ```

2. Deploy the demo application if it is not already running:

   ```bash
   ./scripts/build-images.sh
   ./scripts/deploy.sh
   ```

3. Create a Datadog API key in Datadog, then deploy the Agent:

   ```bash
   DD_API_KEY=<your-api-key> ./scripts/deploy-datadog.sh
   ```

   If your account is outside the default US1 site, set `DD_SITE` too:

   ```bash
   DD_API_KEY=<your-api-key> DD_SITE=us5.datadoghq.com ./scripts/deploy-datadog.sh
   ```

4. Check the local deployment:

   ```bash
   ./scripts/datadog-status.sh
   ```

## Walkthrough In Datadog

1. Go to Infrastructure > Containers and filter by `cluster:local-platform`.
2. Open Kubernetes > Orchestrator Explorer and inspect the `local-app`, `observability`, and `datadog` namespaces.
3. Go to Logs > Explorer and filter with `kube_cluster_name:local-platform` or `env:local`.
4. Generate traffic through the app, then search Metrics Explorer for:
   - `local_app.http_requests_total`
   - `local_app.http_request_duration_seconds`
   - `local_app.db_query_duration_seconds`
   - `local_app.frontend_*`
5. Open Monitors and create a simple metric monitor, for example a high request latency alert using the `local_app.http_request_duration_seconds` series.

## Mental Model

Use Datadog in layers:

- Infrastructure Monitoring answers, "Are nodes, pods, and containers healthy?"
- Logs answer, "What happened?"
- Metrics answer, "How often and how bad?"
- APM answers, "Where did this request spend time?"
- Monitors answer, "When should someone be told?"
- Dashboards answer, "What do we need to see together every day?"

## Useful Commands

```bash
kubectl -n datadog get pods
kubectl -n datadog logs deploy/datadog-agent-cluster-agent
kubectl -n datadog get daemonset
helm status datadog-agent -n datadog
helm upgrade --install datadog-agent datadog/datadog -n datadog -f k8s/datadog/datadog-values.yaml
helm uninstall datadog-agent -n datadog
```
