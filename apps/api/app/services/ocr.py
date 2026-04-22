from __future__ import annotations

import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import settings


@dataclass(frozen=True)
class OcrResult:
    text: str
    metadata: dict[str, Any]


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"}
PDF_EXTENSIONS = {".pdf"}


def run_tesseract_ocr(path: str | Path, *, language: str = "eng") -> OcrResult:
    source_path = Path(path)
    if not source_path.exists():
        raise ValueError(f"OCR source file does not exist: {source_path}")
    if source_path.suffix.lower() in PDF_EXTENSIONS:
        return _run_tesseract_pdf(source_path, language=language)
    return _run_tesseract_image(source_path, language=language)


def _run_tesseract_image(path: Path, *, language: str) -> OcrResult:
    command = [settings.ocr_tesseract_cmd, str(path), "stdout", "-l", language]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=settings.ocr_timeout_seconds, check=False)  # noqa: S603 - configured local OCR executable
    if completed.returncode != 0:
        raise RuntimeError(_ocr_error_message(completed.stderr))
    text = completed.stdout.strip()
    return OcrResult(
        text=text,
        metadata={
            "parser": "ocr",
            "ocr_provider": "tesseract",
            "language": language,
            "source_extension": path.suffix.lower(),
            "word_count": len(text.split()),
            "confidence": None,
            "warnings": [],
        },
    )


def _run_tesseract_pdf(path: Path, *, language: str) -> OcrResult:
    with tempfile.TemporaryDirectory(prefix="ai-studio-ocr-") as tmp_dir:
        output_base = Path(tmp_dir) / "ocr"
        command = [settings.ocr_tesseract_cmd, str(path), str(output_base), "-l", language, "txt"]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=settings.ocr_timeout_seconds, check=False)  # noqa: S603 - configured local OCR executable
        if completed.returncode != 0:
            raise RuntimeError(_ocr_error_message(completed.stderr))
        output_path = output_base.with_suffix(".txt")
        text = output_path.read_text(encoding="utf-8", errors="ignore").strip() if output_path.exists() else ""
    return OcrResult(
        text=text,
        metadata={
            "parser": "ocr",
            "ocr_provider": "tesseract",
            "language": language,
            "source_extension": path.suffix.lower(),
            "word_count": len(text.split()),
            "confidence": None,
            "warnings": ["PDF OCR requires a Tesseract build with PDF/image support."],
        },
    )


def _ocr_error_message(stderr: str) -> str:
    clean = (stderr or "").strip()
    if "not found" in clean.lower() or "no such file" in clean.lower():
        return "Tesseract OCR is not installed or OCR_TESSERACT_CMD is invalid."
    return clean or "Tesseract OCR failed."

