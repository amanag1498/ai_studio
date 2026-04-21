from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.workflow import AppUser, AuthEvent


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 120_000)
    return f"pbkdf2_sha256$120000${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, encoded_hash: str) -> bool:
    try:
        algorithm, iterations, salt_b64, digest_b64 = encoded_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected_digest = base64.b64decode(digest_b64)
        actual_digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual_digest, expected_digest)
    except (ValueError, TypeError):
        return False


def create_local_user(session: Session, *, email: str, display_name: str, password: str) -> AppUser:
    normalized_email = email.strip().lower()
    existing = session.scalar(select(AppUser).where(AppUser.email == normalized_email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists.")

    user_count = session.scalar(select(AppUser.id).limit(1))
    user = AppUser(
        email=normalized_email,
        display_name=display_name.strip(),
        password_hash=hash_password(password),
        role="admin" if user_count is None else "user",
    )
    session.add(user)
    session.flush()
    record_auth_event(session, "signup", user=user, email=normalized_email)
    session.commit()
    session.refresh(user)
    return user


def login_local_user(session: Session, *, email: str, password: str) -> AppUser:
    normalized_email = email.strip().lower()
    user = session.scalar(select(AppUser).where(AppUser.email == normalized_email))
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        record_auth_event(session, "login_failed", user=None, email=normalized_email)
        session.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

    user.last_login_at = datetime.now(timezone.utc).replace(tzinfo=None)
    record_auth_event(session, "login", user=user, email=normalized_email)
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def record_auth_event(
    session: Session,
    event_type: str,
    *,
    user: AppUser | None,
    email: str | None,
    metadata: dict | None = None,
) -> AuthEvent:
    event = AuthEvent(
        user_id=user.id if user else None,
        event_type=event_type,
        email=email,
        metadata_json=metadata or {},
    )
    session.add(event)
    return event


def create_local_session_token(user: AppUser) -> str:
    token = secrets.token_urlsafe(24)
    return f"local-{user.id}-{token}"
