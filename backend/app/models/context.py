from enum import Enum

from pydantic import BaseModel

from app.models.risk import ActionData, EventData, ExposureData, QualityData, WeatherData
from app.models.assistance import ContextBuddy
from app.models.navigation import NavigationResponse


class AssistanceStatus(str, Enum):
    NOT_REQUESTED = 'NOT_REQUESTED'
    REQUESTED = 'REQUESTED'
    NOTIFIED = 'NOTIFIED'
    ACCEPTED = 'ACCEPTED'
    EN_ROUTE = 'EN_ROUTE'
    ARRIVED = 'ARRIVED'
    EVACUATING = 'EVACUATING'
    SAFE = 'SAFE'
    DECLINED = 'DECLINED'
    CANCELLED = 'CANCELLED'
    EXPIRED = 'EXPIRED'


class NavigationStatus(str, Enum):
    NOT_REQUIRED = 'NOT_REQUIRED'
    PENDING = 'PENDING'
    READY = 'READY'
    UNAVAILABLE = 'UNAVAILABLE'


class ContextAssistanceData(BaseModel):
    required: bool
    status: AssistanceStatus = AssistanceStatus.NOT_REQUESTED
    requestId: str | None = None
    buddy: ContextBuddy | None = None


class ContextResponse(BaseModel):
    event: EventData
    exposure: ExposureData
    weather: WeatherData | None
    action: ActionData
    assistance: ContextAssistanceData
    navigation: NavigationResponse
    quality: QualityData
