from __future__ import annotations

import mimetypes
import shutil
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.workflow import UploadedFile, Workflow, WorkflowRun


ALLOWED_UPLOAD_EXTENSIONS = {".pdf", ".docx", ".txt", ".csv", ".json"}
DEFAULT_MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024


def parse_accept_extensions(configured_accept: str | None) -> set[str]:
    if not configured_accept:
        return set(ALLOWED_UPLOAD_EXTENSIONS)
    requested = {
        extension.strip().lower()
        for extension in configured_accept.split(",")
        if extension.strip()
    }
    return requested & ALLOWED_UPLOAD_EXTENSIONS if requested else set(ALLOWED_UPLOAD_EXTENSIONS)


def validate_upload_file(
    path: Path,
    max_size_bytes: int = DEFAULT_MAX_UPLOAD_SIZE_BYTES,
    accepted_extensions: set[str] | None = None,
) -> tuple[str, int]:
    if not path.exists() or not path.is_file():
        raise ValueError(f"Upload file does not exist: {path}")

    extension = path.suffix.lower()
    allowed_extensions = accepted_extensions or set(ALLOWED_UPLOAD_EXTENSIONS)
    if extension not in allowed_extensions:
        raise ValueError(
            f"Unsupported file extension '{extension}'. Allowed types: {', '.join(sorted(allowed_extensions))}."
        )

    size_bytes = path.stat().st_size
    if size_bytes > max_size_bytes:
        raise ValueError(
            f"File '{path.name}' exceeds max upload size of {max_size_bytes} bytes."
        )

    return extension, size_bytes


def persist_uploaded_file(
    session: Session,
    *,
    source_path: Path,
    workflow: Workflow,
    workflow_run: WorkflowRun,
    node_id: str,
    max_size_bytes: int,
    accepted_extensions: set[str] | None = None,
) -> UploadedFile:
    extension, size_bytes = validate_upload_file(
        source_path,
        max_size_bytes=max_size_bytes,
        accepted_extensions=accepted_extensions,
    )

    target_dir = (
        Path(settings.uploads_dir)
        / f"workflow_{workflow.id}"
        / f"run_{workflow_run.id}"
        / f"node_{node_id}"
    )
    target_dir.mkdir(parents=True, exist_ok=True)

    stored_name = f"{uuid4().hex}{extension}"
    target_path = target_dir / stored_name
    shutil.copy2(source_path, target_path)

    uploaded_file = UploadedFile(
        workflow_id=workflow.id,
        workflow_run_id=workflow_run.id,
        node_id=node_id,
        original_name=source_path.name,
        stored_name=stored_name,
        extension=extension,
        mime_type=mimetypes.guess_type(source_path.name)[0],
        size_bytes=size_bytes,
        storage_path=str(target_path.resolve()),
        metadata_json={
            "source_path": str(source_path.resolve()),
            "relative_storage_path": str(target_path.relative_to(Path(settings.app_storage_dir))),
        },
    )
    session.add(uploaded_file)
    session.flush()
    return uploaded_file


async def persist_runtime_upload(
    upload: UploadFile,
    *,
    max_size_bytes: int = DEFAULT_MAX_UPLOAD_SIZE_BYTES,
    accepted_extensions: set[str] | None = None,
) -> dict:
    original_name = Path(upload.filename or "upload").name
    extension = Path(original_name).suffix.lower()
    allowed_extensions = accepted_extensions or set(ALLOWED_UPLOAD_EXTENSIONS)
    if extension not in allowed_extensions:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unsupported file extension '{extension}'. "
                f"Allowed types: {', '.join(sorted(allowed_extensions))}."
            ),
        )

    target_dir = Path(settings.uploads_dir) / "runtime"
    target_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid4().hex}{extension}"
    target_path = target_dir / stored_name
    size_bytes = 0

    try:
        with target_path.open("wb") as target_file:
            while chunk := await upload.read(1024 * 1024):
                size_bytes += len(chunk)
                if size_bytes > max_size_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"File '{original_name}' exceeds max upload size of {max_size_bytes} bytes.",
                    )
                target_file.write(chunk)
    except Exception:
        target_path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()

    return {
        "original_name": original_name,
        "stored_name": stored_name,
        "extension": extension,
        "mime_type": upload.content_type or mimetypes.guess_type(original_name)[0],
        "size_bytes": size_bytes,
        "storage_path": str(target_path.resolve()),
        "relative_storage_path": str(target_path.relative_to(Path(settings.app_storage_dir))),
    }


async def persist_library_upload(
    session: Session,
    upload: UploadFile,
    *,
    max_size_bytes: int = DEFAULT_MAX_UPLOAD_SIZE_BYTES,
    accepted_extensions: set[str] | None = None,
    workflow: Workflow | None = None,
    node_id: str = "library_upload",
) -> UploadedFile:
    persisted = await persist_runtime_upload(
        upload,
        max_size_bytes=max_size_bytes,
        accepted_extensions=accepted_extensions,
    )
    uploaded_file = UploadedFile(
        workflow_id=workflow.id if workflow else None,
        workflow_run_id=None,
        node_id=node_id,
        original_name=persisted["original_name"],
        stored_name=persisted["stored_name"],
        extension=persisted["extension"],
        mime_type=persisted["mime_type"],
        size_bytes=persisted["size_bytes"],
        storage_path=persisted["storage_path"],
        metadata_json={
            "source": "file_library",
            "relative_storage_path": persisted["relative_storage_path"],
        },
    )
    session.add(uploaded_file)
    session.flush()
    return uploaded_file


def parse_max_size_bytes(config: dict) -> int:
    value = config.get("maxSizeMb", 10)
    try:
        size_mb = float(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid maxSizeMb value '{value}'.",
        ) from exc
    return max(1, int(size_mb * 1024 * 1024))
