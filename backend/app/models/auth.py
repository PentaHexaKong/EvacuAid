from enum import Enum
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator
from email_validator import validate_email, EmailNotValidError
from app.models.user import AccessibilityItem, AccessibilityUpdate, UserCreate


class Role(str, Enum):
    CITIZEN = 'CITIZEN'
    RESPONDER = 'RESPONDER'
    GOVERNMENT = 'GOVERNMENT'
    ADMIN = 'ADMIN'


def normalize_email(value: str) -> str:
    try:
        return validate_email(value.strip(), check_deliverability=False).normalized.casefold()
    except EmailNotValidError:
        raise ValueError('Invalid email address') from None


class AuthModel(BaseModel):
    model_config = ConfigDict(extra='forbid', hide_input_in_errors=True)


class Login(AuthModel):
    email: str = Field(max_length=254)
    password: SecretStr = Field(min_length=1, max_length=128)
    _email = field_validator('email')(normalize_email)


class Register(Login):
    password: SecretStr = Field(min_length=12, max_length=128)
    name: str | None = Field(default=None, max_length=60)
    accessibility: list[AccessibilityItem] = Field(default_factory=list, max_length=20)
    _name = field_validator('name')(UserCreate.clean_name.__func__)

    @field_validator('accessibility')
    @classmethod
    def unique_attributes(cls, value):
        AccessibilityUpdate(items=value)
        return value


class Refresh(AuthModel):
    refresh_token: SecretStr = Field(min_length=1, max_length=128)


class AuthUser(AuthModel):
    id: UUID
    email: str | None
    name: str | None
    role: Role


class Tokens(AuthModel):
    access_token: str
    token_type: str = 'bearer'
    expires_in: int
    refresh_token: str
    refresh_expires_in: int
    user: AuthUser


class RoleUpdate(AuthModel):
    role: Role
