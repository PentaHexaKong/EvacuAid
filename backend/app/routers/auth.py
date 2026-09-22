from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.auth import AuthAccount
from app.db.session import get_session
from app.models.auth import AuthResponse, GoogleLoginRequest, PasswordCredentials, PasswordResetConfirm, PasswordResetRequest, ProfileResponse, ProfileUpdate, RefreshRequest, RegisterRequest
from app.services import auth_service
from app.services.mail_service import configured as mail_configured, send_password_reset_email
from app.services.rate_limit_service import enforce_rate_limit


router = APIRouter(prefix='/v1', tags=['auth'])
bearer = HTTPBearer(auto_error=False)


async def rate_limit(request: Request, scope: str, identity: str) -> None:
    await enforce_rate_limit(
        getattr(request.app.state, 'redisClient', None),
        scope=scope,
        ip=request.client.host if request.client else 'unknown',
        identity=identity,
    )


async def authenticated_account(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> AuthAccount:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='missing access token')
    return await auth_service.current_account(session, credentials)


@router.post('/auth/register', response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, request: Request, session: AsyncSession = Depends(get_session)) -> AuthResponse:
    await rate_limit(request, 'register', payload.email)
    return await auth_service.register(session, payload)


@router.post('/auth/login', response_model=AuthResponse)
async def login(payload: PasswordCredentials, request: Request, session: AsyncSession = Depends(get_session)) -> AuthResponse:
    await rate_limit(request, 'login', payload.email)
    return await auth_service.login(session, payload)


@router.post('/auth/google', response_model=AuthResponse)
async def login_google(payload: GoogleLoginRequest, request: Request, session: AsyncSession = Depends(get_session)) -> AuthResponse:
    await rate_limit(request, 'google', 'google')
    return await auth_service.login_google(session, payload)


@router.post('/auth/refresh', response_model=AuthResponse)
async def refresh(payload: RefreshRequest, session: AsyncSession = Depends(get_session)) -> AuthResponse:
    return await auth_service.refresh(session, payload.refresh_token)


@router.post('/auth/logout', status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, session: AsyncSession = Depends(get_session)) -> Response:
    await auth_service.logout(session, payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post('/auth/password/reset-request', status_code=status.HTTP_202_ACCEPTED)
async def password_reset_request(payload: PasswordResetRequest, request: Request, session: AsyncSession = Depends(get_session)) -> Response:
    await rate_limit(request, 'password-reset', payload.email)
    if not mail_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail='password reset email is not configured')
    token = await auth_service.create_password_reset(session, payload.email)
    if token is not None:
        await send_password_reset_email(payload.email, token)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post('/auth/password/reset', status_code=status.HTTP_204_NO_CONTENT)
async def password_reset(payload: PasswordResetConfirm, session: AsyncSession = Depends(get_session)) -> Response:
    await auth_service.reset_password(session, payload.token, payload.password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get('/me/profile', response_model=ProfileResponse)
async def get_profile(account: AuthAccount = Depends(authenticated_account)) -> ProfileResponse:
    return auth_service.profile_response(account.user)


@router.patch('/me/profile', response_model=ProfileResponse)
async def patch_profile(payload: ProfileUpdate, account: AuthAccount = Depends(authenticated_account), session: AsyncSession = Depends(get_session)) -> ProfileResponse:
    return await auth_service.update_profile(session, account, payload)
