from alembic import op

revision = '20261005_07_command'
down_revision = '20261005_06'
branch_labels = None
depends_on = None


def upgrade():
    op.execute('''CREATE TABLE command_regions (
      id uuid PRIMARY KEY, code varchar(64) NOT NULL UNIQUE, name varchar(200) NOT NULL,
      administrative_level varchar(24) NOT NULL,
      parent_id uuid REFERENCES command_regions(id) ON DELETE RESTRICT,
      geometry geometry(MULTIPOLYGON,4326) NOT NULL, centroid geometry(POINT,4326) NOT NULL,
      population integer, population_reference_year integer, population_source varchar(256),
      boundary_source varchar(256) NOT NULL, data_mode varchar(16) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_command_region_level CHECK (administrative_level IN ('PROVINCE','CITY_REGENCY','DISTRICT','VILLAGE')),
      CONSTRAINT ck_command_region_mode CHECK (data_mode IN ('REFERENCE','SIMULATION')),
      CONSTRAINT ck_command_population_provenance CHECK (population IS NULL OR
        (population >= 0 AND population_reference_year IS NOT NULL AND population_reference_year BETWEEN 1900 AND 2200
         AND population_source IS NOT NULL AND length(trim(population_source)) > 0)),
      CONSTRAINT ck_command_region_not_self CHECK (parent_id IS NULL OR parent_id <> id)
    )''')
    op.execute('CREATE INDEX ix_command_region_parent ON command_regions(parent_id)')
    op.execute('CREATE INDEX ix_command_region_geometry ON command_regions USING gist(geometry)')
    op.execute('''CREATE TABLE command_snapshots (
      region_id uuid PRIMARY KEY REFERENCES command_regions(id) ON DELETE CASCADE,
      payload jsonb NOT NULL, updated_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
    )''')
    op.execute('''CREATE FUNCTION command_validate_region_hierarchy() RETURNS trigger AS $$
    DECLARE p_level text; p_mode text; p_geom geometry;
    BEGIN
      IF NEW.administrative_level = 'PROVINCE' THEN
        IF NEW.parent_id IS NOT NULL THEN RAISE EXCEPTION 'province cannot have parent'; END IF;
      ELSE
        SELECT administrative_level, data_mode, geometry INTO p_level, p_mode, p_geom
          FROM command_regions WHERE id = NEW.parent_id;
        IF p_level IS DISTINCT FROM (CASE NEW.administrative_level
          WHEN 'CITY_REGENCY' THEN 'PROVINCE' WHEN 'DISTRICT' THEN 'CITY_REGENCY' WHEN 'VILLAGE' THEN 'DISTRICT' END)
          OR p_mode IS DISTINCT FROM NEW.data_mode THEN RAISE EXCEPTION 'invalid region hierarchy or data mode'; END IF;
        IF NOT ST_Covers(p_geom, NEW.geometry) THEN RAISE EXCEPTION 'child boundary outside parent'; END IF;
      END IF;
      IF NOT ST_IsValid(NEW.geometry) OR ST_IsEmpty(NEW.geometry)
        OR ST_Area(NEW.geometry::geography) <= 0
        OR NOT ST_Covers(ST_MakeEnvelope(-180,-90,180,90,4326), NEW.geometry)
        THEN RAISE EXCEPTION 'invalid region boundary'; END IF;
      IF TG_OP = 'UPDATE' AND (NEW.administrative_level <> OLD.administrative_level OR NEW.data_mode <> OLD.data_mode)
        AND EXISTS(SELECT 1 FROM command_regions WHERE parent_id = NEW.id)
        THEN RAISE EXCEPTION 'cannot change parent level or mode with children'; END IF;
      IF EXISTS(SELECT 1 FROM command_regions WHERE parent_id = NEW.id AND NOT ST_Covers(NEW.geometry, geometry))
        THEN RAISE EXCEPTION 'updated boundary excludes child'; END IF;
      NEW.centroid := ST_PointOnSurface(NEW.geometry);
      RETURN NEW;
    END; $$ LANGUAGE plpgsql''')
    op.execute('CREATE TRIGGER command_region_hierarchy BEFORE INSERT OR UPDATE ON command_regions FOR EACH ROW EXECUTE FUNCTION command_validate_region_hierarchy()')


def downgrade():
    op.execute('DROP TABLE command_snapshots')
    op.execute('DROP TABLE command_regions')
    op.execute('DROP FUNCTION command_validate_region_hierarchy()')
