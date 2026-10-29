from alembic import op
import sqlalchemy as sa

revision = '20261029_19_offer_distance'
down_revision = '20261013_17_buddy_beacons'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('pilot_attempts', sa.Column('approx_distance_m', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('pilot_attempts', 'approx_distance_m')
