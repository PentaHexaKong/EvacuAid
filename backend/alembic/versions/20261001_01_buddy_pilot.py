from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '20261001_01'
down_revision = '20260923_03'
branch_labels = None
depends_on = None





def upgrade():
    op.alter_column('assistance_requests', 'status', existing_type=sa.String(16), type_=sa.String(24), nullable=False)
    for name, kind, default, nullable in [('pilot', sa.Boolean(), sa.false(), False), ('message', sa.Text(), '', False), ('support_needs', JSONB(), '[]', False), ('idempotency_key', sa.String(128), None, True), ('sharing_consent', sa.Boolean(), sa.false(), False), ('nearby', sa.Boolean(), sa.false(), False), ('latitude', sa.Float(), None, True), ('longitude', sa.Float(), None, True), ('candidates', JSONB(), '[]', False), ('meeting_confirmed', sa.Boolean(), sa.false(), False), ('requester_phone_shared', sa.Boolean(), sa.false(), False), ('helper_phone_shared', sa.Boolean(), sa.false(), False), ('requester_location_version', sa.Integer(), '0', False), ('helper_location_version', sa.Integer(), '0', False), ('selected_shelter_id', sa.UUID(), None, True)]:
        op.add_column('assistance_requests', sa.Column(name, kind, server_default=default, nullable=nullable))
    op.create_foreign_key('fk_assistance_selected_shelter', 'assistance_requests', 'shelters', ['selected_shelter_id'], ['id'], ondelete='SET NULL')
    op.create_unique_constraint('uq_assistance_idempotency', 'assistance_requests', ['idempotency_key'])
    op.drop_constraint('ck_assistance_status', 'assistance_requests')
    op.create_check_constraint('ck_assistance_status', 'assistance_requests', "status IN ('REQUESTED','NOTIFIED','ACCEPTED','EN_ROUTE','ARRIVED','EVACUATING','SAFE','DECLINED','CANCELLED','EXPIRED','WAITING','FALLBACK_REQUIRED','COMPLETION_PENDING','COMPLETED','INTERRUPTED','UNANSWERED')")
    for role, column in [('user', 'user_id'), ('buddy', 'buddy_user_id')]:
        op.execute(f'DROP INDEX uq_active_assistance_{role}')
        op.execute(f"CREATE UNIQUE INDEX uq_active_assistance_{role} ON assistance_requests ({column}) WHERE status IN ('REQUESTED','NOTIFIED','ACCEPTED','EN_ROUTE','ARRIVED','EVACUATING','WAITING','FALLBACK_REQUIRED','COMPLETION_PENDING')")
    op.create_table('pilot_invitations',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('owner_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('code_hash', sa.String(64), nullable=False, unique=True),
        sa.Column('redeemer_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=True),
        sa.Column('status', sa.String(24), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table('pilot_availability',
        sa.Column('user_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('enrolled', sa.Boolean(), nullable=False),
        sa.Column('opted_in', sa.Boolean(), nullable=False),
        sa.Column('latitude', sa.Float(), nullable=True),
        sa.Column('longitude', sa.Float(), nullable=True),
        sa.Column('observed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('accuracy_m', sa.Float(), nullable=True),
    )
    op.create_table('pilot_attempts',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('request_id', sa.UUID(), sa.ForeignKey('assistance_requests.id', ondelete='CASCADE'), nullable=False),
        sa.Column('helper_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(24), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table('pilot_inbox',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('user_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('request_id', sa.UUID(), sa.ForeignKey('assistance_requests.id', ondelete='CASCADE'), nullable=True),
        sa.Column('kind', sa.String(32), nullable=False),
        sa.Column('payload', JSONB(), nullable=False),
        sa.Column('read', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table('pilot_outbox',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('inbox_id', sa.UUID(), sa.ForeignKey('pilot_inbox.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('next_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('tickets', JSONB(), nullable=False),
    )
    op.create_table('pilot_push_tokens',
        sa.Column('token', sa.String(256), primary_key=True),
        sa.Column('user_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
    )
    op.create_table('pilot_locations',
        sa.Column('request_id', sa.UUID(), sa.ForeignKey('assistance_requests.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('user_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('latitude', sa.Float(), nullable=False),
        sa.Column('longitude', sa.Float(), nullable=False),
        sa.Column('accuracy_m', sa.Float(), nullable=False),
        sa.Column('observed_at', sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table('pilot_messages',
        sa.Column('id', sa.UUID(), primary_key=True),
        sa.Column('request_id', sa.UUID(), sa.ForeignKey('assistance_requests.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.UUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('uq_pilot_pending_attempt', 'pilot_attempts', ['request_id'], unique=True, postgresql_where=sa.text("status = 'PENDING'"))


def downgrade():
    op.drop_table('pilot_messages')
    op.drop_table('pilot_locations')
    op.drop_table('pilot_push_tokens')
    op.drop_table('pilot_outbox')
    op.drop_table('pilot_inbox')
    op.drop_table('pilot_attempts')
    op.drop_table('pilot_availability')
    op.drop_table('pilot_invitations')
    op.execute("UPDATE assistance_requests SET status='CANCELLED' WHERE pilot")
    op.drop_constraint('ck_assistance_status', 'assistance_requests')
    op.create_check_constraint('ck_assistance_status', 'assistance_requests', "status IN ('REQUESTED','NOTIFIED','ACCEPTED','EN_ROUTE','ARRIVED','EVACUATING','SAFE','DECLINED','CANCELLED','EXPIRED')")
    op.drop_constraint('fk_assistance_selected_shelter', 'assistance_requests')
    for role, column in [('user', 'user_id'), ('buddy', 'buddy_user_id')]:
        op.execute(f'DROP INDEX uq_active_assistance_{role}')
        op.execute(f"CREATE UNIQUE INDEX uq_active_assistance_{role} ON assistance_requests ({column}) WHERE status IN ('REQUESTED','NOTIFIED','ACCEPTED','EN_ROUTE','ARRIVED','EVACUATING')")
    op.alter_column('assistance_requests', 'status', existing_type=sa.String(24), type_=sa.String(16), nullable=False)
    op.drop_constraint('uq_assistance_idempotency', 'assistance_requests')
    for name in ['pilot','message','support_needs','idempotency_key','sharing_consent','nearby','latitude','longitude','candidates','meeting_confirmed','selected_shelter_id','requester_phone_shared','helper_phone_shared','requester_location_version','helper_location_version']:
        op.drop_column('assistance_requests', name)
