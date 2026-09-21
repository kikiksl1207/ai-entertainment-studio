import { readFileSync } from 'fs';
import { join } from 'path';

const migration = readFileSync(
  join(
    __dirname,
    '../../prisma/migrations/20260921120000_content_rights_contract_configuration/migration.sql',
  ),
  'utf8',
).replace(/\s+/g, ' ');
const auditTable = migration.match(
  /CREATE TABLE "content_rights_contract_audits" \(.*?\);/,
)?.[0] ?? '';

describe('content rights contract migration integrity', () => {
  it('rejects a source version from another contract while preserving same-contract chains', () => {
    expect(migration).toMatch(
      /UNIQUE \("contract_id", "id"\)/,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("contract_id", "source_version_id"\) REFERENCES "content_rights_contract_versions"\("contract_id", "id"\)/,
    );
    expect(migration).not.toMatch(
      /"source_version_id" UUID REFERENCES "content_rights_contract_versions"\("id"\)/,
    );
  });

  it('rejects an audit whose version belongs to another contract', () => {
    expect(migration).toMatch(
      /FOREIGN KEY \("contract_id", "contract_version_id"\) REFERENCES "content_rights_contract_versions"\("contract_id", "id"\)/,
    );
    expect(auditTable).not.toMatch(
      /"contract_version_id" UUID NOT NULL REFERENCES "content_rights_contract_versions"\("id"\)/,
    );
  });

  it('keeps revision serialization and append-only history guards intact', () => {
    expect(migration).toContain('UNIQUE ("contract_id", "revision")');
    expect(migration).toContain('content_rights_versions_immutable BEFORE UPDATE OR DELETE');
    expect(migration).toContain('content_rights_audits_immutable BEFORE UPDATE OR DELETE');
  });
});
