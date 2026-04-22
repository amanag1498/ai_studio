from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from app.core.config import settings


@dataclass(frozen=True)
class ReadablePage:
    url: str
    title: str
    text: str
    metadata: dict[str, Any]


class ReadableHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []
        self.metadata: dict[str, str] = {}
        self._stack: list[str] = []
        self._capture_title = False
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attrs_map = {key.lower(): value or "" for key, value in attrs}
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
        if tag == "title":
            self._capture_title = True
        if tag == "meta":
            name = attrs_map.get("name") or attrs_map.get("property")
            content = attrs_map.get("content")
            if name and content:
                self.metadata[name] = content
        self._stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
        if tag == "title":
            self._capture_title = False
        if self._stack:
            self._stack.pop()

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text:
            return
        if self._capture_title:
            self.title_parts.append(text)
        elif self._skip_depth == 0:
            self.text_parts.append(text)


def fetch_readable_page(url: str, *, markdown: bool = False) -> ReadablePage:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Web Page Reader only supports http and https URLs.")

    request = Request(
        url,
        headers={
            "User-Agent": settings.web_reader_user_agent,
            "Accept": "text/html,text/plain,application/xhtml+xml",
        },
    )
    with urlopen(request, timeout=settings.web_reader_timeout_seconds) as response:  # noqa: S310 - workflow-controlled URL with strict scheme/limits
        content_type = response.headers.get("content-type", "")
        if not any(allowed in content_type.lower() for allowed in ("text/html", "text/plain", "application/xhtml+xml", "")):
            raise ValueError(f"Unsupported page content type: {content_type}")
        raw = response.read(settings.web_reader_max_bytes + 1)
    if len(raw) > settings.web_reader_max_bytes:
        raise ValueError(f"Page exceeded WEB_READER_MAX_BYTES ({settings.web_reader_max_bytes}).")

    body = raw.decode("utf-8", errors="ignore")
    if "html" not in content_type.lower():
        text = body.strip()
        return ReadablePage(url=url, title=url, text=text, metadata={"content_type": content_type, "format": "text"})

    parser = ReadableHtmlParser()
    parser.feed(body)
    title = " ".join(parser.title_parts).strip() or parser.metadata.get("og:title") or url
    text = "\n".join(part for part in parser.text_parts if part).strip()
    if markdown:
        text = f"# {title}\n\n{text}"
    return ReadablePage(
        url=url,
        title=title,
        text=text,
        metadata={
            "content_type": content_type,
            "description": parser.metadata.get("description") or parser.metadata.get("og:description"),
            "site_name": parser.metadata.get("og:site_name"),
            "format": "markdown" if markdown else "text",
            "word_count": len(text.split()),
            "source": "web_page_reader",
        },
    )

