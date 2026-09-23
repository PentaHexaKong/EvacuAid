import hashlib
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import GuestSession, User
from app.db.session import get_session


bearer = HTTPBearer(auto_error=False)


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if credentials is None or credentials.scheme.lower() != 'bearer':
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='guest session required', headers={'WWW-Authenticate': 'Bearer'})
    token_hash = hashlib.sha256(credentials.credentials.encode('utf-8')).hexdigest()
    result = await session.execute(select(User).join(GuestSession, GuestSession.user_id == User.id).where(GuestSession.token_hash == token_hash))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='invalid guest session', headers={'WWW-Authenticate': 'Bearer'})
    return user


def require_owner(user_id: uuid.UUID, actor: User) -> None:
    if user_id != actor.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='guest session does not own this profile')
