"""Dependency-free checks for native scope and automatic-check boundaries."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import unittest
from uuid import UUID, uuid4

SPEC = importlib.util.spec_from_file_location("companion_policy", Path(__file__).parents[1] / "custom_components/genesismesh/policy.py")
policy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(policy)


def fixture():
    return {
        "id": "job-native", "name": "Living-room helper", "purpose": "media",
        "resourceId": "speaker-1", "entityId": "media_player.living_room",
        "resources": [{"id": "speaker-1", "entityId": "media_player.living_room", "name": "Speaker"}],
        "capabilities": ["ha.entity.read", "ha.media.volume", "ha.media.transport"],
        "expiresAt": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        "enabled": True, "allowSystem": True, "allowedHaUserIds": ["native-owner"],
    }


class NativePolicyTests(unittest.TestCase):
    def test_private_transport_and_https_only_without_embedded_credentials(self):
        self.assertEqual(policy.validate_app_url("http://3e2ad153-genesismesh:8098/"), "http://3e2ad153-genesismesh:8098")
        self.assertEqual(policy.validate_app_url("https://example.org"), "https://example.org")
        for bad in ("http://example.org:8098", "http://supervisor:80", "http://127.0.0.1:8123", "https://user:secret@example.org", "https://example.org/?secret=key", "https://example.org/path", "file:///etc/passwd", "https://example.org/#secret"):
            with self.subTest(bad=bad), self.assertRaises(policy.CompanionError):
                policy.validate_app_url(bad)

    def test_only_one_paired_job_and_exact_target(self):
        job = fixture()
        self.assertEqual(policy.select_job({"protocol": 1, "jobs": [job]}, job["id"]), job)
        for mutation in (
            {"protocol": 2, "jobs": [job]}, {"protocol": 1, "jobs": [job, job]},
            {"protocol": 1, "jobs": [{**job, "resourceId": "other"}]},
            {"protocol": 1, "jobs": [{**job, "resources": ["invalid"]}]},
            {"protocol": 1, "jobs": [{**job, "allowSystem": "yes"}]},
        ):
            with self.subTest(mutation=mutation), self.assertRaises(policy.CompanionError):
                policy.select_job(mutation, job["id"])
        with self.assertRaises(policy.CompanionError):
            policy.select_job({"protocol": 1, "jobs": [job]}, "another-job")

    def test_action_target_uuid_expiry_and_finite_parameters(self):
        job = fixture()
        intent = policy.make_intent(job, "ha.media.volume", {"volumePct": 41})
        self.assertEqual(intent["resourceId"], job["resourceId"])
        UUID(intent["requestId"])
        self.assertEqual(intent["parameters"], {"volumePct": 41})
        self.assertNotIn("subjectId", intent)
        for cap, params in (("ha.media.volume", {"volumePct": True}), ("ha.media.volume", {"volumePct": float("nan")}), ("ha.media.volume", {"volumePct": 35, "userId": "owner"}), ("ha.media.transport", {"action": "shell"}), ("ha.entity.read", {"entityId": "other"}), ("ha.switch.set", {"state": "on"})):
            with self.subTest(cap=cap, params=params), self.assertRaises(policy.CompanionError):
                policy.make_intent(job, cap, params)

    def test_expired_disabled_and_missing_capability_fail(self):
        for job in (
            {**fixture(), "enabled": False},
            {**fixture(), "expiresAt": "2000-01-01T00:00:00Z"},
            {**fixture(), "expiresAt": "2099-01-01T00:00:00"},
            {**fixture(), "capabilities": []},
        ):
            with self.assertRaises(policy.CompanionError):
                policy.make_intent(job, "ha.entity.read", {})

    def test_automatic_verification_only_fresh_exact_read_preserves_request_id(self):
        job = fixture()
        check = policy.make_intent(job, "ha.entity.read", {})
        job["verification"] = check
        self.assertEqual(policy.verification_intent(job), check)
        for key, value in (("capability", "ha.media.volume"), ("parameters", {"volumePct": 35}), ("resourceId", "other"), ("expiresAt", "2000-01-01T00:00:00Z"), ("requestId", "not-a-uuid")):
            changed = deepcopy(job)
            changed["verification"][key] = value
            with self.subTest(key=key), self.assertRaises(policy.CompanionError):
                policy.verification_intent(changed)
        changed = deepcopy(job)
        changed["verification"]["userId"] = "owner"
        with self.assertRaises(policy.CompanionError):
            policy.verification_intent(changed)

    def test_pairing_code_normalizes_spacing_preserves_base64url_case_and_punctuation(self):
        self.assertEqual(policy.valid_pairing_code("  A-_bcDEF12345678  "), "A-_bcDEF12345678")
        for value in ("abc", "!secret!", "123456?admin=true", "12345678901234567"):
            with self.assertRaises(policy.CompanionError):
                policy.valid_pairing_code(value)


if __name__ == "__main__":
    unittest.main()

