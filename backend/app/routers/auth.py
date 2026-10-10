from uuid import UUID
from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from app.auth import bearer, current_user, require_roles
from app.db.models import User
from app.db.session import get_session
from app.models.auth import Register, Login, Refresh, Tokens, AuthUser, RoleUpdate
from app.services import authService, authRateLimit


class PrivateAuthRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        async def handler(request):
            try:
                response = await original(request)
            except RequestValidationError as error:
                response = JSONResponse(status_code=422, content={'detail': [
                    {'loc': list(item['loc']), 'type': item['type'], 'msg': 'Invalid authentication input'} for item in error.errors()]})
            except HTTPException as error:
                response = JSONResponse(status_code=error.status_code, content={'detail':error.detail}, headers=error.headers)
            response.headers['Cache-Control'] = 'no-store'
            response.headers['Pragma'] = 'no-cache'
            return response
        return handler


router = APIRouter(prefix='/v1/auth', tags=['authentication'], route_class=PrivateAuthRoute)


async def limited(session, request, action, email=None):
    await authRateLimit.enforce(session, action, request.client.host if request.client else 'unknown', email)


@router.post('/register', response_model=Tokens, status_code=201)
async def register(payload: Register, request: Request, session: AsyncSession = Depends(get_session),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    await limited(session, request, 'register')
    try:
        return await authService.register(session, payload, credentials.credentials if credentials else None)
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, 'Unable to register with these credentials') from None


@router.post('/login', response_model=Tokens)
async def login(payload: Login, request: Request, session: AsyncSession = Depends(get_session)):
    await limited(session, request, 'login', payload.email)
    return await authService.login(session, payload)


@router.post('/refresh', response_model=Tokens)
async def refresh(payload: Refresh, request: Request, session: AsyncSession = Depends(get_session)):
    await limited(session, request, 'refresh')
    return await authService.refresh(session, payload.refresh_token.get_secret_value())


@router.post('/logout', status_code=204)
async def logout(payload: Refresh, request: Request, session: AsyncSession = Depends(get_session)):
    await limited(session, request, 'logout')
    await authService.logout(session, payload.refresh_token.get_secret_value())


@router.get('/me', response_model=AuthUser)
async def me(actor: User = Depends(current_user)):
    if actor.email is None:
        raise authService.unauthorized()
    return AuthUser(id=actor.id, email=actor.email, name=actor.name, role=actor.role)


@router.patch('/users/{userId}/role')
async def assign_role(userId: UUID, payload: RoleUpdate, actor: User = Depends(require_roles('ADMIN')),
    session: AsyncSession = Depends(get_session)):
    await session.execute(text('SELECT pg_advisory_xact_lock(734191102)'))
    await session.refresh(actor)
    if actor.role != 'ADMIN':
        raise HTTPException(403, 'Not authorized for this role')
    user = await session.get(User, userId, with_for_update=True)
    if user is None or user.email is None:
        raise HTTPException(404, 'Account not found')
    if user.role == 'ADMIN' and payload.role != 'ADMIN':
        other = (await session.execute(select(User.id).where(User.role == 'ADMIN', User.id != userId).limit(1))).scalar_one_or_none()
        if other is None:
            raise HTTPException(409, 'Cannot remove the last administrator')
    user.role = payload.role.value
    await session.commit()
    return {'id':str(user.id), 'role':user.role}
