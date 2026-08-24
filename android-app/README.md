# VindraPay Android Monitor

Native Kotlin app (Jetpack Compose, Material 3) that turns a spare Android phone into a payment-SMS monitor. It listens for incoming SMS from your configured mobile-money providers (bKash etc.), matches the sender against the provider list synced from your VindraPay backend, and uploads matched messages in batches for parsing. Distributed as a sideloaded APK — it is intentionally never published to the Play Store.

| | |
|---|---|
| Package | `com.vindrapay.monitor` |
| Stack | Kotlin 2.0.20 · AGP 8.5.2 · compileSdk/targetSdk 35 · minSdk 24 |
| UI | Compose + Material 3 (dark), Navigation-Compose |
| Storage | Room (captures + provider sync), DataStore (settings), EncryptedSharedPreferences (device token only) |
| Network | Retrofit + OkHttp + kotlinx-serialization |
| Background | Foreground service (`dataSync`), WorkManager, boot receiver |

## Screens

1. **Onboarding** (first launch): Welcome → SMS permission rationale then runtime requests (`READ_SMS`, `RECEIVE_SMS`, `POST_NOTIFICATIONS` on 33+) → battery-optimization explainer with OEM-specific tips (Xiaomi/OPPO/vivo/Huawei/realme/OnePlus) → connection setup (base URL + token + sequential test) → Done, which starts monitoring.
2. **Home**: big monitoring toggle, backend status card, "Monitoring for:" provider chips, pending/uploaded counters, permission checklist cards with inline fix actions.
3. **History**: captured messages with PENDING/SENT chips plus server result chips (`parsed`/`duplicate`/`unmatched`/`skipped`/`error`) and reasons; "Retry pending" button.
4. **Settings**: base URL (validated, trailing slash stripped), write-only masked device-token field (replace flow), heartbeat interval slider 15–300 s step 5, notifications toggle, Test connection, About/version row.

A connection pill in the top bar shows Waiting / Online / Offline once onboarding is complete.

## Behavior

### Capture pipeline
- Manifest-registered `SmsReceiver` on `android.provider.Telephony.SMS_RECEIVED`.
- Multi-part SMS: parts arrive as separate broadcasts sharing concat parameters. The assembler correlates by `(originatingAddress + referenceNumber + totalParts)` parsed from the GSM PDU user-data header (8-bit IE `00`, 16-bit IE `08`) and persists partial assemblies until complete (stale parts pruned after 24 h). CDMA-style PDUs are treated as single-part.
- Client-side dedup: key = SHA-256(`sender|body|epochSecond`) with a unique Room index; duplicate inserts are silently ignored (`OnConflictStrategy.IGNORE` returns `-1`).
- Conservative gate: if no synced providers exist, messages are dropped silently (the dashboard shows an amber "waiting for provider list" hint). Otherwise a message is captured when some provider's `sender_id` equals the message sender case-insensitively **or** any active provider has a null `sender_id` (capture-all).
- Captured rows store a UUIDv4 `clientMsgId`, sender, body, SMS timestamp, status `PENDING`.
- Per-message notification updates (channel `captures`, toggleable) reuse one notification id per message: "Payment SMS from {sender}" → "Uploaded ✓" / "Queued offline" / "Skipped: reason" / "Rejected: reason". SMS bodies are never shown in notifications.

### Upload
- Unique WorkManager work `upload-pending`: CONNECTED constraint, exponential backoff starting at 30 s. Each run loops: take ≤50 oldest PENDING rows → `POST /device/v1/messages` → map results by `client_msg_id` → mark rows SENT with `resultStatus`/`resultReason` → repeat until drained. Any returned status counts as acknowledged because the server dedups by `client_msg_id`. Failures return `Result.retry()`. Enqueued after every capture and whenever connectivity is regained.

### Monitoring service
- `MonitoringService` is a START_STICKY foreground service (`foregroundServiceType="dataSync"`), silent low-importance notification "VindraPay is monitoring for payments".
- Every `heartbeatIntervalSeconds` (default 30): POST `/device/v1/heartbeat`, replace-all providers in Room, update Home state (last heartbeat, backend online); if pending rows exist and we're online, enqueue upload.
- `BootReceiver` restarts the service after reboot when monitoring was enabled and a token is configured.

## Backend contract (implemented)

All device calls send `Authorization: Bearer <device token>` (`vdt_…`).

