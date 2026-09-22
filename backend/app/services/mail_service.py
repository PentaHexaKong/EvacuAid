from __future__ import annotations

import asyncio
import smtplib
from email.message import EmailMessage
from urllib.parse import urlencode

from app.config import PASSWORD_RESET_URL_BASE, SMTP_FROM, SMTP_HOST, SMTP_PASSWORD, SMTP_PORT, SMTP_STARTTLS, SMTP_USERNAME


def configured() -> bool:
    return bool(SMTP_HOST and SMTP_FROM)


def _send(recipient: str, token: str) -> None:
    separator = '&' if '?' in PASSWORD_RESET_URL_BASE else '?'
    reset_url = f'{PASSWORD_RESET_URL_BASE}{separator}{urlencode({"token": token})}'
    message = EmailMessage()
    message['Subject'] = 'Reset password EvacuAid'
    message['From'] = SMTP_FROM
    message['To'] = recipient
    message.set_content(f'Buka tautan ini untuk membuat password baru: {reset_url}')
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as smtp:
        if SMTP_STARTTLS:
            smtp.starttls()
        if SMTP_USERNAME:
            smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
        smtp.send_message(message)


async def send_password_reset_email(recipient: str, token: str) -> None:
    await asyncio.to_thread(_send, recipient, token)
