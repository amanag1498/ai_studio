from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.config import settings
from app.db.session import create_db_and_storage_dirs
from app.services.telemetry import configure_opentelemetry, configure_structured_logging


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_db_and_storage_dirs()
    yield


configure_structured_logging()

app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.state.telemetry = configure_opentelemetry(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in settings.cors_allowed_origins.split(",")
        if origin.strip()
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
