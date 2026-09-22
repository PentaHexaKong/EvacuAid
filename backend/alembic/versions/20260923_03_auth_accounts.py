from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '20260923_03'
down_revision = '20260921_02'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('user_preferences', sa.Column('larger_text', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('user_preferences', sa.Column('stronger_contrast', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('user_preferences', sa.Column('onboarding_completed', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        'auth_accounts',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=True),
        sa.Column('google_subject', sa.String(length=255), nullable=True),
        sa.Column('google_email_verified', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.CheckConstraint('password_hash IS NOT NULL OR google_subject IS NOT NULL', name='ck_auth_accounts_has_identity'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email', name='uq_auth_accounts_email'),
        sa.UniqueConstraint('google_subject', name='uq_auth_accounts_google_subject'),
        sa.UniqueConstraint('user_id', name='uq_auth_accounts_user_id'),
    )
    op.create_index('ix_auth_accounts_user_id', 'auth_accounts', ['user_id'])
    op.create_index('ix_auth_accounts_email', 'auth_accounts', ['email'])
    op.create_table(
        'auth_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('account_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('refresh_token_hash', sa.String(length=64), nullable=False),
        sa.Column('remember_me', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['account_id'], ['auth_accounts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('refresh_token_hash', name='uq_auth_sessions_refresh_token_hash'),
    )
    op.create_index('ix_auth_sessions_account_id', 'auth_sessions', ['account_id'])
    op.create_index('ix_auth_sessions_refresh_token_hash', 'auth_sessions', ['refresh_token_hash'])
    op.create_table(
        'password_reset_tokens',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('account_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['account_id'], ['auth_accounts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('token_hash', name='uq_password_reset_tokens_token_hash'),
    )
    op.create_index('ix_password_reset_tokens_account_id', 'password_reset_tokens', ['account_id'])
    op.create_index('ix_password_reset_tokens_token_hash', 'password_reset_tokens', ['token_hash'])


def downgrade() -> None:
    op.drop_table('password_reset_tokens')
    op.drop_table('auth_sessions')
    op.drop_table('auth_accounts')
    op.drop_column('user_preferences', 'onboarding_completed')
    op.drop_column('user_preferences', 'stronger_contrast')
    op.drop_column('user_preferences', 'larger_text')
