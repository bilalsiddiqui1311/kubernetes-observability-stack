# New Relic Walkthrough

New Relic is a hosted observability platform. For Kubernetes, its Helm bundle installs the infrastructure integration, metadata injection webhook, Kubernetes events, container logs, kube-state-metrics, and the New Relic Prometheus agent.

This repo keeps New Relic optional because it needs a New Relic license key and sends telemetry to New Relic's SaaS backend.

## Deploy

1. Start the local cluster:

   ```bash
   ./scripts/minikube-up.sh
   ```

2. Deploy or refresh the app so the New Relic/Prometheus scrape annotations are present:

   ```bash
   ./scripts/deploy.sh
   ```

3. Deploy New Relic:

   ```bash
   NEW_RELIC_LICENSE_KEY=<your-license-key> ./scripts/deploy-newrelic.sh
   ```

4. Check local deployment status:

   ```bash
   ./scripts/newrelic-status.sh
   ```

## Walkthrough In New Relic

1. Open New Relic and go to Kubernetes.
2. Find the `local-platform` cluster.
3. Review nodes, pods, deployments, and namespaces.
4. Open Logs and filter by Kubernetes cluster or namespace.
5. Open Metrics Explorer and search for app metrics such as:
   - `http_requests_total`
   - `http_request_duration_seconds`
   - `db_query_duration_seconds`
   - `frontend_*`
6. Create an alert condition for either pod health, high container memory usage, or high request latency.

## Notes

- New Relic is paid SaaS with a free tier or trial depending on account terms.
- The values file enables `global.lowDataMode` to reduce telemetry volume.
- The license key is stored in a Kubernetes secret named `newrelic-license-key`, not in git.
- App traces are not automatically routed to New Relic. This setup focuses on Kubernetes telemetry, logs, events, and Prometheus-format app metrics.

## Useful Commands

```bash
kubectl -n newrelic get pods
kubectl -n newrelic logs daemonset/newrelic-bundle-nrk8s-kubelet
helm status newrelic-bundle -n newrelic
helm uninstall newrelic-bundle -n newrelic
```
