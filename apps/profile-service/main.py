import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

import psycopg
from fastapi import FastAPI, HTTPException, Request, Response
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest


SERVICE = os.getenv("SERVICE_NAME", "profile-service")
DATABASE_URL = os.environ["DATABASE_URL"]
OTLP_ENDPOINT = os.getenv(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "http://otel-collector.observability.svc.cluster.local:4318",
).rstrip("/")


provider = TracerProvider(resource=Resource.create({SERVICE_NAME: SERVICE}))
provider.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{OTLP_ENDPOINT}/v1/traces"))
)
trace.set_tracer_provider(provider)
PsycopgInstrumentor().instrument()
tracer = trace.get_tracer(__name__)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        span_context = trace.get_current_span().get_span_context()
        payload: dict[str, Any] = {
            "level": record.levelname,
            "service": SERVICE,
            "logger": record.name,
            "message": record.getMessage(),
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
        }
        if span_context.is_valid:
            payload["trace_id"] = f"{span_context.trace_id:032x}"
            payload["span_id"] = f"{span_context.span_id:016x}"
        if isinstance(record.msg, dict):
            payload.update(record.msg)
        return json.dumps(payload, default=str)


handler = logging.StreamHandler()
handler.setFormatter(JsonFormatter())
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), handlers=[handler], force=True)
logger = logging.getLogger(SERVICE)


REQUEST_COUNT = Counter(
    "http_requests_total",
    "HTTP requests handled by the service.",
    ["service", "method", "route", "status"],
)
REQUEST_LATENCY = Histogram(
    "http_request_duration_seconds",
    "HTTP request latency in seconds.",
    ["service", "method", "route"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5),
)
DB_LATENCY = Histogram(
    "db_query_duration_seconds",
    "Database query latency in seconds.",
    ["service", "operation"],
    buckets=(0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1),
)


def wait_for_database() -> None:
    deadline = time.time() + 90
    while True:
        try:
            with psycopg.connect(DATABASE_URL) as conn:
                conn.execute("select 1")
            return
        except Exception as exc:
            if time.time() >= deadline:
                raise
            logger.info({"message": "waiting_for_database", "error": str(exc)})
            time.sleep(3)


@asynccontextmanager
async def lifespan(_: FastAPI):
    wait_for_database()
    logger.info({"message": "service_started"})
    yield


app = FastAPI(title="Profile Service", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def prometheus_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    route = request.scope.get("route")
    route_path = getattr(route, "path", request.url.path)
    elapsed = time.perf_counter() - start
    REQUEST_COUNT.labels(
        SERVICE, request.method, route_path, str(response.status_code)
    ).inc()
    REQUEST_LATENCY.labels(SERVICE, request.method, route_path).observe(elapsed)
    return response


FastAPIInstrumentor.instrument_app(app, excluded_urls="/healthz,/metrics")


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/profiles/{user_id}")
def profile(user_id: int) -> dict[str, Any]:
    with tracer.start_as_current_span("db.load_profile") as span:
        span.set_attribute("app.user_id", user_id)
        with DB_LATENCY.labels(SERVICE, "load_profile").time():
            with psycopg.connect(DATABASE_URL) as conn:
                row = conn.execute(
                    """
                    select
                        u.id,
                        u.email,
                        u.display_name,
                        u.role,
                        count(a.id) filter (where a.success) as successful_logins,
                        max(a.created_at) as last_login_at
                    from users u
                    left join login_audit a on a.user_id = u.id
                    where u.id = %s
                    group by u.id
                    """,
                    (user_id,),
                ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    logger.info({"message": "profile_loaded", "user_id": user_id})
    return {
        "id": row[0],
        "email": row[1],
        "display_name": row[2],
        "role": row[3],
        "successful_logins": row[4],
        "last_login_at": row[5].isoformat() if row[5] else None,
    }

