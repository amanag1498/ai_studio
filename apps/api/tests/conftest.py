from __future__ import annotations

from collections.abc import Generator
from pathlib import Path
import sys

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from app.core.config import settings
from app.db.base import Base
from app.models import workflow  # noqa: F401


@pytest.fixture
def db_session(tmp_path: Path) -> Generator[Session, None, None]:
    settings.app_storage_dir = str(tmp_path / "storage")
    settings.uploads_dir = str(tmp_path / "storage" / "uploads")
    settings.chroma_persist_dir = str(tmp_path / "storage" / "chroma")

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, class_=Session)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
