import asyncio
import logging
from datetime import timedelta

import httpx
from sqlalchemy import delete, select, update

from app.db.session import SessionLocal
from app.db.models.pilot import PilotAvailability, PilotInbox, PilotInvitation, PilotMessage, PilotOutbox, PilotPushToken, PilotRequest
from app.services import alertService
from app.services import pilotService as service


async def tick():
    async with SessionLocal() as db:
        await service.expire(db)
        await alertService.enqueueAlerts(db)
        invites = (await db.execute(select(PilotInvitation).where(PilotInvitation.status.in_(('PENDING', 'REDEEMED')), PilotInvitation.expires_at <= service.now()).with_for_update(skip_locked=True))).scalars()
        for row in invites:
            row.status = 'EXPIRED'
        await db.execute(update(PilotAvailability).where(PilotAvailability.observed_at < service.now() - timedelta(minutes=2)).values(latitude=None, longitude=None, observed_at=None, accuracy_m=None))
        await db.execute(delete(PilotMessage).where(PilotMessage.created_at < service.now() - timedelta(hours=24)))
        await db.execute(delete(PilotRequest).where(PilotRequest.pilot.is_(True), PilotRequest.status.in_(service.TERMINAL), PilotRequest.updated_at < service.now() - timedelta(days=30)))
        await db.execute(delete(PilotInbox).where(PilotInbox.created_at < service.now() - timedelta(days=30)))
        await db.commit()
        rows = (await db.execute(select(PilotOutbox).where(PilotOutbox.sent_at.is_(None), PilotOutbox.next_at <= service.now()).order_by(PilotOutbox.next_at).limit(20).with_for_update(skip_locked=True))).scalars().all()
        async with httpx.AsyncClient(timeout=10) as client:
            for row in rows:
                inbox = await db.get(PilotInbox, row.inbox_id)
                tokens = (await db.execute(select(PilotPushToken).where(PilotPushToken.user_id == inbox.user_id))).scalars().all()
                if not tokens:
                    row.next_at = service.now() + timedelta(seconds=30)
                    continue
                body = [{'to': token.token, 'title': inbox.payload.get('title', 'EvacuAid Buddy'), 'body': inbox.payload.get('body', 'Ada pembaruan Buddy. Buka aplikasi untuk melihat.'), 'sound': 'default', 'data': {**inbox.payload, 'inboxId': str(inbox.id)}} for token in tokens]
                if 'interruptionLevel' in inbox.payload:
                    for message in body:
                        message.update(interruptionLevel=inbox.payload['interruptionLevel'], priority='high')
                row.attempts += 1
                try:
                    result = await client.post('https://exp.host/--/api/v2/push/send', json=body)
                    result.raise_for_status()
                    tickets = result.json()['data']
                    if not isinstance(tickets, list) or len(tickets) != len(tokens):
                        raise ValueError('invalid Expo push response')
                    if any(not isinstance(ticket, dict) or ticket.get('status') not in ('ok', 'error') or (ticket['status'] == 'ok' and not isinstance(ticket.get('id'), str)) for ticket in tickets):
                        raise ValueError('invalid Expo push ticket')
                    row.tickets = [{**ticket, 'token': token.token, 'receiptChecked': ticket.get('status') != 'ok'} for token, ticket in zip(tokens, tickets)]
                    retry = False
                    for token, ticket in zip(tokens, tickets):
                        if ticket.get('status') == 'error':
                            if ticket.get('details', {}).get('error') == 'DeviceNotRegistered':
                                await db.delete(token)
                            else:
                                retry = True
                    if not retry:
                        row.sent_at = service.now()
                except (httpx.HTTPError, ValueError, KeyError):
                    pass
                row.next_at = service.now() + timedelta(seconds=min(300, 2 ** min(row.attempts, 8)))
        await db.commit()
        receipt_rows = (await db.execute(select(PilotOutbox).where(PilotOutbox.sent_at.is_not(None), PilotOutbox.tickets.contains([{'receiptChecked': False}]), PilotOutbox.sent_at < service.now() - timedelta(seconds=15)).limit(100).with_for_update(skip_locked=True))).scalars().all()
        pending = [(row, ticket) for row in receipt_rows for ticket in row.tickets if ticket.get('id') and not ticket.get('receiptChecked')]
        if pending:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    result = await client.post('https://exp.host/--/api/v2/push/getReceipts', json={'ids': [ticket['id'] for row, ticket in pending]})
                    result.raise_for_status()
                    receipts = result.json()['data']
                    if not isinstance(receipts, dict):
                        raise ValueError('invalid Expo receipt response')
                for row, ticket in pending:
                    receipt = receipts.get(ticket['id'])
                    if not receipt:
                        continue
                    if receipt.get('details', {}).get('error') == 'DeviceNotRegistered':
                        await db.execute(delete(PilotPushToken).where(PilotPushToken.token == ticket['token']))
                    row.tickets = [{**item, 'receiptChecked': True, 'receipt': receipt} if item.get('id') == ticket['id'] else item for item in row.tickets]
            except (httpx.HTTPError, KeyError, ValueError):
                pass
        await db.commit()


async def run():
    while True:
        try:
            await tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            logging.exception('Buddy worker tick failed')
        await asyncio.sleep(1)


if __name__ == '__main__':
    asyncio.run(run())
