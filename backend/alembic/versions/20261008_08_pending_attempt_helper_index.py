from alembic import op
import sqlalchemy as sa

revision = '20261008_08'
down_revision = '20261008_07'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index('ix_pilot_pending_attempt_helper', 'pilot_attempts', ['helper_id'], postgresql_where=sa.text("status = 'PENDING'"))


def downgrade() -> None:
    op.drop_index('ix_pilot_pending_attempt_helper', 'pilot_attempts')
