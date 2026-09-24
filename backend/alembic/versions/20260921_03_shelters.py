from alembic import op

revision = '20260921_03'
down_revision = '20260921_02'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('''
        CREATE TABLE shelters (
            id uuid PRIMARY KEY,
            name varchar(200) NOT NULL,
            latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
            longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
            location geography(POINT, 4326) NOT NULL,
            address varchar(500),
            shelter_type varchar(64) NOT NULL,
            status varchar(16) NOT NULL CHECK (status IN ('OPEN', 'FULL', 'CLOSED', 'UNKNOWN')),
            capacity integer CHECK (capacity IS NULL OR capacity >= 0),
            current_occupancy integer CHECK (current_occupancy IS NULL OR current_occupancy >= 0),
            wheelchair_accessible boolean,
            medical_support boolean,
            source varchar(128) NOT NULL,
            source_reference varchar(500),
            verified_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    ''')
    op.execute('CREATE INDEX ix_shelters_location ON shelters USING gist (location)')
    op.execute('CREATE INDEX ix_shelters_status ON shelters (status)')


def downgrade() -> None:
    op.execute('DROP TABLE shelters')
