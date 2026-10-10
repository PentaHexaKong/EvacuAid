import hashlib
import re
from datetime import datetime
from pathlib import PurePosixPath

import rfc8785
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from pydantic import BaseModel, ConfigDict, Field, model_validator


def safe_path(value: str) -> str:
    parts = PurePosixPath(value).parts
    if not value or value.startswith('/') or '\\' in value or ':' in value or any(p in {'..', '.', ''} for p in value.split('/')) or not parts:
        raise ValueError('Invalid package path')
    if not re.fullmatch(r'[A-Za-z0-9_./-]+', value):
        raise ValueError('Invalid package path')
    return value


class Asset(BaseModel):
    model_config = ConfigDict(extra='forbid')
    path: str
    sha256: str = Field(pattern=r'^[a-f0-9]{64}$')
    sizeBytes: int = Field(ge=0, le=2**40)
    kind: str

    @model_validator(mode='after')
    def validate_path(self):
        safe_path(self.path)
        if self.kind not in {'map', 'routing', 'hazards', 'shelters', 'cached-routes'} or not self.path.startswith(self.kind + '/'):
            raise ValueError('Asset kind and path disagree')
        return self


def canonical(document: dict) -> bytes:
    return rfc8785.dumps(document)


def sign(document: dict, key: Ed25519PrivateKey, key_id: str) -> dict:
    unsigned = {k: v for k, v in document.items() if k != 'packageSignature'}
    return {**unsigned, 'packageSignature': {'algorithm': 'Ed25519', 'keyId': key_id, 'value': key.sign(canonical(unsigned)).hex()}}


def verify(document: dict, public_key: Ed25519PublicKey) -> None:
    signature = document['packageSignature']
    if signature['algorithm'] != 'Ed25519':
        raise ValueError('Unsupported signature')
    public_key.verify(bytes.fromhex(signature['value']), canonical({k: v for k, v in document.items() if k != 'packageSignature'}))


def validate(document: dict) -> None:
    if document.get('schemaVersion') != 1 or document.get('routingEngine') != 'valhalla' or document.get('routingEngineVersion') not in {'3.9.0', None}:
        raise ValueError('Incompatible package')
    assets = [Asset.model_validate(a) for a in document['assets']]
    paths = [a.path for a in assets]
    if len(paths) != len(set(paths)) or len(paths) > 20000:
        raise ValueError('Duplicate or excessive assets')
    if document['packageSizeBytes'] != sum(a.sizeBytes for a in assets):
        raise ValueError('Invalid package size')
    if document['contentChecksums'] != {a.path: a.sha256 for a in assets}:
        raise ValueError('Invalid content checksums')
    if not re.fullmatch(r'[a-f0-9]{64}', document['packageId']):
        raise ValueError('Invalid package ID')
    bbox = document['bbox']
    if len(bbox) != 4 or not (-180 <= bbox[0] < bbox[2] <= 180 and -90 <= bbox[1] < bbox[3] <= 90):
        raise ValueError('Invalid coverage')
    generated, expires = (datetime.fromisoformat(document[k].replace('Z', '+00:00')) for k in ('generatedAt', 'expiresAt'))
    if generated.tzinfo is None or expires.tzinfo is None or generated >= expires:
        raise ValueError('Invalid package validity')


def digest_file(path) -> str:
    with open(path, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
