from __future__ import annotations

from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Protocol
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.core.config import settings


@dataclass(frozen=True)
class SearchResult:
    title: str
    url: str
    snippet: str
    source: str
    rank: int


class WebSearchProvider(Protocol):
    provider_name: str

    def search(self, query: str, *, top_k: int) -> list[SearchResult]:
        ...


class DuckDuckGoHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[dict[str, str]] = []
        self._current: dict[str, str] | None = None
        self._capture: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = {key: value or "" for key, value in attrs}
        class_name = attrs_map.get("class", "")
        if tag == "a" and "result__a" in class_name:
            self._current = {"title": "", "url": attrs_map.get("href", ""), "snippet": ""}
            self._capture = "title"
        elif tag in {"a", "div"} and self._current is not None and "result__snippet" in class_name:
            self._capture = "snippet"

    def handle_data(self, data: str) -> None:
        if self._current is not None and self._capture:
            existing = self._current.get(self._capture, "")
            self._current[self._capture] = f"{existing} {data}".strip()

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._capture == "title":
            self._capture = None
        if tag == "div" and self._current and self._current.get("title") and self._current.get("url"):
            if self._current not in self.results:
                self.results.append(self._current)
            self._current = None
            self._capture = None


class DuckDuckGoSearchProvider:
    provider_name = "duckduckgo"

    def search(self, query: str, *, top_k: int) -> list[SearchResult]:
        if not query.strip():
            return []
        endpoint = "https://duckduckgo.com/html/?" + urlencode({"q": query})
        request = Request(
            endpoint,
            headers={
                "User-Agent": settings.web_reader_user_agent,
                "Accept": "text/html,application/xhtml+xml",
            },
        )
        with urlopen(request, timeout=settings.web_search_timeout_seconds) as response:  # noqa: S310 - user-configured provider request
            body = response.read(min(settings.web_reader_max_bytes, 1_000_000)).decode("utf-8", errors="ignore")
        parser = DuckDuckGoHtmlParser()
        parser.feed(body)
        return [
            SearchResult(
                title=item.get("title", "").strip(),
                url=item.get("url", "").strip(),
                snippet=item.get("snippet", "").strip(),
                source=self.provider_name,
                rank=index,
            )
            for index, item in enumerate(parser.results[:top_k], start=1)
            if item.get("title") and item.get("url")
        ]


class LocalSearchProvider:
    provider_name = "local"

    def search(self, query: str, *, top_k: int) -> list[SearchResult]:
        return [
            SearchResult(
                title=f"Local development result {index}",
                url=f"local://search/{index}",
                snippet=f"Search provider is local-only for query '{query}'. Configure WEB_SEARCH_PROVIDER=duckduckgo for live web results.",
                source=self.provider_name,
                rank=index,
            )
            for index in range(1, max(top_k, 0) + 1)
        ]


def get_web_search_provider(provider_name: str | None = None) -> WebSearchProvider:
    provider = (provider_name or settings.web_search_provider or "duckduckgo").strip().lower()
    if provider in {"duckduckgo", "ddg"}:
        return DuckDuckGoSearchProvider()
    return LocalSearchProvider()

