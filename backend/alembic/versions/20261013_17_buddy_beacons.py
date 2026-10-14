from alembic import op
import sqlalchemy as sa

revision = '20261013_17_buddy_beacons'
down_revision = '20261012_16_operations'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('beacon_id', sa.BigInteger(), nullable=True))
    op.create_unique_constraint('uq_users_beacon_id', 'users', ['beacon_id'])
    op.create_check_constraint('ck_users_beacon_id', 'users', 'beacon_id BETWEEN 1 AND 4294967295')
    op.add_column('pilot_attempts', sa.Column('source', sa.String(3), server_default='GPS', nullable=False))
    op.create_check_constraint('ck_pilot_attempt_source', 'pilot_attempts', "source IN ('GPS','BLE')")
    op.add_column('assistance_requests', sa.Column('nearby_started_at', sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE assistance_requests SET nearby_started_at = requested_at WHERE nearby = true")
    op.drop_index('uq_pilot_pending_attempt', 'pilot_attempts')
    op.create_index('uq_pilot_pending_attempt', 'pilot_attempts', ['request_id', 'helper_id'], unique=True, postgresql_where=sa.text("status = 'PENDING'"))


def downgrade():
    op.drop_index('uq_pilot_pending_attempt', 'pilot_attempts')
    op.execute("""UPDATE pilot_attempts SET status = 'CANCELLED' WHERE id IN (
        SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY request_id ORDER BY created_at, id) AS position
        FROM pilot_attempts WHERE status = 'PENDING') AS pending WHERE position > 1)""")
    op.create_index('uq_pilot_pending_attempt', 'pilot_attempts', ['request_id'], unique=True, postgresql_where=sa.text("status = 'PENDING'"))
    op.drop_column('assistance_requests', 'nearby_started_at')
    op.drop_constraint('ck_pilot_attempt_source', 'pilot_attempts', type_='check')
    op.drop_column('pilot_attempts', 'source')
    op.drop_constraint('ck_users_beacon_id', 'users', type_='check')
    op.drop_constraint('uq_users_beacon_id', 'users', type_='unique')
    op.drop_column('users', 'beacon_id')
