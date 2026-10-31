"""Write 32 random bytes (hex) as the attribution HMAC secret.

Usage (from the shop root): python tools/make_attribution_secret.py [path] [--force]
Default path: secrets/attribution_hmac.key. The key is never printed.
POSIX: file mode 0600. Windows: os.open mode only maps to the read-only bit, so the
file inherits the folder ACL; restrict it manually, e.g.
  icacls secrets\\attribution_hmac.key /inheritance:r /grant:r "%USERNAME%:R"
Rotating the key changes every user_key/cid_key (hash_key_version changes too),
so an existing file is never overwritten without --force.
"""

import os
import secrets
import sys
from pathlib import Path


def main(argv):
    force = "--force" in argv
    args = [a for a in argv if a != "--force"]
    target = Path(args[0]) if args else Path("secrets") / "attribution_hmac.key"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if not force:
            print("[make_attribution_secret] refusing to overwrite " + str(target) + " (use --force)", file=sys.stderr)
            return 2
        target.unlink()
    fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    try:
        os.write(fd, (secrets.token_hex(32) + "\n").encode("ascii"))
    finally:
        os.close(fd)
    if os.name != "nt":
        os.chmod(str(target), 0o600)
    print("[make_attribution_secret] wrote " + str(target) + " (key not printed)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))