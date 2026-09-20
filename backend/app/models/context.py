from enum import Enum

from pydantic import BaseModel

from app.models.risk import ActionData, EventData, ExposureData, NavigationData, QualityData, WeatherData


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


class ContextNavigationData(NavigationData):
    route_status: NavigationStatus = NavigationStatus.NOT_REQUIRED


class ContextResponse(BaseModel):
    event: EventData
    exposure: ExposureData
    weather: WeatherData | None
    action: ActionData
    assistance: ContextAssistanceData
    navigation: ContextNavigationData
    quality: QualityData
