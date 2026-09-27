import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AuditEntry } from '@aga/shared';

/**
 * Immutable archival of audit records to S3.
 *
 * Optional by design: the local SQLite audit table is the working record, and S3 is the copy that
 * outlives the application. When AUDIT_ARCHIVE_BUCKET is unset the archive step is skipped and the
 * run's event log says so, rather than the run failing. An unconfigured bucket is a deployment
 * choice, not a governance failure.
 */

const bucket = process.env.AUDIT_ARCHIVE_BUCKET;
const client = bucket ? new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' }) : null;

export const archiveEnabled = Boolean(bucket);

/** Returns the s3:// URI the record was written to, or null when archival is not configured. */
export async function archiveAuditEntry(entry: Omit<AuditEntry, 'id'>): Promise<string | null> {
  if (!client || !bucket) return null;

  // Key is partitioned by date so lifecycle rules and Athena partitions work without a catalogue.
  const day = entry.at.slice(0, 10);
  const key = `audit/${day}/${entry.runId}-${entry.policyId}-v${entry.policyVersion}.json`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(entry, null, 2),
      ContentType: 'application/json',
      // Records are write-once. Object Lock on the bucket enforces it; this metadata documents the
      // intent for anyone reading the object directly.
      Metadata: { 'record-type': 'governance-audit', immutable: 'true' }
    })
  );

  return `s3://${bucket}/${key}`;
}
