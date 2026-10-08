from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
import pytest

BACKEND = Path(__file__).parents[1]
COMBINED = BACKEND.parent / 'testocando' / 'alembic.ini'


def test_single_migration_head():
    script = ScriptDirectory.from_config(Config(str(BACKEND / 'alembic.ini')))
    heads = script.get_heads()
    assert len(heads) == 1, f'multiple alembic heads: {heads}'


def test_combined_migration_graph_has_a_single_head():
    if not COMBINED.exists():
        pytest.skip('command migrations are not mounted next to the backend')
    script = ScriptDirectory.from_config(Config(str(COMBINED)))
    heads = script.get_heads()
    assert len(heads) == 1, f'multiple alembic heads in the combined graph: {heads}'
    assert {revision.revision for revision in ScriptDirectory.from_config(Config(str(BACKEND / 'alembic.ini'))).walk_revisions()} < {revision.revision for revision in script.walk_revisions()}
