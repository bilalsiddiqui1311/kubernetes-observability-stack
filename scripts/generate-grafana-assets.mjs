import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "k8s/observability/grafana");
const dashboardsDir = path.join(root, "dashboards");
const datasourcesDir = path.join(root, "provisioning/datasources");
const dashboardProviderDir = path.join(root, "provisioning/dashboards");
const alertingDir = path.join(root, "provisioning/alerting");

for (const dir of [dashboardsDir, datasourcesDir, dashboardProviderDir, alertingDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const prometheus = { type: "prometheus", uid: "prometheus" };
const tempo = { type: "tempo", uid: "tempo" };
const elasticsearch = { type: "elasticsearch", uid: "elasticsearch" };

function stat(id, title, x, y, w, h, expr, unit = "short", thresholds) {
  return {
    id,
    type: "stat",
    title,
    gridPos: { x, y, w, h },
    datasource: prometheus,
    targets: [{ refId: "A", expr, editorMode: "code" }],
    fieldConfig: {
      defaults: {
        unit,
        thresholds: thresholds || {
          mode: "absolute",
          steps: [{ color: "green", value: null }, { color: "red", value: 70 }],
        },
      },
      overrides: [],
    },
    options: {
      colorMode: "value",
      graphMode: "area",
      justifyMode: "auto",
      orientation: "auto",
      reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
      textMode: "auto",
    },
  };
}

function timeseries(id, title, x, y, w, h, expr, unit = "short") {
  return {
    id,
    type: "timeseries",
    title,
    gridPos: { x, y, w, h },
    datasource: prometheus,
    targets: [{ refId: "A", expr, editorMode: "code", legendFormat: "__auto" }],
    fieldConfig: { defaults: { unit }, overrides: [] },
    options: {
      legend: { displayMode: "table", placement: "bottom", showLegend: true },
      tooltip: { mode: "multi", sort: "desc" },
    },
  };
}

function timeseriesTargets(id, title, x, y, w, h, targets, unit = "short") {
  return {
    id,
    type: "timeseries",
    title,
    gridPos: { x, y, w, h },
    datasource: prometheus,
    targets: targets.map((target, index) => ({
      refId: String.fromCharCode(65 + index),
      expr: target.expr,
      editorMode: "code",
      legendFormat: target.legendFormat || "__auto",
    })),
    fieldConfig: { defaults: { unit }, overrides: [] },
    options: {
      legend: { displayMode: "table", placement: "bottom", showLegend: true },
      tooltip: { mode: "multi", sort: "desc" },
    },
  };
}

function table(id, title, x, y, w, h, expr, unit = "short") {
  return {
    id,
    type: "table",
    title,
    gridPos: { x, y, w, h },
    datasource: prometheus,
    targets: [{ refId: "A", expr, editorMode: "code", format: "table", instant: true }],
    fieldConfig: { defaults: { unit }, overrides: [] },
    options: {
      cellHeight: "sm",
      footer: { countRows: false, fields: "", reducer: ["sum"], show: false },
      showHeader: true,
    },
  };
}

function logs(id, title, x, y, w, h, query) {
  return {
    id,
    type: "logs",
    title,
    gridPos: { x, y, w, h },
    datasource: elasticsearch,
    targets: [
      {
        refId: "A",
        query,
        metrics: [{ type: "logs" }],
        bucketAggs: [],
      },
    ],
    options: { showLabels: true, showTime: true, wrapLogMessage: true },
  };
}

function traces(id, title, x, y, w, h, query) {
  return {
    id,
    type: "traces",
    title,
    gridPos: { x, y, w, h },
    datasource: tempo,
    targets: [{ refId: "A", queryType: "traceql", query }],
  };
}

function dashboard(uid, title, panels) {
  return {
    uid,
    title,
    tags: ["local-platform"],
    timezone: "browser",
    schemaVersion: 39,
    version: 1,
    refresh: "10s",
    time: { from: "now-1h", to: "now" },
    panels,
  };
}

const podCpuLimit =
  '100 * sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{namespace=~"local-app|observability", pod!=""}[5m])) / sum by (namespace, pod) (container_spec_cpu_quota{namespace=~"local-app|observability", pod!=""} / container_spec_cpu_period{namespace=~"local-app|observability", pod!=""})';
const podMemoryLimit =
  '100 * sum by (namespace, pod) (container_memory_working_set_bytes{namespace=~"local-app|observability", pod!=""}) / sum by (namespace, pod) (container_spec_memory_limit_bytes{namespace=~"local-app|observability", pod!=""} > 0)';

const dashboards = [
  [
    "minikube-overview.json",
    dashboard("local-minikube-overview", "Minikube Overview", [
      stat(1, "Cluster CPU used", 0, 0, 6, 4, '100 * sum(rate(container_cpu_usage_seconds_total{id="/"}[5m])) / sum(machine_cpu_cores)', "percent"),
      stat(2, "Cluster memory used", 6, 0, 6, 4, '100 * sum(container_memory_working_set_bytes{id="/"}) / sum(machine_memory_bytes)', "percent"),
      stat(3, "Kubelet running pods", 12, 0, 6, 4, "sum(kubelet_running_pods)", "short"),
      stat(4, "Scrape targets up", 18, 0, 6, 4, "sum(up)", "short"),
      timeseries(5, "CPU by namespace", 0, 4, 12, 8, 'sum by (namespace) (rate(container_cpu_usage_seconds_total{namespace!="", pod!=""}[2m]))', "cores"),
      timeseries(6, "Memory by namespace", 12, 4, 12, 8, 'sum by (namespace) (container_memory_working_set_bytes{namespace!="", pod!=""})', "bytes"),
      timeseries(7, "Network receive by namespace", 0, 12, 12, 8, 'sum by (namespace) (rate(container_network_receive_bytes_total{namespace!="", pod!=""}[2m]))', "Bps"),
      timeseries(8, "Network transmit by namespace", 12, 12, 12, 8, 'sum by (namespace) (rate(container_network_transmit_bytes_total{namespace!="", pod!=""}[2m]))', "Bps"),
      table(9, "Namespace resource snapshot", 0, 20, 24, 8, 'sum by (namespace) (container_memory_working_set_bytes{namespace!="", pod!=""})', "bytes"),
    ]),
  ],
  [
    "kubernetes-pod-resources.json",
    dashboard("local-kubernetes-pod-resources", "Kubernetes Pod Resources", [
      stat(1, "Max pod CPU limit usage", 0, 0, 6, 4, `max(${podCpuLimit})`, "percent"),
      stat(2, "Max pod memory limit usage", 6, 0, 6, 4, `max(${podMemoryLimit})`, "percent"),
      stat(3, "OOM events", 12, 0, 6, 4, 'sum(increase(container_oom_events_total{namespace=~"local-app|observability"}[1h]))', "short"),
      stat(4, "Kubelet restarted pods", 18, 0, 6, 4, "sum(increase(kubelet_restarted_pods_total[1h]))", "short"),
      timeseries(5, "Pod CPU limit usage", 0, 4, 12, 8, podCpuLimit, "percent"),
      timeseries(6, "Pod memory limit usage", 12, 4, 12, 8, podMemoryLimit, "percent"),
      timeseries(7, "CPU by pod", 0, 12, 12, 8, 'sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{namespace=~"local-app|observability", pod!=""}[2m]))', "cores"),
      timeseries(8, "Memory by pod", 12, 12, 12, 8, 'sum by (namespace, pod) (container_memory_working_set_bytes{namespace=~"local-app|observability", pod!=""})', "bytes"),
      table(9, "Top pod memory snapshot", 0, 20, 12, 8, 'topk(20, sum by (namespace, pod) (container_memory_working_set_bytes{namespace=~"local-app|observability", pod!=""}))', "bytes"),
      table(10, "Top pod CPU snapshot", 12, 20, 12, 8, 'topk(20, sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{namespace=~"local-app|observability", pod!=""}[5m])))', "cores"),
    ]),
  ],
  [
    "kubernetes-node-kubelet.json",
    dashboard("local-kubernetes-node-kubelet", "Kubernetes Node and Kubelet", [
      stat(1, "Machine CPU cores", 0, 0, 6, 4, "sum(machine_cpu_cores)", "short"),
      stat(2, "Machine memory", 6, 0, 6, 4, "sum(machine_memory_bytes)", "bytes"),
      stat(3, "Running containers", 12, 0, 6, 4, "sum(kubelet_running_containers)", "short"),
      stat(4, "Kubelet pod start p95", 18, 0, 6, 4, "histogram_quantile(0.95, sum by (le) (rate(kubelet_pod_start_duration_seconds_bucket[5m])))", "s"),
      timeseries(5, "Node CPU percent", 0, 4, 12, 8, '100 * sum(rate(container_cpu_usage_seconds_total{id="/"}[5m])) / sum(machine_cpu_cores)', "percent"),
      timeseries(6, "Node memory percent", 12, 4, 12, 8, '100 * sum(container_memory_working_set_bytes{id="/"}) / sum(machine_memory_bytes)', "percent"),
      timeseries(7, "Kubelet HTTP requests", 0, 12, 12, 8, "sum by (method, path, status) (rate(kubelet_http_requests_total[5m]))", "reqps"),
      timeseries(8, "Runtime operation latency p95", 12, 12, 12, 8, "histogram_quantile(0.95, sum by (operation_type, le) (rate(kubelet_runtime_operations_duration_seconds_bucket[5m])))", "s"),
      timeseries(9, "Image pull duration p95", 0, 20, 12, 8, "histogram_quantile(0.95, sum by (le) (rate(kubelet_image_pull_duration_seconds_bucket[5m])))", "s"),
      timeseries(10, "Kubelet started pods/errors", 12, 20, 12, 8, "sum by (__name__) (rate({__name__=~\"kubelet_started_pods_total|kubelet_started_pods_errors_total\"}[5m]))", "ops"),
    ]),
  ],
  [
    "namespace-workloads.json",
    dashboard("local-namespace-workloads", "Namespace Workloads", [
      timeseries(1, "Namespace CPU", 0, 0, 12, 8, 'sum by (namespace) (rate(container_cpu_usage_seconds_total{namespace!="", pod!=""}[5m]))', "cores"),
      timeseries(2, "Namespace memory", 12, 0, 12, 8, 'sum by (namespace) (container_memory_working_set_bytes{namespace!="", pod!=""})', "bytes"),
      timeseries(3, "Namespace filesystem usage", 0, 8, 12, 8, 'sum by (namespace) (container_fs_usage_bytes{namespace!="", pod!=""})', "bytes"),
      timeseries(4, "Namespace network errors", 12, 8, 12, 8, 'sum by (namespace) (rate(container_network_receive_errors_total{namespace!="", pod!=""}[5m]) + rate(container_network_transmit_errors_total{namespace!="", pod!=""}[5m]))', "ops"),
      table(5, "Pod CPU top 20", 0, 16, 12, 8, 'topk(20, sum by (namespace, pod) (rate(container_cpu_usage_seconds_total{namespace!="", pod!=""}[5m])))', "cores"),
      table(6, "Pod memory top 20", 12, 16, 12, 8, 'topk(20, sum by (namespace, pod) (container_memory_working_set_bytes{namespace!="", pod!=""}))', "bytes"),
    ]),
  ],
  [
    "app-database.json",
    dashboard("local-app-database", "Application and Database", [
      stat(1, "Successful logins", 0, 0, 6, 4, 'sum(login_attempts_total{result="success"})', "short"),
      stat(2, "Failed logins", 6, 0, 6, 4, 'sum(login_attempts_total{result="failure"})', "short"),
      stat(3, "P95 HTTP latency", 12, 0, 6, 4, "histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))", "s"),
      stat(4, "P95 DB latency", 18, 0, 6, 4, "histogram_quantile(0.95, sum by (le) (rate(db_query_duration_seconds_bucket[5m])))", "s"),
      timeseries(5, "HTTP request rate by route", 0, 4, 12, 8, "sum by (service, route, status) (rate(http_requests_total[2m]))", "reqps"),
      timeseries(6, "HTTP latency p95 by route", 12, 4, 12, 8, "histogram_quantile(0.95, sum by (service, route, le) (rate(http_request_duration_seconds_bucket[5m])))", "s"),
      timeseries(7, "Database latency p95 by operation", 0, 12, 12, 8, "histogram_quantile(0.95, sum by (service, operation, le) (rate(db_query_duration_seconds_bucket[5m])))", "s"),
      timeseries(8, "Process CPU and memory", 12, 12, 12, 8, 'sum by (job, __name__) ({__name__=~"process_cpu_seconds_total|process_resident_memory_bytes", job=~"auth-service|profile-service"})', "short"),
      timeseries(9, "Postgres CPU", 0, 20, 12, 8, 'sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="local-app", pod=~"postgres-.*"}[5m]))', "cores"),
      timeseries(10, "Postgres memory", 12, 20, 12, 8, 'sum by (pod) (container_memory_working_set_bytes{namespace="local-app", pod=~"postgres-.*"})', "bytes"),
    ]),
  ],
  [
    "logs-traces.json",
    dashboard("local-logs-traces", "Logs and Traces", [
      traces(1, "Login traces", 0, 0, 24, 9, '{ resource.service.name = "auth-service" && name =~ ".*login.*" }'),
      traces(2, "Database spans", 0, 9, 12, 8, '{ name =~ "db.*" }'),
      traces(3, "Profile service spans", 12, 9, 12, 8, '{ resource.service.name = "profile-service" }'),
      logs(4, "Application logs", 0, 17, 24, 9, "platform:local-minikube"),
    ]),
  ],
  [
    "app-login-flow.json",
    dashboard("local-login-flow", "App Login Flow", [
      stat(1, "Successful logins", 0, 0, 6, 4, 'sum(login_attempts_total{result="success"})', "short"),
      stat(2, "Failed logins", 6, 0, 6, 4, 'sum(login_attempts_total{result="failure"})', "short"),
      stat(3, "P95 login API latency", 12, 0, 6, 4, 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{service="auth-service", route="/login"}[5m])))', "s"),
      stat(4, "P95 DB query latency", 18, 0, 6, 4, "histogram_quantile(0.95, sum by (le) (rate(db_query_duration_seconds_bucket[5m])))", "s"),
      timeseries(5, "HTTP request rate", 0, 4, 12, 8, "sum by (service, route, status) (rate(http_requests_total[2m]))", "reqps"),
      timeseries(6, "Database query latency by operation", 12, 4, 12, 8, "histogram_quantile(0.95, sum by (operation, le) (rate(db_query_duration_seconds_bucket[5m])))", "s"),
      traces(7, "Recent login traces", 0, 12, 24, 9, '{ resource.service.name = "auth-service" && name =~ ".*login.*" }'),
    ]),
  ],
  [
    "frontend-performance.json",
    dashboard("local-frontend-performance", "Frontend Performance", [
      stat(1, "P75 FCP (First Contentful Paint)", 0, 0, 6, 4, "histogram_quantile(0.75, sum by (le) (rate(frontend_fcp_duration_ms_bucket[5m])))", "ms"),
      stat(2, "P75 TTFP (Time to First Pixel / FP)", 6, 0, 6, 4, "histogram_quantile(0.75, sum by (le) (rate(frontend_fp_duration_ms_bucket[5m])))", "ms"),
      stat(3, "P75 LCP (Largest Contentful Paint)", 12, 0, 6, 4, "histogram_quantile(0.75, sum by (le) (rate(frontend_lcp_duration_ms_bucket[5m])))", "ms"),
      stat(4, "P75 TTI (Time to Interactive)", 18, 0, 6, 4, "histogram_quantile(0.75, sum by (le) (rate(frontend_tti_duration_ms_bucket[5m])))", "ms"),
      stat(5, "P75 TBT (Total Blocking Time)", 0, 4, 6, 4, "histogram_quantile(0.75, sum by (le) (rate(frontend_tbt_duration_ms_bucket[5m])))", "ms"),
      stat(6, "P75 CLS (Cumulative Layout Shift)", 6, 4, 6, 4, "histogram_quantile(0.75, sum by (le) (rate(frontend_cls_score_bucket[5m])))", "short"),
      stat(7, "P75 INP (Interaction to Next Paint)", 12, 4, 6, 4, "histogram_quantile(0.75, sum by (le) (rate(frontend_inp_duration_ms_bucket[5m])))", "ms"),
      stat(8, "P75 TTFB (Time to First Byte)", 18, 4, 6, 4, "histogram_quantile(0.75, sum by (le) (rate(frontend_ttfb_duration_ms_bucket[5m])))", "ms"),
      timeseriesTargets(9, "Core Web Vitals Over Time (FCP, LCP, TTFB)", 0, 8, 24, 8, [
        { expr: "histogram_quantile(0.75, sum by (le) (rate(frontend_fcp_duration_ms_bucket[5m])))", legendFormat: "FCP p75" },
        { expr: "histogram_quantile(0.75, sum by (le) (rate(frontend_lcp_duration_ms_bucket[5m])))", legendFormat: "LCP p75" },
        { expr: "histogram_quantile(0.75, sum by (le) (rate(frontend_ttfb_duration_ms_bucket[5m])))", legendFormat: "TTFB p75" },
        { expr: "histogram_quantile(0.75, sum by (le) (rate(frontend_fp_duration_ms_bucket[5m])))", legendFormat: "FP p75" },
      ], "ms"),
      timeseriesTargets(10, "Page Load Time by Route (p50 / p95)", 0, 16, 12, 8, [
        { expr: "histogram_quantile(0.50, sum by (route, le) (rate(frontend_page_load_duration_ms_bucket[5m])))", legendFormat: "p50 {{route}}" },
        { expr: "histogram_quantile(0.95, sum by (route, le) (rate(frontend_page_load_duration_ms_bucket[5m])))", legendFormat: "p95 {{route}}" },
      ], "ms"),
      timeseries(11, "JS Error Rate", 12, 16, 12, 8, "sum by (type) (rate(frontend_js_errors_total[2m]))", "ops"),
      timeseries(12, "Resource Load Times (JS / CSS / Images)", 0, 24, 12, 8, "histogram_quantile(0.75, sum by (resource_type, le) (rate(frontend_resource_load_duration_ms_bucket[5m])))", "ms"),
      timeseries(13, "HTTP Request Rate from Browser", 12, 24, 12, 8, "sum by (service, route, status) (rate(http_requests_total[2m]))", "reqps"),
    ]),
  ],
];

