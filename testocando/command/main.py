import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from app.db.session import SessionLocal
from app.main import app, lifespan as backendLifespan
from command.aggregation import refreshSnapshots
from command.api import router
from command.safeHouses import router as safeHouseRouter

logger=logging.getLogger(__name__)


async def refreshLoop():
    while True:
        try:
            async with SessionLocal() as session,session.begin():
                await refreshSnapshots(session)
        except Exception:
            logger.exception('Command projection refresh failed; stale data remains UNKNOWN')
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app):
    async with backendLifespan(app):
        worker=asyncio.create_task(refreshLoop())
        try:
            yield
        finally:
            worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await worker


app.router.lifespan_context=lifespan
app.include_router(router)
app.include_router(safeHouseRouter)


@app.middleware('http')
async def preventCaching(request,callNext):
    response=await callNext(request)
    if request.url.path.startswith('/v1/command/'):
        response.headers['Cache-Control']='no-store'
    return response
