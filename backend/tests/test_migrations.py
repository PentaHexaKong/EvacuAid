from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def test_single_migration_head():
    script = ScriptDirectory.from_config(Config(str(Path(__file__).parents[1] / 'alembic.ini')))
    heads = script.get_heads()
    assert len(heads) == 1, f'multiple alembic heads: {heads}'
