from alembic import op

revision = '20261002_05'
down_revision = '20260924_04'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('''
        CREATE TABLE hazard_evidence (
            id uuid PRIMARY KEY,
            source_id varchar(256) NOT NULL,
            hazard_type varchar(32) NOT NULL CHECK (hazard_type IN ('FLOOD','EARTHQUAKE','TSUNAMI','WILDFIRE','LANDSLIDE','EXTREME_WEATHER')),
            source varchar(64) NOT NULL,
            authority varchar(32) NOT NULL CHECK (authority IN ('OFFICIAL','SATELLITE_OBSERVATION','COMMUNITY')),
            evidence_type varchar(32) NOT NULL CHECK (evidence_type IN ('BASELINE_HAZARD','ACTIVE_WARNING','OBSERVATION','CONFIRMED_CLOSURE','CRITICAL_HAZARD')),
            geometry geometry(Geometry,4326) NOT NULL CHECK (ST_IsValid(geometry) AND NOT ST_IsEmpty(geometry)),
            severity double precision CHECK (severity BETWEEN 0 AND 1),
            confidence double precision CHECK (confidence BETWEEN 0 AND 1),
            observed_at timestamptz,
            valid_from timestamptz,
            valid_until timestamptz,
            metadata jsonb NOT NULL DEFAULT '{}',
            CONSTRAINT uq_hazard_source_id UNIQUE (source, source_id),
            CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until),
            CHECK (evidence_type NOT IN ('CRITICAL_HAZARD','CONFIRMED_CLOSURE','ACTIVE_WARNING') OR (authority = 'OFFICIAL' AND valid_until IS NOT NULL)),
            CHECK (authority = 'OFFICIAL' OR ST_GeometryType(geometry) = 'ST_Point')
        )
    ''')
    op.execute('CREATE INDEX ix_hazard_geometry ON hazard_evidence USING gist (geometry)')
    op.execute('CREATE INDEX ix_hazard_geography ON hazard_evidence USING gist ((geometry::geography))')
    op.execute('CREATE INDEX ix_hazard_temporal ON hazard_evidence (valid_until, valid_from)')
    op.execute('CREATE INDEX ix_hazard_type_source ON hazard_evidence (hazard_type, source)')


def downgrade() -> None:
    op.execute('DROP TABLE hazard_evidence')
