"""PII masking unit tests (S140-001)."""

from mask import IrreversibleMasker, mask_text, scan_for_leaks


def test_masks_email():
    out = mask_text("Contact tanaka@example.com for details.")
    assert "tanaka@example.com" not in out
    assert "[EMAIL_" in out
    assert scan_for_leaks(out) == []


def test_masks_api_key():
    out = mask_text("Use sk-abcdefghijklmnopqrstuvwxyz1234567890 for API.")
    assert "sk-" not in out
    assert "[API_KEY_" in out
    assert scan_for_leaks(out) == []


def test_masks_absolute_path():
    out = mask_text("File at /Users/alice/projects/harness-mem/README.md")
    assert "/Users/" not in out
    assert "[PATH_" in out
    assert scan_for_leaks(out) == []


def test_consistent_token_same_entity():
    masker = IrreversibleMasker()
    text = "Email alice@corp.com and alice@corp.com again."
    out = masker.mask(text)
    assert out.count("[EMAIL_1]") == 2
    masker.discard_mapping()
    assert len(masker._entity_map) == 0


def test_mapping_discarded_after_mask_text():
    out = mask_text("secret token=abc123xyz")
    assert "abc123xyz" not in out
    assert scan_for_leaks(out) == []


def test_japanese_name_suffix():
    out = mask_text("田中さんに確認した。")
    assert "田中さん" not in out
    assert "[PERSON_" in out
