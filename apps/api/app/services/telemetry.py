from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI

from app.core.config import settings


logger = logging.getLogger("ai_studio")


def configure_structured_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def configure_opentelemetry(app: FastAPI) -> dict[str, Any]:
    """Enable OpenTelemetry when optional packages are installed.

    The MVP remains easy to run without Docker or extra collectors. Installing
    opentelemetry-sdk and opentelemetry-instrumentation-fastapi turns this into
    real traces without changing application code.
    """
    if not settings.telemetry_enabled:
        return {"enabled": False, "reason": "disabled_by_settings"}

    try:
        from opentelemetry import trace
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
    except ImportError as exc:
        logger.info("opentelemetry_unavailable", extra={"reason": str(exc)})
        return {"enabled": False, "reason": "optional_dependencies_missing"}

    provider = TracerProvider(resource=Resource.create({"service.name": settings.telemetry_service_name}))
    if settings.telemetry_console_exporter_enabled:
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app)
    logger.info(
        "opentelemetry_enabled",
        extra={
            "service_name": settings.telemetry_service_name,
            "console_exporter_enabled": settings.telemetry_console_exporter_enabled,
        },
    )
    return {
        "enabled": True,
        "service_name": settings.telemetry_service_name,
        "console_exporter_enabled": settings.telemetry_console_exporter_enabled,
    }
