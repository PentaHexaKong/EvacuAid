from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '20260923_03'
down_revision = '20260921_02'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('UPDATE users SET name = left(name, 60) WHERE length(name) > 60')
    op.alter_column('users', 'name', existing_type=sa.String(length=200), type_=sa.String(length=60), nullable=True)
    op.add_column('users', sa.Column('location_observed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('location_accuracy_m', sa.Float(), nullable=True))
    op.add_column('users', sa.Column('share_location_with_buddies', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('user_preferences', sa.Column('larger_text', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('user_preferences', sa.Column('stronger_contrast', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        'guest_sessions',
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
        sa.UniqueConstraint('token_hash'),
    )

def downgrade() -> None:
    op.drop_table('guest_sessions')
    op.drop_column('user_preferences', 'stronger_contrast')
    op.drop_column('user_preferences', 'larger_text')
    op.drop_column('users', 'share_location_with_buddies')
    op.drop_column('users', 'location_accuracy_m')
    op.drop_column('users', 'location_observed_at')
    op.execute("UPDATE users SET name = 'Guest' WHERE name IS NULL")
    op.alter_column('users', 'name', existing_type=sa.String(length=60), type_=sa.String(length=200), nullable=False)
