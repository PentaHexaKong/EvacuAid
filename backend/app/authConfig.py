"""Authentication settings. Never supply a default signing secret."""
import os
from dataclasses import dataclass, field
from urllib.parse import urlparse
from app import config as _config  # Load the existing backend .env consistently.


@dataclass(frozen=True)
class AuthSettings:
    secret: str = field(repr=False)
    issuer: str
    audience: str
    access_seconds: int
    refresh_days: int
    environment: str
    allow_guests: bool
    cors_origins: tuple[str, ...]


def settings() -> AuthSettings:
    result = AuthSettings(secret=os.getenv('AUTH_JWT_SECRET',''), issuer=os.getenv('AUTH_JWT_ISSUER','evacuaid'),
        audience=os.getenv('AUTH_JWT_AUDIENCE','evacuaid-app'), access_seconds=int(os.getenv('AUTH_ACCESS_TOKEN_SECONDS','900')),
        refresh_days=int(os.getenv('AUTH_REFRESH_TOKEN_DAYS','30')), environment=os.getenv('APP_ENV','production'),
        allow_guests=os.getenv('AUTH_ALLOW_GUEST_SESSIONS','false').lower() == 'true',
        cors_origins=tuple(origin.strip() for origin in os.getenv('CORS_ALLOWED_ORIGINS','').split(',') if origin.strip()))
    if result.environment not in {'production','development','test'}:
        raise ValueError('APP_ENV must be production, development, or test')
    if result.allow_guests and result.environment == 'production':
        raise ValueError('Guest sessions must not be enabled in production')
    if os.getenv('PILOT_DEV_SIMULATION') == '1' and result.environment == 'production':
        raise ValueError('Buddy simulation must not be enabled in production')
    if not 60 <= result.access_seconds <= 1800 or not 1 <= result.refresh_days <= 90 or not result.issuer or not result.audience:
        raise ValueError('Invalid authentication lifetimes, issuer, or audience')
    for origin in result.cors_origins:
        parsed = urlparse(origin)
        if parsed.scheme not in {'http','https'} or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username or '*' in origin:
            raise ValueError('CORS_ALLOWED_ORIGINS requires explicit HTTP(S) origins')
    return result


def validate_startup() -> AuthSettings:
    result = settings()
    if len(result.secret.encode()) < 32 or result.secret.lower() in {'change-me','secret','your-secret-key'}:
        raise ValueError('AUTH_JWT_SECRET must contain at least 32 bytes of randomly generated secret material')
    return result
