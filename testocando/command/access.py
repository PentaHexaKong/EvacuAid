# The key check lives in the backend app so its own /v1/command routes (field operations) can use it too.
from app.commandAccess import requireCommandKey  # noqa: F401
