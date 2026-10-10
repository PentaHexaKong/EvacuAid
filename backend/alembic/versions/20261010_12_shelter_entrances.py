from alembic import op
import sqlalchemy as sa

revision = '20261010_12'
down_revision = '20261009_10'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('shelters', sa.Column('entrance_latitude', sa.Float(), nullable=True))
    op.add_column('shelters', sa.Column('entrance_longitude', sa.Float(), nullable=True))
    op.add_column('shelters', sa.Column('entrance_note', sa.String(200), nullable=True))
    op.create_check_constraint('ck_shelter_entrance_latitude', 'shelters', 'entrance_latitude BETWEEN -90 AND 90')
    op.create_check_constraint('ck_shelter_entrance_longitude', 'shelters', 'entrance_longitude BETWEEN -180 AND 180')
    op.create_check_constraint('ck_shelter_entrance_pair', 'shelters', '(entrance_latitude IS NULL) = (entrance_longitude IS NULL)')


def downgrade() -> None:
    op.drop_constraint('ck_shelter_entrance_pair', 'shelters', type_='check')
    op.drop_constraint('ck_shelter_entrance_longitude', 'shelters', type_='check')
    op.drop_constraint('ck_shelter_entrance_latitude', 'shelters', type_='check')
    op.drop_column('shelters', 'entrance_note')
    op.drop_column('shelters', 'entrance_longitude')
    op.drop_column('shelters', 'entrance_latitude')
