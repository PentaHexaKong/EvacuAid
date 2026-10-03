from alembic import op

revision = '20260924_04'
down_revision = '20260921_03'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('''
        CREATE TABLE external_data_snapshots (
            id uuid PRIMARY KEY,
            source varchar(64) NOT NULL,
            scope varchar(128) NOT NULL,
            payload jsonb NOT NULL,
            fetched_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_external_data_snapshot_source_scope UNIQUE (source, scope)
        )
    ''')
    op.execute('CREATE INDEX ix_external_data_snapshots_source_scope ON external_data_snapshots (source, scope)')


def downgrade() -> None:
    op.execute('DROP TABLE external_data_snapshots')
