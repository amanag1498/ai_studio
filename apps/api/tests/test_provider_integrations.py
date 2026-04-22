from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.core.config import settings
from app.services.database_query import assert_safe_sql, execute_database_query, introspect_schema
from app.services.delivery import get_email_provider, get_notification_provider
from app.services.ocr import run_tesseract_ocr
from app.services.web_reader import ReadableHtmlParser
from app.services.web_search import LocalSearchProvider


def test_local_search_provider_returns_normalized_results() -> None:
    results = LocalSearchProvider().search("policy renewal", top_k=2)

    assert [result.rank for result in results] == [1, 2]
    assert all(result.title and result.url and result.snippet for result in results)
    assert {result.source for result in results} == {"local"}


def test_web_page_reader_parser_extracts_title_metadata_and_text() -> None:
    parser = ReadableHtmlParser()
    parser.feed(
        """
        <html>
          <head><title>Claims Guide</title><meta name="description" content="Insurance claims steps"></head>
          <body><nav>Menu</nav><main><h1>Claims</h1><p>Upload all evidence.</p><script>ignore()</script></main></body>
        </html>
        """
    )

    assert "Claims Guide" in " ".join(parser.title_parts)
    assert parser.metadata["description"] == "Insurance claims steps"
    assert "Upload all evidence." in " ".join(parser.text_parts)
    assert "ignore" not in " ".join(parser.text_parts)


def test_database_query_is_read_only_by_default(tmp_path: Path) -> None:
    db_path = tmp_path / "sample.db"
    connection = sqlite3.connect(db_path)
    connection.execute("create table claims (id integer primary key, status text)")
    connection.execute("insert into claims(status) values ('open'), ('closed')")
    connection.commit()
    connection.close()

    result = execute_database_query("select id, status from claims order by id", connection_url=f"sqlite:///{db_path}", limit=10)
    schema = introspect_schema(connection_url=f"sqlite:///{db_path}")

    assert result.columns == ["id", "status"]
    assert result.row_count == 2
    assert schema["tables"][0]["name"] == "claims"
    with pytest.raises(ValueError, match="read-only"):
        assert_safe_sql("delete from claims")


def test_delivery_providers_skip_without_external_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "smtp_host", "")
    monkeypatch.setattr(settings, "notification_provider", "webhook")
    monkeypatch.setattr(settings, "notification_webhook_url", "")

    email_result = get_email_provider().send(to=["ops@example.com"], subject="Hello", text_body="Body")
    notification_result = get_notification_provider("webhook").deliver(channel="#ops", content={"ok": True})

    assert email_result.status == "skipped"
    assert notification_result.status == "skipped"


def test_tesseract_ocr_uses_configured_command(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    image = tmp_path / "fixture.png"
    image.write_bytes(b"fake")

    class Completed:
        returncode = 0
        stdout = "Detected text"
        stderr = ""

    captured: dict[str, list[str]] = {}

    def fake_run(command, **kwargs):  # type: ignore[no-untyped-def]
        captured["command"] = command
        return Completed()

    monkeypatch.setattr("app.services.ocr.subprocess.run", fake_run)
    monkeypatch.setattr(settings, "ocr_tesseract_cmd", "tesseract")

    result = run_tesseract_ocr(image, language="eng")

    assert captured["command"][:3] == ["tesseract", str(image), "stdout"]
    assert result.text == "Detected text"
    assert result.metadata["ocr_provider"] == "tesseract"

