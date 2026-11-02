"""Replace only MySQL Shell's bundled certifi with a checksum-pinned wheel."""
import hashlib
from pathlib import Path
import shutil
import zipfile

import certifi

wheel = Path("/tmp/devroost-certifi.whl")
expected = "42d35340cc5b9ba78e818ddbff0c5b1c2b779de448a340fd1b989f5fa8670e1b"
if hashlib.sha256(wheel.read_bytes()).hexdigest() != expected:
    raise RuntimeError("certifi wheel checksum mismatch")

site_packages = Path(certifi.__file__).resolve().parent.parent
shutil.rmtree(site_packages / "certifi")
for metadata in site_packages.glob("certifi-*.dist-info"):
    shutil.rmtree(metadata)
with zipfile.ZipFile(wheel) as archive:
    archive.extractall(site_packages)
