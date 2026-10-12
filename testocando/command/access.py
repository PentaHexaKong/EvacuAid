import hmac
import os

from fastapi import Header, HTTPException


def requireCommandKey(commandKey: str | None = Header(default=None,alias='X-Command-Key')):
    expectedKey = os.getenv('COMMAND_API_KEY')
    if not expectedKey:
        raise HTTPException(503,'Command API is not configured')
    if commandKey is None or not hmac.compare_digest(commandKey.encode('utf-8'),expectedKey.encode('utf-8')):
        raise HTTPException(401,'Command API key required')
