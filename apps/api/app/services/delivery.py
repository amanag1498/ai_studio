from __future__ import annotations

import json
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Any, Protocol
from urllib.request import Request, urlopen

from app.core.config import settings


@dataclass(frozen=True)
class DeliveryResult:
    status: str
    provider: str
    detail: str
    metadata: dict[str, Any]


class EmailProvider(Protocol):
    provider_name: str

    def send(self, *, to: list[str], subject: str, text_body: str, html_body: str | None = None, cc: list[str] | None = None, bcc: list[str] | None = None) -> DeliveryResult:
        ...


class SmtpEmailProvider:
    provider_name = "smtp"

    def send(self, *, to: list[str], subject: str, text_body: str, html_body: str | None = None, cc: list[str] | None = None, bcc: list[str] | None = None) -> DeliveryResult:
        if not settings.smtp_host:
            return DeliveryResult("skipped", self.provider_name, "SMTP_HOST is not configured.", {"to_count": len(to)})
        if not to:
            raise ValueError("Email requires at least one recipient.")

        message = EmailMessage()
        message["From"] = settings.smtp_from_email or settings.smtp_username
        message["To"] = ", ".join(to)
        if cc:
            message["Cc"] = ", ".join(cc)
        message["Subject"] = subject
        message.set_content(text_body)
        if html_body:
            message.add_alternative(html_body, subtype="html")

        recipients = to + (cc or []) + (bcc or [])
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message, to_addrs=recipients)
        return DeliveryResult("sent", self.provider_name, "Email delivered by SMTP provider.", {"to_count": len(to), "cc_count": len(cc or []), "bcc_count": len(bcc or [])})


class NotificationProvider(Protocol):
    provider_name: str

    def deliver(self, *, channel: str, content: Any, title: str | None = None) -> DeliveryResult:
        ...


class WebhookNotificationProvider:
    provider_name = "webhook"

    def deliver(self, *, channel: str, content: Any, title: str | None = None) -> DeliveryResult:
        if not settings.notification_webhook_url:
            return DeliveryResult("skipped", self.provider_name, "NOTIFICATION_WEBHOOK_URL is not configured.", {"channel": channel})
        payload = {"channel": channel, "title": title or "AI Studio notification", "content": content}
        request = Request(
            settings.notification_webhook_url,
            data=json.dumps(payload, default=str).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": settings.web_reader_user_agent},
            method="POST",
        )
        with urlopen(request, timeout=settings.smtp_timeout_seconds) as response:  # noqa: S310 - configured webhook target
            status_code = getattr(response, "status", 200)
            response_body = response.read(2_000).decode("utf-8", errors="ignore")
        return DeliveryResult("sent", self.provider_name, f"Webhook returned HTTP {status_code}.", {"channel": channel, "status_code": status_code, "response_preview": response_body[:400]})


class LocalNotificationProvider:
    provider_name = "local"

    def deliver(self, *, channel: str, content: Any, title: str | None = None) -> DeliveryResult:
        return DeliveryResult("captured", self.provider_name, "Notification captured in workflow run logs.", {"channel": channel, "title": title or "AI Studio notification", "content_preview": str(content)[:500]})


def get_email_provider() -> EmailProvider:
    return SmtpEmailProvider()


def get_notification_provider(provider_name: str | None = None) -> NotificationProvider:
    provider = (provider_name or settings.notification_provider or "local").strip().lower()
    if provider in {"webhook", "slack", "discord", "teams"}:
        return WebhookNotificationProvider()
    return LocalNotificationProvider()


def split_recipients(raw: str) -> list[str]:
    return [item.strip() for item in raw.replace(";", ",").split(",") if item.strip()]

