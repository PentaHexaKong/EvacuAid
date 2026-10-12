from alembic import op

revision = '20261012_16_operations'
down_revision = '20261010_14_auth'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE field_reports (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payload jsonb NOT NULL, status varchar(24) NOT NULL,
      review jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_field_report_status CHECK (status IN ('UNVERIFIED','CONFIRMED','REJECTED','RESOLVED')))
    """)
    op.execute('CREATE INDEX ix_field_reports_user_id ON field_reports(user_id)')
    op.execute("""CREATE TABLE evacuation_check_ins (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now())""")
    op.execute('CREATE INDEX ix_evacuation_check_ins_user_id ON evacuation_check_ins(user_id)')
    op.execute("""CREATE TABLE operational_routes (
      id uuid PRIMARY KEY, payload jsonb NOT NULL, result jsonb NOT NULL,
      status varchar(16) NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_operational_route_status CHECK(status IN ('DRAFT','PUBLISHED','WITHDRAWN')))""")
    op.execute("""CREATE TABLE government_cases (
      request_id uuid PRIMARY KEY REFERENCES assistance_requests(id) ON DELETE CASCADE,
      payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())""")


def downgrade():
    for table in ('government_cases','operational_routes','evacuation_check_ins','field_reports'):
        op.drop_table(table)
