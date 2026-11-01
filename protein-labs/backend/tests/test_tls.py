import os
import ssl

import pytest

from protein_labs import tls


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("SSL_CERT_FILE", raising=False)
    monkeypatch.delenv("SSL_CERT_DIR", raising=False)


def missing_default_paths(monkeypatch, tmp_path):
    empty = ssl.DefaultVerifyPaths(None, None, "SSL_CERT_FILE", str(tmp_path / "x.pem"), "SSL_CERT_DIR", str(tmp_path))
    monkeypatch.setattr(tls.ssl, "get_default_verify_paths", lambda: empty)


def test_leaves_working_default_paths_alone(monkeypatch, tmp_path):
    bundle = tmp_path / "cert.pem"
    bundle.write_text("pem")
    paths = ssl.DefaultVerifyPaths(str(bundle), None, "SSL_CERT_FILE", str(bundle), "SSL_CERT_DIR", "")
    monkeypatch.setattr(tls.ssl, "get_default_verify_paths", lambda: paths)

    assert tls.configure_ca_bundle() is None
    assert "SSL_CERT_FILE" not in os.environ


def test_respects_an_operator_set_bundle(monkeypatch, tmp_path):
    missing_default_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("SSL_CERT_FILE", "/operator/choice.pem")

    assert tls.configure_ca_bundle() is None
    assert os.environ["SSL_CERT_FILE"] == "/operator/choice.pem"


def test_prefers_the_system_bundle(monkeypatch, tmp_path):
    missing_default_paths(monkeypatch, tmp_path)
    system = tmp_path / "ca-certificates.crt"
    system.write_text("pem")
    monkeypatch.setattr(tls, "SYSTEM_CA_FILES", (str(tmp_path / "absent.crt"), str(system)))

    assert tls.configure_ca_bundle() == str(system)
    assert os.environ["SSL_CERT_FILE"] == str(system)


def test_falls_back_to_certifi(monkeypatch, tmp_path):
    missing_default_paths(monkeypatch, tmp_path)
    monkeypatch.setattr(tls, "SYSTEM_CA_FILES", (str(tmp_path / "absent.crt"),))
    certifi = pytest.importorskip("certifi")

    assert tls.configure_ca_bundle() == certifi.where()
    assert os.environ["SSL_CERT_FILE"] == certifi.where()
