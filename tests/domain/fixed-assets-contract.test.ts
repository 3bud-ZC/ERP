import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getNextFixedAssetNumber, parseFixedAssetSequence } from '@/lib/fixed-assets';
import { getUniqueConstraintMessage } from '@/lib/api-response';
import { getWorkflow, validateTransition } from '@/lib/workflow-state-machines';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PRISMA_SCHEMA = path.join(REPO_ROOT, 'prisma', 'schema.prisma');
const ACCOUNTING_SOURCE = path.join(REPO_ROOT, 'lib', 'accounting.ts');
const CODE_SEQUENCE_SOURCE = path.join(REPO_ROOT, 'lib', 'code-sequence.service.ts');

describe('fixed asset numbering helpers', () => {
  it('increments the tenant-local sequence', () => {
    expect(parseFixedAssetSequence(undefined)).toBe(0);
    expect(parseFixedAssetSequence('FA-000009')).toBe(9);
    expect(getNextFixedAssetNumber()).toBe('FA-000001');
    expect(getNextFixedAssetNumber('FA-000009')).toBe('FA-000010');
  });
});

describe('fixed asset workflow contract', () => {
  it('supports active to disposed transitions', () => {
    const workflow = getWorkflow('FixedAssetWorkflow');
    expect(workflow).toBeDefined();
    expect(validateTransition(workflow!, 'active', 'disposed')).toEqual({ allowed: true });
    expect(validateTransition(workflow!, 'disposed', 'active').allowed).toBe(false);
  });
});

describe('fixed asset schema contract', () => {
  it('keeps asset numbers unique per tenant instead of globally', () => {
    const schema = fs.readFileSync(PRISMA_SCHEMA, 'utf8');
    const fixedAssetBlock = schema.match(/model FixedAsset \{[\s\S]*?\n\}/);

    expect(fixedAssetBlock, 'FixedAsset model block not found').not.toBeNull();
    expect(fixedAssetBlock![0]).toContain('assetNumber             String');
    expect(fixedAssetBlock![0]).not.toContain('assetNumber             String                 @unique');
    expect(fixedAssetBlock![0]).toContain('@@unique([tenantId, assetNumber])');
  });
});

describe('journal entry numbering contract', () => {
  it('reconciles stale journal-entry sequences before allocation', () => {
    const source = fs.readFileSync(CODE_SEQUENCE_SOURCE, 'utf8');
    expect(source).toContain("return entityKey === CODE_ENTITY_KEYS.JOURNAL_ENTRY;");
    expect(source).toContain('if (existing.lastValue < floor)');
  });

  it('retries journal entry creation after unique collisions', () => {
    const source = fs.readFileSync(ACCOUNTING_SOURCE, 'utf8');
    expect(source).toContain("for (let attempt = 0; attempt < 3; attempt += 1)");
    expect(source).toContain("if (error?.code === 'P2002' && attempt < 2)");
  });
});

describe('unique constraint messages', () => {
  it('maps known targets to precise Arabic messages', () => {
    expect(getUniqueConstraintMessage({ meta: { target: ['entryNumber'] } })).toBe('رقم القيد مستخدم بالفعل');
    expect(getUniqueConstraintMessage({ meta: { target: ['assetNumber'] } })).toBe('رقم الأصل مستخدم بالفعل');
    expect(getUniqueConstraintMessage({ meta: { target: ['email'] } })).toBe('البريد الإلكتروني مستخدم بالفعل');
  });
});