for (const [fileName, data] of dashboards) {
  fs.writeFileSync(path.join(dashboardsDir, fileName), `${JSON.stringify(data, null, 2)}\n`);
}

fs.writeFileSync(
  path.join(datasourcesDir, "datasources.yaml"),
  `apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: http://prometheus.observability.svc.cluster.local:9090
    isDefault: true
  - name: Tempo
    uid: tempo
    type: tempo
    access: proxy
    url: http://tempo.observability.svc.cluster.local:3200
  - name: Elasticsearch
    uid: elasticsearch
    type: elasticsearch
    access: proxy
    url: http://elasticsearch.observability.svc.cluster.local:9200
    jsonData:
      index: "[local-app-]YYYY.MM.DD"
      interval: Daily
      timeField: "@timestamp"
      esVersion: "8.0.0"
`
);

fs.writeFileSync(
  path.join(dashboardProviderDir, "dashboards.yaml"),
  `apiVersion: 1
providers:
  - name: Local Platform
    orgId: 1
    folder: Local Platform
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /var/lib/grafana/dashboards
`
);

function alertRule(uid, title, expr, threshold, summary, description, severity = "warning", duration = "5m") {
  return `      - uid: ${uid}
        title: ${title}
        condition: C
        data:
          - refId: A
            relativeTimeRange:
              from: 600
              to: 0
            datasourceUid: prometheus
            model:
              datasource:
                type: prometheus
                uid: prometheus
              editorMode: code
              expr: ${JSON.stringify(expr)}
              instant: true
              intervalMs: 1000
              maxDataPoints: 43200
              range: false
              refId: A
          - refId: B
            relativeTimeRange:
              from: 0
              to: 0
            datasourceUid: __expr__
            model:
              datasource:
                type: __expr__
                uid: __expr__
              expression: A
              intervalMs: 1000
              maxDataPoints: 43200
              reducer: last
              refId: B
              type: reduce
          - refId: C
            relativeTimeRange:
              from: 0
              to: 0
            datasourceUid: __expr__
            model:
              conditions:
                - evaluator:
                    params:
                      - ${threshold}
                    type: gt
                  operator:
                    type: and
                  query:
                    params:
                      - C
                  reducer:
                    params: []
                    type: last
                  type: query
              datasource:
                type: __expr__
                uid: __expr__
              expression: B
              intervalMs: 1000
              maxDataPoints: 43200
              refId: C
              type: threshold
        noDataState: OK
        execErrState: Error
        for: ${duration}
        annotations:
          summary: ${summary}
          description: ${description}
        labels:
          severity: ${severity}
        isPaused: false
`;
}

