import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

import httpx
import psycopg
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.psycopg import PsycopgInstrumentor
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from pydantic import BaseModel, Field


SERVICE = os.getenv("SERVICE_NAME", "auth-service")
DATABASE_URL = os.environ["DATABASE_URL"]
PROFILE_SERVICE_URL = os.getenv(
    "PROFILE_SERVICE_URL", "http://profile-service.local-app.svc.cluster.local:8000"
)
LOGSTASH_URL = os.getenv("LOGSTASH_URL", "")
OTLP_ENDPOINT = os.getenv(
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "http://otel-collector.observability.svc.cluster.local:4318",
).rstrip("/")


def configure_tracing() -> None:
    provider = TracerProvider(resource=Resource.create({SERVICE_NAME: SERVICE}))
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{OTLP_ENDPOINT}/v1/traces"))
    )
    trace.set_tracer_provider(provider)
    HTTPXClientInstrumentor().instrument()
    PsycopgInstrumentor().instrument()


configure_tracing()
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
LOGIN_ATTEMPTS = Counter(
    "login_attempts_total",
    "Login attempts by result.",
    ["result"],
)
DB_LATENCY = Histogram(
    "db_query_duration_seconds",
    "Database query latency in seconds.",
    ["service", "operation"],
    buckets=(0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1),
)
FRONTEND_DURATION_BUCKETS_MS = (
    25,
    50,
    100,
    200,
    300,
    500,
    750,
    1000,
    1500,
    2000,
    3000,
    5000,
    10000,
)
FRONTEND_CLS_BUCKETS = (0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2)
FRONTEND_FCP = Histogram(
    "frontend_fcp_duration_ms",
    "Browser first contentful paint in milliseconds.",
    buckets=FRONTEND_DURATION_BUCKETS_MS,
)
FRONTEND_FP = Histogram(
    "frontend_fp_duration_ms",
    "Browser first paint in milliseconds.",
    buckets=FRONTEND_DURATION_BUCKETS_MS,
)
FRONTEND_LCP = Histogram(
    "frontend_lcp_duration_ms",
    "Browser largest contentful paint in milliseconds.",
    buckets=FRONTEND_DURATION_BUCKETS_MS,
)
FRONTEND_TTI = Histogram(
    "frontend_tti_duration_ms",
    "Browser time to interactive in milliseconds.",
    buckets=FRONTEND_DURATION_BUCKETS_MS,
)
FRONTEND_TBT = Histogram(
    "frontend_tbt_duration_ms",
    "Browser total blocking time in milliseconds.",
    buckets=FRONTEND_DURATION_BUCKETS_MS,
)
FRONTEND_CLS = Histogram(
    "frontend_cls_score",
    "Browser cumulative layout shift score.",
    buckets=FRONTEND_CLS_BUCKETS,
)
FRONTEND_INP = Histogram(
    "frontend_inp_duration_ms",
    "Browser interaction to next paint in milliseconds.",
    buckets=FRONTEND_DURATION_BUCKETS_MS,
)
FRONTEND_TTFB = Histogram(
    "frontend_ttfb_duration_ms",
    "Browser time to first byte in milliseconds.",
    buckets=FRONTEND_DURATION_BUCKETS_MS,
)
FRONTEND_PAGE_LOAD = Histogram(
    "frontend_page_load_duration_ms",
    "Browser page load duration in milliseconds.",
    ["route"],
    buckets=FRONTEND_DURATION_BUCKETS_MS,
)
FRONTEND_RESOURCE_LOAD = Histogram(
    "frontend_resource_load_duration_ms",
    "Browser resource load duration in milliseconds.",
    ["resource_type"],
    buckets=FRONTEND_DURATION_BUCKETS_MS,
)
FRONTEND_JS_ERRORS = Counter(
    "frontend_js_errors",
    "Browser JavaScript errors.",
    ["type"],
)


class LoginRequest(BaseModel):
    email: str
    password: str


class UiEvent(BaseModel):
    action: str
    correlation_id: str | None = None


class FrontendResourceTiming(BaseModel):
    resource_type: str
    duration_ms: float


class FrontendJsError(BaseModel):
    type: str = "runtime"
    count: int = 1


class FrontendMetrics(BaseModel):
    route: str = "/"
    fcp_ms: float | None = None
    fp_ms: float | None = None
    lcp_ms: float | None = None
    tti_ms: float | None = None
    tbt_ms: float | None = None
    cls_score: float | None = None
    inp_ms: float | None = None
    ttfb_ms: float | None = None
    page_load_ms: float | None = None
    resource_timings: list[FrontendResourceTiming] = Field(default_factory=list)
    js_errors: list[FrontendJsError] = Field(default_factory=list)


