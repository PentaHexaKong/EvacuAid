import runpy

import command.models
from app.config import BACKEND_DIR

runpy.run_path(str(BACKEND_DIR / 'alembic' / 'env.py'))
