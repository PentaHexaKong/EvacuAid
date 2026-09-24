import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.db.models import GuestSession, User, UserPreference
from app.db.session import get_session
from app.models.user import UserResponse
from app.services import user_service


router = APIRouter(prefix='/v1', tags=['guest sessions'])


class GuestSessionResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: UserResponse


@router.post('/guest-sessions', response_model=GuestSessionResponse, status_code=status.HTTP_201_CREATED)
async def create_guest_session(session: AsyncSession = Depends(get_session)) -> GuestSessionResponse:
    token = secrets.token_urlsafe(32)
    user = await user_service.create_guest(session)
    session.add(GuestSession(user_id=user.id, token_hash=hashlib.sha256(token.encode('utf-8')).hexdigest()))
    await session.commit()
    await session.refresh(user)
    return GuestSessionResponse(access_token=token, user=UserResponse.model_validate(user))


@router.get('/me', response_model=UserResponse)
async def me(actor: User = Depends(current_user)) -> UserResponse:
    return UserResponse.model_validate(actor)


@router.delete('/guest-sessions/current', status_code=status.HTTP_204_NO_CONTENT)
async def delete_guest_account(
    actor: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await session.delete(actor)
    await session.commit()
