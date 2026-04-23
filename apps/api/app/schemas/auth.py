from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class UserSignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    display_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=6, max_length=255)


class AdminCreateRequest(UserSignupRequest):
    setup_token: str = Field(default="", max_length=255)


class UserLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=1, max_length=255)


class AppUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str
    role: str
    default_workspace_id: int | None = None
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None


class AdminUserUpdate(BaseModel):
    role: str | None = Field(default=None, max_length=50)
    is_active: bool | None = None
    default_workspace_id: int | None = None


class AuthResponse(BaseModel):
    user: AppUserRead
    local_session_token: str
    message: str