def current_trace_id() -> str:
    context = trace.get_current_span().get_span_context()
    if context.is_valid:
        return f"{context.trace_id:032x}"
    return ""


def safe_observe(metric: Histogram, value: float | None) -> bool:
    if value is None or value < 0:
        return False
    metric.observe(min(value, 60000))
    return True


def bounded_label(value: str, fallback: str, limit: int = 80) -> str:
    cleaned = value.strip()[:limit]
    return cleaned or fallback


def ensure_schema() -> None:
    deadline = time.time() + 90
    while True:
        try:
            with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
                conn.execute(
                    """
                    create table if not exists users (
                        id serial primary key,
                        email text not null unique,
                        password_hash text not null,
                        display_name text not null,
                        role text not null default 'user',
                        created_at timestamptz not null default now()
                    )
                    """
                )
                conn.execute(
                    """
                    create table if not exists login_audit (
                        id bigserial primary key,
                        email text not null,
                        user_id integer,
                        success boolean not null,
                        correlation_id text not null,
                        trace_id text,
                        duration_ms integer not null,
                        created_at timestamptz not null default now()
                    )
                    """
                )
                conn.execute(
                    """
                    insert into users (email, password_hash, display_name, role)
                    values ('demo@example.com', 'password123', 'Demo User', 'admin')
                    on conflict (email) do nothing
                    """
                )
            return
        except Exception as exc:
            if time.time() >= deadline:
                raise
            logger.info({"message": "waiting_for_database", "error": str(exc)})
            time.sleep(3)


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_schema()
    logger.info({"message": "service_started"})
    yield


app = FastAPI(title="Auth Service", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


async def send_logstash(event: dict[str, Any]) -> None:
    if not LOGSTASH_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=0.8) as client:
            await client.post(LOGSTASH_URL, json=event)
    except Exception as exc:
        logger.debug({"message": "logstash_send_failed", "error": str(exc)})


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "service": SERVICE}


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/ui-event")
async def ui_event(payload: UiEvent, request: Request) -> dict[str, str]:
    correlation_id = (
        request.headers.get("x-correlation-id") or payload.correlation_id or str(uuid.uuid4())
    )
    with tracer.start_as_current_span(f"ui.{payload.action}") as span:
        span.set_attribute("user.action", payload.action)
        span.set_attribute("correlation_id", correlation_id)
        event = {
            "event": "ui_event",
            "action": payload.action,
            "correlation_id": correlation_id,
            "trace_id": current_trace_id(),
        }
        logger.info(event)
        await send_logstash(event)
    return {"ok": "true", "correlation_id": correlation_id}


@app.post("/frontend-metrics")
async def frontend_metrics(payload: FrontendMetrics, request: Request) -> dict[str, Any]:
    correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    route = bounded_label(payload.route, "/")
    observed: list[str] = []

    with tracer.start_as_current_span("frontend.metrics") as span:
        span.set_attribute("correlation_id", correlation_id)
        span.set_attribute("frontend.route", route)

        for name, metric, value in (
            ("fcp", FRONTEND_FCP, payload.fcp_ms),
            ("fp", FRONTEND_FP, payload.fp_ms),
            ("lcp", FRONTEND_LCP, payload.lcp_ms),
            ("tti", FRONTEND_TTI, payload.tti_ms),
            ("tbt", FRONTEND_TBT, payload.tbt_ms),
            ("cls", FRONTEND_CLS, payload.cls_score),
            ("inp", FRONTEND_INP, payload.inp_ms),
            ("ttfb", FRONTEND_TTFB, payload.ttfb_ms),
        ):
            if safe_observe(metric, value):
                observed.append(name)

        if payload.page_load_ms is not None and payload.page_load_ms >= 0:
            FRONTEND_PAGE_LOAD.labels(route).observe(min(payload.page_load_ms, 60000))
            observed.append("page_load")

        for resource in payload.resource_timings[:50]:
            if resource.duration_ms >= 0:
                resource_type = bounded_label(resource.resource_type, "other", 40)
                FRONTEND_RESOURCE_LOAD.labels(resource_type).observe(
                    min(resource.duration_ms, 60000)
                )
                observed.append(f"resource:{resource_type}")

        if payload.js_errors:
            for error in payload.js_errors[:20]:
                error_count = max(0, min(error.count, 1000))
                FRONTEND_JS_ERRORS.labels(bounded_label(error.type, "runtime", 40)).inc(
                    error_count
                )
                observed.append(f"js_error:{error.type}")
        else:
            FRONTEND_JS_ERRORS.labels("runtime").inc(0)

        event = {
            "event": "frontend_metrics",
            "correlation_id": correlation_id,
            "route": route,
            "observed": observed,
            "trace_id": current_trace_id(),
        }
        logger.info(event)
        await send_logstash(event)

    return {"ok": True, "correlation_id": correlation_id, "observed": len(observed)}


