# Long Document Retrieval Fixture

## Atlas Retention Window

Project Atlas keeps sanitized operational summaries for thirty days. The unique setting `atlasRetentionDays` controls the retention window in this fictional example.

## Beacon Key Rotation

Project Beacon rotates local signing material every seven days. The fictional procedure is named `rotateBeaconKeyset` and never sends key data to a remote service.

## Cedar Schema Migration

Project Cedar upgrades note metadata with migration id `CEDAR_SCHEMA_12`. The migration creates a backup before rewriting local derived records.

## Delta Recovery Point

Project Delta records the last consistent checkpoint in `delta-recovery.json`. Recovery validates hashes before replacing a damaged local snapshot.

## Ember Audit Trail

Project Ember appends sanitized events to `ember-audit.log`. The audit trail excludes document bodies and stores operation names, timestamps, and result codes.
