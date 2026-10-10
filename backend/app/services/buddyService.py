from app.db.models import BuddyRelationship
from app.models.buddy import BuddyRelationshipResponse


def relationshipResponse(relationship: BuddyRelationship) -> BuddyRelationshipResponse:
    return BuddyRelationshipResponse(id=relationship.id, userId=relationship.userId, buddyUserId=relationship.buddyUserId, level=relationship.level, status=relationship.status, createdAt=relationship.createdAt, updatedAt=relationship.updatedAt, acceptedAt=relationship.acceptedAt)
