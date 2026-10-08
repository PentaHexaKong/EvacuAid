from alembic import op

revision = '20261005_08_precision'
down_revision = '20261005_07_command'
branch_labels = None
depends_on = None


def definition(tolerant):
    covers = '(ST_Covers(p_geom, NEW.geometry) OR ST_Covers(ST_Buffer(p_geom, 1e-9), NEW.geometry))' if tolerant else 'ST_Covers(p_geom, NEW.geometry)'
    children = '(ST_Covers(NEW.geometry, geometry) OR ST_Covers(ST_Buffer(NEW.geometry, 1e-9), geometry))' if tolerant else 'ST_Covers(NEW.geometry, geometry)'
    return f'''CREATE OR REPLACE FUNCTION command_validate_region_hierarchy() RETURNS trigger AS $$
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
        IF NOT {covers} THEN RAISE EXCEPTION 'child boundary outside parent'; END IF;
      END IF;
      IF NOT ST_IsValid(NEW.geometry) OR ST_IsEmpty(NEW.geometry)
        OR ST_Area(NEW.geometry::geography) <= 0
        OR NOT ST_Covers(ST_MakeEnvelope(-180,-90,180,90,4326), NEW.geometry)
        THEN RAISE EXCEPTION 'invalid region boundary'; END IF;
      IF TG_OP = 'UPDATE' AND (NEW.administrative_level <> OLD.administrative_level OR NEW.data_mode <> OLD.data_mode)
        AND EXISTS(SELECT 1 FROM command_regions WHERE parent_id = NEW.id)
        THEN RAISE EXCEPTION 'cannot change parent level or mode with children'; END IF;
      IF EXISTS(SELECT 1 FROM command_regions WHERE parent_id = NEW.id AND NOT {children})
        THEN RAISE EXCEPTION 'updated boundary excludes child'; END IF;
      NEW.centroid := ST_PointOnSurface(NEW.geometry);
      RETURN NEW;
    END; $$ LANGUAGE plpgsql'''


def upgrade():
    # 1e-9 degrees is at most about 0.12 mm. Dissolving/reprojecting real
    # boundaries creates microscopic floating-point slivers; stored shapes
    # remain untouched and substantive out-of-parent boundaries still fail.
    op.execute(definition(True))


def downgrade():
    op.execute(definition(False))
