import pytest
from datetime import datetime, timezone
from pydantic import ValidationError

from app.models.user import AccessibilityItem, AccessibilityUpdate, LocationUpdate, PreferencesUpdate, UserCreate, UserUpdate
from app.services import user_service


@pytest.mark.asyncio
async def testUserProfilePersistsMultipleAttributes(dbSession):
    user = await user_service.create_user(dbSession, UserCreate(name='Ayu', needs_assistance=True))
    attributes = await user_service.update_accessibility(
        dbSession,
        user.id,
        AccessibilityUpdate(items=[
            AccessibilityItem(type='VISUAL_IMPAIRMENT'),
            AccessibilityItem(type='MOBILITY_LIMITATION', severity='HIGH'),
        ]),
    )
    reloaded = await user_service.require_user(dbSession, user.id, include_relations=True)
    assert {attribute.type for attribute in attributes} == {'VISUAL_IMPAIRMENT', 'MOBILITY_LIMITATION'}
    assert {attribute.type for attribute in reloaded.accessibility} == {'VISUAL_IMPAIRMENT', 'MOBILITY_LIMITATION'}


@pytest.mark.asyncio
async def testUserUpdateLocationAndPreferencesPersist(dbSession):
    user = await user_service.create_user(dbSession, UserCreate(name='Bima'))
    updated = await user_service.update_user(dbSession, user.id, UserUpdate(phone='08123'))
    located = await user_service.update_location(dbSession, user.id, LocationUpdate(latitude=-6.2, longitude=106.8, observed_at=datetime.now(timezone.utc)))
    preferences = await user_service.update_preferences(dbSession, user.id, PreferencesUpdate(voice_enabled=False, language='en'))
    assert updated.phone == '08123'
    assert (located.latitude, located.longitude) == (-6.2, 106.8)
    assert preferences.voice_enabled is False
    assert preferences.language == 'en'


def testLocationValidationRejectsInvalidCoordinates():
    with pytest.raises(ValidationError):
        LocationUpdate(latitude=91, longitude=106.8, observed_at=datetime.now(timezone.utc))
