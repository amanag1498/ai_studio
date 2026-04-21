from __future__ import annotations

from dataclasses import dataclass

from app.core.config import settings


@dataclass
class TextChunk:
    index: int
    text: str
    char_start: int
    char_end: int
    token_estimate: int


class TextChunker:
    def __init__(self, chunk_size: int | None = None, chunk_overlap: int | None = None) -> None:
        chunk_size = chunk_size if chunk_size is not None else settings.rag_chunk_size
        chunk_overlap = chunk_overlap if chunk_overlap is not None else settings.rag_chunk_overlap
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def chunk(self, text: str) -> list[TextChunk]:
        normalized_text = text.strip()
        if not normalized_text:
            return []

        chunks: list[TextChunk] = []
        start = 0
        text_length = len(normalized_text)
        index = 0

        while start < text_length:
            end = min(start + self.chunk_size, text_length)
            if end < text_length:
                split_at = normalized_text.rfind(" ", start, end)
                if split_at > start + self.chunk_size // 2:
                    end = split_at

            chunk_text = normalized_text[start:end].strip()
            if chunk_text:
                chunks.append(
                    TextChunk(
                        index=index,
                        text=chunk_text,
                        char_start=start,
                        char_end=end,
                        token_estimate=max(1, len(chunk_text.split())),
                    )
                )
                index += 1

            if end >= text_length:
                break

            start = max(end - self.chunk_overlap, start + 1)

        return chunks
