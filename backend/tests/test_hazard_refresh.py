from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import hazardIngestionService as ingestion


@pytest.mark.asyncio
@pytest.mark.parametrize('key,lastStatus,fetchFails,expected', [
    ('SYNTHETIC_TEST_KEY', 'unconfigured', False, 'available'),
    ('SYNTHETIC_TEST_KEY', 'unconfigured', True, 'degraded'),
    ('', 'unconfigured', False, 'unconfigured'),
    ('SYNTHETIC_TEST_KEY', 'available', False, 'available'),
    ('SYNTHETIC_TEST_KEY', 'degraded', False, 'degraded'),
])
async def testFirmsConfigurationRecoveryBypassesOnlyUnconfiguredCooldown(monkeypatch, key, lastStatus, fetchFails, expected):
    last = {'status': lastStatus, 'error': 'ValueError', 'nextAttemptAt': (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()}
    monkeypatch.setattr(ingestion.config, 'FIRMS_MAP_KEY', key)
    monkeypatch.setattr(ingestion.externalDataRepository, 'getSnapshot', AsyncMock(return_value=SimpleNamespace(payload=last)))
    save = AsyncMock()
    monkeypatch.setattr(ingestion.externalDataRepository, 'saveSnapshot', save)
    monkeypatch.setattr(ingestion.hazardRepository, 'replaceSource', AsyncMock())
    session = SimpleNamespace(rollback=AsyncMock(), commit=AsyncMock())
    fetcher = AsyncMock(side_effect=ValueError('SYNTHETIC_TEST_FAILURE')) if fetchFails else AsyncMock(return_value=[])
    result = await ingestion.refreshSource(session, 'FIRMS', fetcher=fetcher)
    assert result['status'] == expected
    if key and lastStatus == 'unconfigured':
        fetcher.assert_awaited_once()
        save.assert_awaited_once()
        session.commit.assert_awaited_once()
        assert result['error'] == ('ValueError' if fetchFails else None)
        if not fetchFails:
            assert result['evidenceCount'] == 0
            assert result['lastSuccessAt']
    else:
        fetcher.assert_not_awaited()
        save.assert_not_awaited()
        assert result == last
