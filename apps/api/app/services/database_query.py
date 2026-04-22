from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import create_engine, inspect, text

from app.core.config import settings


READ_ONLY_PATTERN = re.compile(r"^\s*(select|with|pragma|explain)\b", re.IGNORECASE | re.DOTALL)
WRITE_PATTERN = re.compile(r"\b(insert|update|delete|drop|alter|truncate|create|replace|merge|vacuum|attach|detach)\b", re.IGNORECASE)


@dataclass(frozen=True)
class QueryResult:
    columns: list[str]
    rows: list[dict[str, Any]]
    row_count: int
    dialect: str
    read_only: bool


def resolve_connection_url(configured_url: str | None = None) -> str:
    url = (configured_url or settings.database_query_default_url or settings.sqlalchemy_database_url).strip()
    if not url:
        raise ValueError("No database query connection URL is configured.")
    return url


def is_read_only_sql(sql: str) -> bool:
    stripped = sql.strip().rstrip(";")
    return bool(READ_ONLY_PATTERN.match(stripped)) and not WRITE_PATTERN.search(stripped)


def assert_safe_sql(sql: str, *, allow_writes: bool = False) -> None:
    if ";" in sql.strip().rstrip(";"):
        raise ValueError("Only one SQL statement is allowed per Database Query block.")
    if allow_writes:
        return
    if not is_read_only_sql(sql):
        raise ValueError("Database Query is read-only by default. Use SELECT/WITH/PRAGMA/EXPLAIN or enable admin write access.")


def execute_database_query(sql: str, *, connection_url: str | None = None, parameters: dict[str, Any] | None = None, allow_writes: bool | None = None, limit: int = 100) -> QueryResult:
    sql = sql.strip()
    if not sql:
        raise ValueError("SQL query is required.")
    writes_allowed = settings.database_query_allow_writes if allow_writes is None else allow_writes
    assert_safe_sql(sql, allow_writes=writes_allowed)
    engine = create_engine(resolve_connection_url(connection_url), future=True)
    with engine.connect() as connection:
        result = connection.execute(text(sql), parameters or {})
        if result.returns_rows:
            columns = list(result.keys())
            rows = [dict(row._mapping) for row in result.fetchmany(max(limit, 1))]
        else:
            connection.commit()
            columns = []
            rows = []
    return QueryResult(
        columns=columns,
        rows=rows,
        row_count=len(rows),
        dialect=engine.dialect.name,
        read_only=is_read_only_sql(sql),
    )


def introspect_schema(*, connection_url: str | None = None, max_tables: int = 25) -> dict[str, Any]:
    engine = create_engine(resolve_connection_url(connection_url), future=True)
    inspector = inspect(engine)
    tables = []
    for table_name in inspector.get_table_names()[:max_tables]:
        columns = [
            {"name": column["name"], "type": str(column["type"]), "nullable": column.get("nullable", True)}
            for column in inspector.get_columns(table_name)
        ]
        tables.append({"name": table_name, "columns": columns})
    return {"dialect": engine.dialect.name, "tables": tables}

