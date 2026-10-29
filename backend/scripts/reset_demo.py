"""Puts the two demo accounts back to a clean starting point before a live demo.

    python -m scripts.reset_demo                # end open help sessions, remove simulated warnings and their answers
    python -m scripts.reset_demo --warning      # same, then raise one Awas flood warning at the demo location for 3 h
    python -m scripts.reset_demo --unlink       # also remove the Buddy link, so the invite can be shown again

Only touches the accounts named in DEMO_EMAILS and DEMO_SIMULATION warnings; real users and real alerts are left alone.
"""
import argparse
import asyncio
from datetime import timedelta

from sqlalchemy import delete, or_, select

from app.db.models import BuddyRelationship, User
from app.db.models.buddySession import BuddyRequest
from app.db.session import SessionLocal, engine
from app.services import buddyRequestService
from app.services.alertSimulation import apply, clear

DEMO_EMAILS = ('rina.demo@evacuaid.app', 'andi.demo@evacuaid.app')
DEMO_CENTER = (-6.2, 106.8)


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--warning', action='store_true', help='raise one Awas flood warning at the demo location after resetting')
    parser.add_argument('--unlink', action='store_true', help='remove the Buddy link between the demo accounts')
    args = parser.parse_args()
    async with SessionLocal() as session:
        users = (await session.execute(select(User.id).where(User.email.in_(DEMO_EMAILS)))).scalars().all()
        if len(users) != len(DEMO_EMAILS):
            raise SystemExit(f'expected {len(DEMO_EMAILS)} demo accounts, found {len(users)}')
        # Ends sessions the same way the app does, which also wipes shared locations and consent.
        requests = (await session.execute(select(BuddyRequest).where(BuddyRequest.requester_id.in_(users), or_(BuddyRequest.helper_id.is_(None), BuddyRequest.helper_id.in_(users)), BuddyRequest.status.not_in(buddyRequestService.TERMINAL)))).scalars().all()
        for request in requests:
            request.status = 'INTERRUPTED'
            await buddyRequestService.terminate(session, request)
        if args.unlink:
            await session.execute(delete(BuddyRelationship).where(BuddyRelationship.userId.in_(users), BuddyRelationship.buddyUserId.in_(users)))
        await session.commit()
        print(f'ended {len(requests)} help session(s)' + ('; removed the Buddy link' if args.unlink else ''))
        print(f'removed {await clear(session)} simulated warning(s)')
        if args.warning:
            row, (latitude, longitude) = await apply(session, 'awas', 'FLOOD', DEMO_CENTER, 3.0, 3.0)
            print(f'raised AWAS FLOOD around {latitude:.5f},{longitude:.5f} until {row.validUntil + timedelta(hours=7):%H:%M} WIB')
    await engine.dispose()


if __name__ == '__main__':
    asyncio.run(main())
