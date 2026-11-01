"""Make sure HTTPS requests can verify server certificates.

The packaged engine carries its own OpenSSL, which looks for CA certificates
where the build machine kept them (``/usr/lib/ssl`` on the Ubuntu runners).
Other systems keep them elsewhere (Arch and Fedora use ``/etc/ssl/certs`` and
``/etc/pki``; macOS has no PEM bundle at all), so every request to UniProt,
RCSB and the rest failed with ``CERTIFICATE_VERIFY_FAILED``. At start-up we
point OpenSSL at the system bundle if one exists, else at the certifi bundle
shipped with the engine.
"""

from __future__ import annotations

import os
import ssl

# Common locations of the system CA bundle, as used by Go's crypto/x509.
SYSTEM_CA_FILES = (
    "/etc/ssl/certs/ca-certificates.crt",  # Debian, Ubuntu, Arch, Gentoo
    "/etc/pki/tls/certs/ca-bundle.crt",  # Fedora, RHEL
    "/etc/ssl/ca-bundle.pem",  # openSUSE
    "/etc/pki/tls/cacert.pem",  # OpenELEC
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",  # CentOS, RHEL 7
    "/etc/ssl/cert.pem",  # Alpine, macOS, FreeBSD
)


def _default_paths_work() -> bool:
    paths = ssl.get_default_verify_paths()
    if paths.cafile and os.path.isfile(paths.cafile):
        return True
    return bool(paths.capath and os.path.isdir(paths.capath) and os.listdir(paths.capath))


def _certifi_bundle() -> str | None:
    try:
        import certifi
    except ImportError:
        return None
    path = certifi.where()
    return path if os.path.isfile(path) else None


def configure_ca_bundle() -> str | None:
    """Set ``SSL_CERT_FILE`` when OpenSSL's built-in paths hold no certificates.

    Returns the bundle chosen, or ``None`` when nothing needed changing.
    """
    if os.environ.get("SSL_CERT_FILE") or os.environ.get("SSL_CERT_DIR"):
        return None
    if _default_paths_work():
        return None
    for candidate in (*SYSTEM_CA_FILES, _certifi_bundle()):
        if candidate and os.path.isfile(candidate):
            os.environ["SSL_CERT_FILE"] = candidate
            return candidate
    return None
