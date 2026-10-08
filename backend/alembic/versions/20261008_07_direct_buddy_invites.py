from alembic import op
import sqlalchemy as sa

revision = '20261008_07'
down_revision = '20261005_06'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('users', sa.Column('buddy_code', sa.String(9), nullable=True))
    op.create_unique_constraint('uq_users_buddy_code', 'users', ['buddy_code'])
    op.add_column('pilot_invitations', sa.Column('direction', sa.String(16), nullable=False, server_default='SEEK_HELP'))
    op.add_column('pilot_invitations', sa.Column('relation', sa.String(16), nullable=True))
    op.alter_column('pilot_invitations', 'code_hash', existing_type=sa.String(64), nullable=True)
    op.add_column('buddy_relationships', sa.Column('relation', sa.String(16), nullable=True))
    op.create_index('ix_pilot_invitations_owner_id', 'pilot_invitations', ['owner_id'])
    op.create_index('ix_pilot_invitations_redeemer_id', 'pilot_invitations', ['redeemer_id'])
    op.drop_column('pilot_availability', 'enrolled')


def downgrade() -> None:
    op.add_column('pilot_availability', sa.Column('enrolled', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.drop_index('ix_pilot_invitations_redeemer_id', 'pilot_invitations')
    op.drop_index('ix_pilot_invitations_owner_id', 'pilot_invitations')
    op.drop_column('buddy_relationships', 'relation')
    op.execute('DELETE FROM pilot_invitations WHERE code_hash IS NULL')
    op.alter_column('pilot_invitations', 'code_hash', existing_type=sa.String(64), nullable=False)
    op.drop_column('pilot_invitations', 'relation')
    op.drop_column('pilot_invitations', 'direction')
    op.drop_constraint('uq_users_buddy_code', 'users', type_='unique')
    op.drop_column('users', 'buddy_code')
