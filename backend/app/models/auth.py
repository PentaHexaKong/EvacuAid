from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _email(value: str) -> str:
    normalized = value.strip().lower()
    if len(normalized) > 320 or normalized.count('@') != 1:
        raise ValueError('email is invalid')
    local, domain = normalized.split('@')
    if not local or not domain or '.' not in domain:
        raise ValueError('email is invalid')
    return normalized


class PasswordCredentials(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(min_length=12, max_length=128)
    remember_me: bool = Field(alias='rememberMe', default=False)
    model_config = ConfigDict(populate_by_name=True)

    @field_validator('email')
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _email(value)


class RegisterRequest(PasswordCredentials):
    name: str = Field(min_length=1, max_length=60)

    @field_validator('name')
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = ' '.join(value.split())
        if not normalized:
            raise ValueError('name is required')
        return normalized


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(alias='idToken', min_length=1, max_length=10000)
    remember_me: bool = Field(alias='rememberMe', default=False)
    model_config = ConfigDict(populate_by_name=True)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(alias='refreshToken', min_length=20, max_length=512)
    model_config = ConfigDict(populate_by_name=True)


class PasswordResetRequest(BaseModel):
    email: str = Field(max_length=320)

    @field_validator('email')
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return _email(value)


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    password: str = Field(min_length=12, max_length=128)


class ProfilePreferences(BaseModel):
    language: Literal['id', 'en'] = 'id'
    larger_text: bool = Field(alias='largerText', default=False)
    stronger_contrast: bool = Field(alias='strongerContrast', default=False)
    onboarding_completed: bool = Field(alias='onboardingCompleted', default=False)
    model_config = ConfigDict(populate_by_name=True)


class ProfilePreferencesUpdate(BaseModel):
    language: Literal['id', 'en'] | None = None
    larger_text: bool | None = Field(alias='largerText', default=None)
    stronger_contrast: bool | None = Field(alias='strongerContrast', default=None)
    onboarding_completed: bool | None = Field(alias='onboardingCompleted', default=None)
    model_config = ConfigDict(populate_by_name=True)


class ProfileResponse(BaseModel):
    id: uuid.UUID
    name: str | None
    preferences: ProfilePreferences


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    preferences: ProfilePreferencesUpdate | None = None

    @field_validator('name')
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return ' '.join(value.split())


class AuthResponse(BaseModel):
    access_token: str = Field(alias='accessToken')
    refresh_token: str = Field(alias='refreshToken')
    token_type: Literal['bearer'] = Field(alias='tokenType', default='bearer')
    expires_in: int = Field(alias='expiresIn')
    profile: ProfileResponse
    model_config = ConfigDict(populate_by_name=True)
