import uuid
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from app.authConfig import settings
from app.db.models import User
from app.db.session import get_session
from app.services import authService

bearer = HTTPBearer(auto_error=False)

async def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session)) -> User:
    if credentials is None:
        raise authService.unauthorized()
    raw = credentials.credentials
    if '.' in raw:
        return await authService.authenticate(session, raw)
    if settings().allow_guests:
        user = await authService.legacy_guest(session, raw)
        if user:
            return user
    raise authService.unauthorized()

require_authenticated_user = current_user

def require_roles(*roles):
    allowed = {getattr(role, 'value', role) for role in roles}
    async def check(actor: User = Depends(current_user)):
        if actor.email is None or actor.role not in allowed:
            raise HTTPException(403, 'Not authorized for this role')
        return actor
    return check

def require_owner(user_id: uuid.UUID, actor: User) -> None:
    if user_id != actor.id:
        raise HTTPException(403, 'Not authorized for this resource')


async def require_profile_owner(userId: uuid.UUID, actor: User = Depends(current_user)) -> User:
    """Reusable path ownership dependency, including for future profile routers."""
    require_owner(userId, actor)
    return actor
