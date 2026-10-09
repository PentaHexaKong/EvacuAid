from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20261009_10'
down_revision = '20261008_08'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('alert_responses',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('alert_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('hazard_evidence.id', ondelete='CASCADE'), nullable=False),
        sa.Column('response', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("response IN ('SAFE', 'EVACUATING', 'NEEDS_HELP')", name='ck_alert_response_value'),
        sa.UniqueConstraint('user_id', 'alert_id', name='uq_alert_response_user_alert'))
    op.create_table('alert_deliveries',
        sa.Column('alert_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('hazard_evidence.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))


def downgrade() -> None:
    op.drop_table('alert_deliveries')
    op.drop_table('alert_responses')
