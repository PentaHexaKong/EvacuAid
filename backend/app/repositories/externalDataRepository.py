from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.externalData import ExternalDataSnapshot


async def saveSnapshot(session: AsyncSession, source: str, scope: str, payload: dict[str, Any]) -> None:
    statement = insert(ExternalDataSnapshot).values(source=source, scope=scope, payload=payload)
    statement = statement.on_conflict_do_update(
        constraint='uq_external_data_snapshot_source_scope',
        set_={'payload': statement.excluded.payload, 'fetched_at': datetime.now().astimezone()},
    )
    await session.execute(statement)


async def getSnapshot(session: AsyncSession, source: str, scope: str) -> ExternalDataSnapshot | None:
    result = await session.execute(select(ExternalDataSnapshot).where(ExternalDataSnapshot.source == source, ExternalDataSnapshot.scope == scope))
    return result.scalar_one_or_none()
