"""Add credentials and role to existing identities, plus refresh and rate records."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '20261010_14_auth'
down_revision = '20261010_12'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('email', sa.String(254), nullable=True))
    op.add_column('users', sa.Column('password_hash', sa.String(512), nullable=True))
    op.add_column('users', sa.Column('role', sa.String(16), server_default='CITIZEN', nullable=False))
    op.create_unique_constraint('uq_users_email', 'users', ['email'])
    op.create_check_constraint('ck_users_role', 'users', "role IN ('CITIZEN','RESPONDER','GOVERNMENT','ADMIN')")
    op.create_check_constraint('ck_users_credentials_pair', 'users', '(email IS NULL) = (password_hash IS NULL)')
    op.create_check_constraint('ck_users_email_normalized', 'users', 'email IS NULL OR email = lower(trim(email))')
    op.add_column('guest_sessions', sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE guest_sessions SET expires_at = created_at + interval '1 day'")
    op.alter_column('guest_sessions', 'expires_at', nullable=False)
    op.create_table('auth_refresh_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('family_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    for column in ['user_id','family_id','expires_at']:
        op.create_index('ix_auth_refresh_tokens_'+column, 'auth_refresh_tokens', [column])
    op.create_table('auth_rate_limits', sa.Column('key', sa.String(128), primary_key=True),
        sa.Column('attempts', sa.Integer(), nullable=False), sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint('attempts > 0', name='ck_auth_rate_attempts'))
    op.create_index('ix_auth_rate_limits_expires_at', 'auth_rate_limits', ['expires_at'])


def downgrade():
    op.drop_table('auth_rate_limits')
    op.drop_table('auth_refresh_tokens')
    op.drop_column('guest_sessions','expires_at')
    for name in ['ck_users_email_normalized','ck_users_credentials_pair','ck_users_role']:
        op.drop_constraint(name,'users',type_='check')
    op.drop_constraint('uq_users_email','users',type_='unique')
    for column in ['role','password_hash','email']:
        op.drop_column('users',column)