fs.writeFileSync(
  path.join(alertingDir, "contact-points.yaml"),
  `apiVersion: 1
contactPoints:
  - orgId: 1
    name: local-email
    receivers:
      - uid: local-email
        type: email
        settings:
          addresses: \${GRAFANA_ALERT_EMAIL_TO}
          singleEmail: false
        disableResolveMessage: false
`
);

fs.writeFileSync(
  path.join(alertingDir, "notification-policies.yaml"),
  `apiVersion: 1
policies:
  - orgId: 1
    receiver: local-email
    group_by:
      - grafana_folder
      - alertname
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 30m
`
);

fs.writeFileSync(
  path.join(alertingDir, "alert-rules.yaml"),
  `apiVersion: 1
groups:
  - orgId: 1
    name: Kubernetes Pod Health
    folder: Local Platform Alerts
    interval: 1m
    rules:
${alertRule("pod-cpu-over-70", "Pod CPU usage above 70 percent of limit", podCpuLimit, 70, "Pod CPU usage is above 70 percent of its configured limit.", "A pod is consuming more than 70 percent of its CPU limit for at least 5 minutes.", "critical")}
${alertRule("pod-memory-over-70", "Pod memory usage above 70 percent of limit", podMemoryLimit, 70, "Pod memory usage is above 70 percent of its configured limit.", "A pod is consuming more than 70 percent of its memory limit for at least 5 minutes.", "critical")}
${alertRule("prometheus-target-down", "Prometheus target down", 'up{job=~"auth-service|profile-service|kubernetes-cadvisor|kubernetes-nodes|prometheus"} == 0', 0, "A Prometheus scrape target is down.", "One or more monitored targets are not responding to Prometheus.", "critical", "2m")}
  - orgId: 1
    name: Application Health
    folder: Local Platform Alerts
    interval: 1m
    rules:
${alertRule("login-p95-over-1s", "Login p95 latency above 1 second", 'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{service="auth-service", route="/login"}[5m])))', 1, "Login p95 latency is above 1 second.", "The auth-service login endpoint is taking longer than expected.", "warning")}
${alertRule("db-p95-over-500ms", "Database p95 latency above 500 ms", "histogram_quantile(0.95, sum by (le) (rate(db_query_duration_seconds_bucket[5m])))", 0.5, "Database p95 latency is above 500 ms.", "Database-backed operations are taking longer than expected.", "warning")}
`
);

console.log(`Generated ${dashboards.length} dashboards and Grafana provisioning assets.`);
