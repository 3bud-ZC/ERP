/**
 * Per-tenant GL account mapping (stored in Tenant.settings.postingProfile).
 * Falls back to INVOICE_ACCOUNTS defaults for backward compatibility.
 */

import { prisma } from '@/lib/db';
import { INVOICE_ACCOUNTS } from '@/lib/services/invoice-accounting.service';

export interface PostingProfile {
  cash: string;
  ar: string;
  ap: string;
  inventory: string;
  revenue: string;
  cogs: string;
  taxPayable: string;
  taxInput: string;
  adjustment: string;
  /** Work in progress (manufacturing) */
  wip: string;
  /** Direct labor expense */
  laborExpense: string;
  /** Manufacturing overhead */
  overheadExpense: string;
}

const DEFAULT_PROFILE: PostingProfile = {
  cash: INVOICE_ACCOUNTS.CASH,
  ar: INVOICE_ACCOUNTS.AR,
  ap: INVOICE_ACCOUNTS.AP,
  inventory: INVOICE_ACCOUNTS.INVENTORY,
  revenue: INVOICE_ACCOUNTS.REVENUE,
  cogs: INVOICE_ACCOUNTS.COGS,
  taxPayable: INVOICE_ACCOUNTS.TAX_PAYABLE,
  taxInput: INVOICE_ACCOUNTS.TAX_PAYABLE,
  adjustment: INVOICE_ACCOUNTS.ADJUSTMENT,
  wip: '6001',
  laborExpense: '5020',
  overheadExpense: '5060',
};

const profileCache = new Map<string, { profile: PostingProfile; at: number }>();
const CACHE_TTL_MS = 60_000;

export async function getPostingProfile(tenantId: string): Promise<PostingProfile> {
  const cached = profileCache.get(tenantId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.profile;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });

  const raw = (tenant?.settings as Record<string, unknown> | null)?.postingProfile;
  const profile: PostingProfile = {
    ...DEFAULT_PROFILE,
    ...(typeof raw === 'object' && raw !== null ? (raw as Partial<PostingProfile>) : {}),
  };

  profileCache.set(tenantId, { profile, at: Date.now() });
  return profile;
}

export function clearPostingProfileCache(tenantId?: string): void {
  if (tenantId) profileCache.delete(tenantId);
  else profileCache.clear();
}
