# Changelog

## 1.0.0 — 2026-08-24

Initial release of the VindraPay Android monitor.

### Added
- SMS capture pipeline with multi-part assembly, client-side dedup (SHA-256 unique index), and a conservative provider gate.
- Foreground monitoring service (`dataSync`) with heartbeat-driven provider sync and WorkManager batched upload (unique work `upload-pending`, CONNECTED constraint, exponential backoff).
- Boot receiver to restore monitoring after reboot when enabled and configured.
- Onboarding pager: welcome, SMS permissions rationale + runtime requests, battery optimization + OEM tips, connection setup with sequential test, done.
- Home dashboard: monitoring toggle, backend status, provider chips, pending/uploaded counters, permission checklist cards.
- History screen with per-message status/reason chips and "Retry pending".
- Settings: base URL validation, masked replace-only token field, heartbeat interval slider (15–300 s step 5), notifications toggle, about row.
- EncryptedSharedPreferences for the device token; DataStore preferences for everything else.
