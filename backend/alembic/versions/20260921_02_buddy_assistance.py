from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20260921_02'
down_revision = '20260920_01'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('ALTER TABLE users ADD COLUMN location geography(POINT, 4326)')
    op.execute("UPDATE users SET location = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography WHERE latitude IS NOT NULL AND longitude IS NOT NULL")
    op.create_index('ix_users_location', 'users', ['location'], postgresql_using='gist')
    op.create_table(
        'buddy_relationships',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('buddy_user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('level', sa.String(length=16), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("level IN ('PRIMARY', 'SECONDARY', 'COMMUNITY')", name='ck_buddy_level'),
        sa.CheckConstraint("status IN ('PENDING', 'ACTIVE', 'REJECTED', 'REVOKED')", name='ck_buddy_status'),
        sa.CheckConstraint('user_id <> buddy_user_id', name='ck_buddy_relationship_not_self'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['buddy_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_buddy_relationship_user_status', 'buddy_relationships', ['user_id', 'status'])
    op.create_index('ix_buddy_relationship_buddy_status', 'buddy_relationships', ['buddy_user_id', 'status'])
    op.execute("CREATE UNIQUE INDEX uq_buddy_pending_active ON buddy_relationships (user_id, buddy_user_id) WHERE status IN ('PENDING', 'ACTIVE')")
    op.create_table(
        'assistance_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('buddy_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('event_id', sa.String(length=128), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('notified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('en_route_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('arrived_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('evacuating_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('safe_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expired_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.CheckConstraint("status IN ('REQUESTED', 'NOTIFIED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING', 'SAFE', 'DECLINED', 'CANCELLED', 'EXPIRED')", name='ck_assistance_status'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['buddy_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_assistance_user_status', 'assistance_requests', ['user_id', 'status'])
    op.create_index('ix_assistance_buddy_status', 'assistance_requests', ['buddy_user_id', 'status'])
    op.execute("CREATE UNIQUE INDEX uq_active_assistance_user ON assistance_requests (user_id) WHERE status IN ('REQUESTED', 'NOTIFIED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING')")
    op.execute("CREATE UNIQUE INDEX uq_active_assistance_buddy ON assistance_requests (buddy_user_id) WHERE buddy_user_id IS NOT NULL AND status IN ('REQUESTED', 'NOTIFIED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'EVACUATING')")


def downgrade() -> None:
    op.drop_table('assistance_requests')
    op.drop_table('buddy_relationships')
    op.drop_index('ix_users_location', table_name='users')
    op.drop_column('users', 'location')