@app.post("/login")
async def login(payload: LoginRequest, request: Request) -> dict[str, Any]:
    started = time.perf_counter()
    correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
    trace.get_current_span().set_attribute("correlation_id", correlation_id)
    timings: dict[str, int] = {}

    with tracer.start_as_current_span("db.find_user") as span:
        span.set_attribute("db.operation", "find_user")
        query_started = time.perf_counter()
        with DB_LATENCY.labels(SERVICE, "find_user").time():
            with psycopg.connect(DATABASE_URL) as conn:
                row = conn.execute(
                    """
                    select id, email, display_name, role
                    from users
                    where email = %s and password_hash = %s
                    """,
                    (payload.email, payload.password),
                ).fetchone()
        timings["db_user_lookup_ms"] = int((time.perf_counter() - query_started) * 1000)

    if row is None:
        duration_ms = int((time.perf_counter() - started) * 1000)
        LOGIN_ATTEMPTS.labels("failure").inc()
        await record_login(payload.email, None, False, correlation_id, duration_ms)
        event = {
            "event": "login_failed",
            "email": payload.email,
            "correlation_id": correlation_id,
            "trace_id": current_trace_id(),
            "duration_ms": duration_ms,
        }
        logger.warning(event)
        await send_logstash(event)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user_id, email, display_name, role = row
    profile_started = time.perf_counter()
    with tracer.start_as_current_span("profile-service.fetch") as span:
        span.set_attribute("peer.service", "profile-service")
        async with httpx.AsyncClient(timeout=3) as client:
            profile_response = await client.get(
                f"{PROFILE_SERVICE_URL}/profiles/{user_id}",
                headers={"x-correlation-id": correlation_id},
            )
            profile_response.raise_for_status()
            profile = profile_response.json()
    timings["profile_service_ms"] = int((time.perf_counter() - profile_started) * 1000)

    duration_ms = int((time.perf_counter() - started) * 1000)
    timings["total_ms"] = duration_ms
    LOGIN_ATTEMPTS.labels("success").inc()
    await record_login(email, user_id, True, correlation_id, duration_ms)
    event = {
        "event": "login_success",
        "email": email,
        "user_id": user_id,
        "correlation_id": correlation_id,
        "trace_id": current_trace_id(),
        "duration_ms": duration_ms,
        "timings": timings,
    }
    logger.info(event)
    await send_logstash(event)

    return {
        "ok": True,
        "correlation_id": correlation_id,
        "trace_id": current_trace_id(),
        "user": {
            "id": user_id,
            "email": email,
            "display_name": display_name,
            "role": role,
        },
        "profile": profile,
        "timings_ms": timings,
    }


async def record_login(
    email: str,
    user_id: int | None,
    success: bool,
    correlation_id: str,
    duration_ms: int,
) -> None:
    with tracer.start_as_current_span("db.insert_login_audit"):
        with DB_LATENCY.labels(SERVICE, "insert_login_audit").time():
            with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
                conn.execute(
                    """
                    insert into login_audit
                    (email, user_id, success, correlation_id, trace_id, duration_ms)
                    values (%s, %s, %s, %s, %s, %s)
                    """,
                    (email, user_id, success, correlation_id, current_trace_id(), duration_ms),
                )


@app.get("/admin/stats")
def admin_stats() -> dict[str, Any]:
    with tracer.start_as_current_span("db.admin_stats"):
        with DB_LATENCY.labels(SERVICE, "admin_stats").time():
            with psycopg.connect(DATABASE_URL) as conn:
                totals = conn.execute(
                    """
                    select
                        count(*) filter (where success) as successful_logins,
                        count(*) filter (where not success) as failed_logins,
                        coalesce(round(avg(duration_ms)), 0)::int as avg_login_ms,
                        coalesce(max(duration_ms), 0)::int as max_login_ms,
                        max(created_at) as last_login_at
                    from login_audit
                    """
                ).fetchone()
                users = conn.execute("select count(*) from users").fetchone()[0]
    return {
        "users": users,
        "successful_logins": totals[0],
        "failed_logins": totals[1],
        "avg_login_ms": totals[2],
        "max_login_ms": totals[3],
        "last_login_at": totals[4].isoformat() if totals[4] else None,
    }