| Call | Request | Response used |
|---|---|---|
| `GET {base}/healthz` | — | any 200 = reachable (no auth) |
| `POST {base}/device/v1/heartbeat` | `{"app_version":"1.0.0","os_version":"Android 14"}` | `{"success":true,"data":{"providers":[{"id","name","sender_id","direction"}]}}` — null `sender_id` means capture-any-sender |
| `POST {base}/device/v1/messages` | `{"messages":[{"client_msg_id","sender_id","body","device_received_at"}]}` (≤50) | `{"success":true,"data":{"results":[{"client_msg_id","status","error"}]}}` |

The dynamic base URL is applied by an OkHttp interceptor that rewrites request URLs from a volatile snapshot kept in sync with DataStore, so changing servers takes effect immediately without rebuilding Retrofit.

## Build in Android Studio

This machine has no JDK/Android SDK, so the Gradle wrapper JAR is not committed. In Android Studio:

1. Open the `android-app/` folder (Studio Ladybug or newer, AGP 8.5.x compatible).
2. If Studio asks about the missing wrapper JAR, let it generate/repair the wrapper for Gradle **8.7** (the pinned version in `gradle/wrapper/gradle-wrapper.properties`), or run `gradle wrapper --gradle-version 8.7` once with any local Gradle ≥8.7.
3. Sync, then Run on a device or build an APK:
   - Debug: `./gradlew :app:assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`
   - Release: `./gradlew :app:assembleRelease`
4. Unit tests: `./gradlew :app:testDebugUnitTest` (pure JVM tests for dedup hashing and batching live in `app/src/test`).

### Signing a sideloaded release APK
Create `keystore.properties` next to `settings.gradle.kts` (git-ignored) with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`, wire those into `signingConfigs` in `app/build.gradle.kts`, or simply sign manually:

```
apksigner sign --ks my-release.jks --out vindrapay-monitor-1.0.0.apk app-release-unsigned.apk
zipalign -f -p 4 in.apk out.apk   (before signing)
```

Install with `adb install -r app.apk` or by opening the APK on the phone (allow unknown sources). The app is designed to be force-installed on a dedicated spare handset.

### Security notes
- `usesCleartextTraffic="true"` is required because self-hosted backends commonly run plain HTTP on LAN IPs during setup. For production: put TLS (even a self-signed cert pinned via networkSecurityConfig) in front of the backend and remove this flag.
- Only the device token lives in EncryptedSharedPreferences; `allowBackup=false` and `dataExtractionRules` exclude that prefs file from cloud backups and device transfers.
- `SmsReceiver` is `exported="true"` solely because the system delivers `SMS_RECEIVED`; that broadcast is protected, meaning only the OS can broadcast it — third-party apps cannot spoof deliveries into this receiver. The same applies to `BOOT_COMPLETED`.

### Battery / OEM survival guide
Android (and especially vendor skins) kill background apps. After onboarding:
- Accept the in-app "Disable battery optimization" prompt (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`).
- Xiaomi (MIUI/HyperOS): Security app → Autostart ON; Battery saver → No restrictions; lock app in Recents.
- OPPO/realme (ColorOS/Realme UI): Auto-start ON; allow background activity; disable deep-sleep optimization for the app.
- vivo (Funtouch): allow high background power consumption; auto-start ON.
- Huawei/Honor (EMUI/MagicOS): Battery → App launch → Manage manually, enable all three toggles.
- OnePlus (OxygenOS): Battery optimization → Don't optimize.

### Troubleshooting
- **Amber "waiting for provider list"**: no successful heartbeat yet, so captures are dropped by design. Fix connectivity/token, watch the pill turn green, then test an SMS.
- **"Rejected — check device token"**: wrong/expired `vdt_…` token. Replace it in Settings (paste over the masked field, Save & test).
- **Messages stay PENDING offline**: they upload automatically when connectivity returns (WorkManager + connectivity callback). Force retry via History → Retry pending.
- **Service killed overnight**: complete the OEM steps above; also verify the FGS notification is visible. Note Android 15 caps long-running `dataSync` foreground services (~6 h/day window behavior may require reopening the app periodically on ultra-aggressive builds).
- **Force-stopped app**: if the user swipes it away via "Force stop" (or some OEM task managers do), Android puts the app into stopped state where boot broadcasts are not delivered until it is opened once. This is an OS-level limitation; open the app after a force-stop to resume monitoring.
- **Keystore errors on first launch** (rare devices with broken TEE): the token store cannot initialize. Reboot usually fixes; report persistent cases.
