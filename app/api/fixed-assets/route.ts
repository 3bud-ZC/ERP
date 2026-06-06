import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission, logAuditAction } from '@/lib/auth';
import { createJournalEntry, postJournalEntry } from '@/lib/accounting';
import { reverseAllJournalEntriesForReferenceId } from '@/lib/services/journal-reversal.service';
import { transitionEntity } from '@/lib/workflow-engine';
import { registerAllEventHandlers } from '@/lib/event-handlers';

// Register event handlers on module load
registerAllEventHandlers();

// Disable caching for real-time data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DEFAULT_USEFUL_LIFE = 60;
const DEFAULT_SALVAGE_VALUE = 0;

type AccountLite = {
  code: string;
  nameAr: string;
  type: string;
  subType?: string | null;
};

function normalizeCategory(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['machines', 'furniture', 'devices', 'vehicles', 'other'].includes(normalized)) return normalized;
  return 'other';
}

function categoryLabel(category: string) {
  switch (category) {
    case 'machines': return 'الآلات';
    case 'furniture': return 'الأثاث';
    case 'devices': return 'الأجهزة';
    case 'vehicles': return 'السيارات';
    default: return 'أصول أخرى';
  }
}

function buildAssetDescription(category: string, notes?: string | null) {
  return [
    `تصنيف الأصل: ${categoryLabel(category)}`,
    notes?.trim() ? `ملاحظات: ${notes.trim()}` : null,
  ].filter(Boolean).join('\n');
}

function parseNotesFromDescription(description?: string | null) {
  if (!description) return '';
  const line = description.split('\n').find((item) => item.startsWith('ملاحظات:'));
  return line ? line.replace('ملاحظات:', '').trim() : '';
}

function pickFixedAssetAccount(accounts: AccountLite[]) {
  const preferred = accounts.find((account) => String(account.subType || '').toLowerCase().includes('fixed'))
    || accounts.find((account) => ['1040', '1400'].includes(account.code))
    || accounts.find((account) => String(account.nameAr || '').includes('أصول ثابتة'))
    || accounts.find((account) => {
      const subtype = String(account.subType || '').toLowerCase();
      return !['cash', 'bank', 'receivable', 'inventory', 'wip', 'header'].includes(subtype);
    });
  return preferred?.code || null;
}

function pickFundingAccount(accounts: AccountLite[], assetAccountCode: string) {
  const filtered = accounts.filter((account) => account.code !== assetAccountCode);
  const preferred = filtered.find((account) => String(account.subType || '').toLowerCase() === 'bank')
    || filtered.find((account) => ['1010', '1110'].includes(account.code))
    || filtered.find((account) => String(account.subType || '').toLowerCase() === 'cash')
    || filtered.find((account) => ['1001', '1100'].includes(account.code))
    || filtered.find((account) => {
      const type = String(account.type || '').toLowerCase();
      const subtype = String(account.subType || '').toLowerCase();
      return ['asset', 'liability', 'equity'].includes(type) && subtype !== 'header';
    });
  return preferred?.code || null;
}

async function resolveAssetAccounts(tenantId: string, accountCode?: string | null, creditAccountCode?: string | null) {
  const accounts = await prisma.account.findMany({
    where: { tenantId, isActive: true },
    select: { code: true, nameAr: true, type: true, subType: true },
    orderBy: { code: 'asc' },
  });

  const assetCandidates = accounts.filter((account) => String(account.type || '').toLowerCase() === 'asset');
  const fundingCandidates = accounts.filter((account) => {
    const type = String(account.type || '').toLowerCase();
    const subtype = String(account.subType || '').toLowerCase();
    return ['asset', 'liability', 'equity'].includes(type) && subtype !== 'header';
  });

  const resolvedAssetAccountCode = accountCode || pickFixedAssetAccount(assetCandidates);
  if (!resolvedAssetAccountCode) {
    throw new Error('تعذر تحديد حساب أصل ثابت مناسب لهذا الكيان');
  }

  const resolvedFundingAccountCode = creditAccountCode || pickFundingAccount(fundingCandidates, resolvedAssetAccountCode);
  if (!resolvedFundingAccountCode) {
    throw new Error('تعذر تحديد حساب تمويل مناسب لهذا الكيان');
  }

  return {
    assetAccountCode: resolvedAssetAccountCode,
    fundingAccountCode: resolvedFundingAccountCode,
  };
}

async function createFixedAssetJournalEntry(params: {
  assetId: string;
  assetNumber: string;
  tenantId: string;
  userId: string;
  name: string;
  accountCode: string;
  creditAccountCode: string;
  purchaseDate: Date;
  purchaseCost: number;
}) {
  const journalEntry = await createJournalEntry({
    entryDate: params.purchaseDate,
    description: `Purchase of fixed asset ${params.assetNumber} - ${params.name}`,
    referenceType: 'FixedAsset',
    referenceId: params.assetId,
    tenantId: params.tenantId,
    lines: [
      {
        accountCode: params.accountCode,
        debit: params.purchaseCost,
        credit: 0,
        description: `Fixed asset ${params.name}`,
      },
      {
        accountCode: params.creditAccountCode,
        debit: 0,
        credit: params.purchaseCost,
        description: `Funding for fixed asset ${params.name}`,
      },
    ],
  }, params.userId);

  await postJournalEntry(journalEntry.id, params.userId);
  return journalEntry;
}

async function recreateDepreciationSchedules(params: {
  fixedAssetId: string;
  purchaseDate: Date;
  purchaseCost: number;
  usefulLife: number;
  salvageValue: number;
}) {
  await (prisma as any).depreciationSchedule.deleteMany({
    where: { fixedAssetId: params.fixedAssetId, posted: false },
  });

  const monthlyDepreciation = (params.purchaseCost - params.salvageValue) / params.usefulLife;
  const depreciationScheduleRows = Array.from({ length: params.usefulLife }, (_, index) => {
    const periodDate = new Date(params.purchaseDate);
    periodDate.setMonth(periodDate.getMonth() + index);
    const period = `${periodDate.getFullYear()}-${String(periodDate.getMonth() + 1).padStart(2, '0')}`;
    const accumulatedDepreciation = monthlyDepreciation * (index + 1);
    const currentNetBookValue = params.purchaseCost - accumulatedDepreciation;

    return {
      fixedAssetId: params.fixedAssetId,
      period,
      depreciationAmount: monthlyDepreciation,
      accumulatedDepreciation,
      netBookValue: Math.max(0, currentNetBookValue),
      posted: false,
    };
  });

  await (prisma as any).depreciationSchedule.createMany({
    data: depreciationScheduleRows,
  });
}

// GET - Read fixed assets
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'view_accounting')) return apiError('ليس لديك صلاحية', 403);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)));
    const skip = (page - 1) * limit;

    const where: any = { tenantId: user.tenantId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      (prisma as any).fixedAsset.findMany({
        where,
        include: {
          depreciationSchedules: {
            orderBy: { period: 'desc' },
          },
        },
        orderBy: { purchaseDate: 'desc' },
        skip,
        take: limit,
      }),
      (prisma as any).fixedAsset.count({ where }),
    ]);

    return apiSuccess({ fixedAssets: data, total, page, limit }, 'Fixed assets fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch fixed assets');
  }
}

// POST - Create fixed asset
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_accounting')) return apiError('ليس لديك صلاحية', 403);

    const body = await request.json();
    const {
      name,
      description,
      category,
      notes,
      accountCode,
      creditAccountCode,
      purchaseDate,
      purchaseCost,
      usefulLife,
      salvageValue,
      depreciationMethod,
    } = body;

    if (!name || !purchaseDate || !purchaseCost) {
      return apiError('الاسم والتاريخ والقيمة مطلوبة', 400);
    }

    const purchaseCostValue = Number(purchaseCost);
    const usefulLifeValue = parseInt(String(usefulLife || DEFAULT_USEFUL_LIFE), 10);
    const salvageValueValue = Number(salvageValue ?? DEFAULT_SALVAGE_VALUE);
    const normalizedCategory = normalizeCategory(category);
    if (!Number.isFinite(purchaseCostValue) || purchaseCostValue <= 0) {
      return apiError('قيمة الأصل يجب أن تكون أكبر من صفر', 400);
    }
    if (!Number.isFinite(usefulLifeValue) || usefulLifeValue <= 0) {
      return apiError('Useful life must be greater than zero', 400);
    }
    if (!Number.isFinite(salvageValueValue) || salvageValueValue < 0) {
      return apiError('Salvage value must be zero or greater', 400);
    }
    if (salvageValueValue > purchaseCostValue) {
      return apiError('Salvage value cannot exceed purchase cost', 400);
    }

    const { assetAccountCode, fundingAccountCode } = await resolveAssetAccounts(
      user.tenantId!,
      accountCode,
      creditAccountCode,
    );
    if (fundingAccountCode === assetAccountCode) {
      return apiError('الحساب المقابل يجب أن يكون مختلفًا عن حساب الأصل', 400);
    }

    // Generate asset number
    const lastAsset = await (prisma as any).fixedAsset.findFirst({
      where: { tenantId: user.tenantId },
      orderBy: { assetNumber: 'desc' },
    });
    const nextNumber = lastAsset ? parseInt(lastAsset.assetNumber.slice(3)) + 1 : 1;
    const assetNumber = `FA-${String(nextNumber).padStart(6, '0')}`;

    // Calculate initial net book value
    const netBookValue = purchaseCostValue - salvageValueValue;
    const purchaseDateValue = new Date(purchaseDate);
    const monthlyDepreciation = (purchaseCostValue - salvageValueValue) / usefulLifeValue;

    const asset = await (prisma as any).fixedAsset.create({
      data: {
        assetNumber,
        name,
        description: description || buildAssetDescription(normalizedCategory, notes),
        accountCode: assetAccountCode,
        purchaseDate: purchaseDateValue,
        purchaseCost: purchaseCostValue,
        usefulLife: usefulLifeValue,
        salvageValue: salvageValueValue,
        depreciationMethod: depreciationMethod || 'straight_line',
        accumulatedDepreciation: 0,
        netBookValue,
        status: 'active',
        tenantId: user.tenantId,
      },
    });

    await recreateDepreciationSchedules({
      fixedAssetId: asset.id,
      purchaseDate: purchaseDateValue,
      purchaseCost: purchaseCostValue,
      usefulLife: usefulLifeValue,
      salvageValue: salvageValueValue,
    });

    let journalEntry;
    try {
      journalEntry = await createFixedAssetJournalEntry({
        assetId: asset.id,
        assetNumber,
        tenantId: user.tenantId!,
        userId: user.id,
        name,
        accountCode: assetAccountCode,
        creditAccountCode: fundingAccountCode,
        purchaseDate: purchaseDateValue,
        purchaseCost: purchaseCostValue,
      });
    } catch (journalError) {
      await (prisma as any).fixedAsset.delete({ where: { id: asset.id } });
      throw journalError;
    }

    // Trigger workflow transition
    await transitionEntity('FixedAsset', asset.id, 'active', user.id, { purchaseCost: purchaseCostValue, usefulLife: usefulLifeValue });

    // Audit logging
    await logAuditAction(
      user.id, 'CREATE', 'accounting', 'FixedAsset', asset.id,
      { assetNumber: asset.assetNumber, name, purchaseCost: purchaseCostValue, fundingAccount: fundingAccountCode },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    const depreciationSchedules = await (prisma as any).depreciationSchedule.findMany({
      where: { fixedAssetId: asset.id },
      orderBy: { period: 'asc' },
    });

    return apiSuccess({ asset, depreciationSchedules, journalEntryId: journalEntry.id }, 'Fixed asset created successfully');
  } catch (error) {
    return handleApiError(error, 'Create fixed asset');
  }
}

// PUT - Update fixed asset
export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_accounting')) return apiError('ليس لديك صلاحية', 403);

    const body = await request.json();
    const { id, status, description, name, category, notes, purchaseDate, purchaseCost, usefulLife, salvageValue, accountCode, creditAccountCode } = body;

    if (!id) {
      return apiError('Fixed asset ID is required', 400);
    }

    // Check if asset exists
    const existingAsset = await (prisma as any).fixedAsset.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!existingAsset) {
      return apiError('Fixed asset not found', 404);
    }

    // Handle disposal
    if (status === 'disposed' && existingAsset.status !== 'disposed') {
      await prisma.$transaction(async (tx) => {
        // Update asset
        await (tx as any).fixedAsset.update({
          where: { id },
          data: {
            status: 'disposed',
            disposedAt: new Date(),
            disposedBy: user.id,
          },
        });

        // Create journal entry for disposal
        const journalEntry = await createJournalEntry({
          entryDate: new Date(),
          description: `Disposal of fixed asset ${existingAsset.assetNumber} - ${existingAsset.name}`,
          referenceType: 'FixedAsset',
          referenceId: existingAsset.id,
          lines: [
            {
              accountCode: existingAsset.accountCode, // Remove from fixed asset account
              debit: 0,
              credit: existingAsset.netBookValue,
              description: `Disposal of ${existingAsset.name}`,
            },
            {
              accountCode: '5020', // Loss on disposal or gain account
              debit: existingAsset.netBookValue,
              credit: 0,
              description: `Net book value of disposed asset`,
            },
          ],
        }, user.id);

        await postJournalEntry(journalEntry.id, user.id);
      });

      // Trigger workflow transition
      await transitionEntity('FixedAsset', id, 'disposed', user.id, { disposedAt: new Date() });

      // Audit logging
      await logAuditAction(
        user.id, 'DISPOSE', 'accounting', 'FixedAsset', id,
        { assetNumber: existingAsset.assetNumber },
        request.headers.get('x-forwarded-for') || undefined,
        request.headers.get('user-agent') || undefined
      );

      return apiSuccess({ id, status: 'disposed' }, 'Fixed asset disposed successfully');
    }

    const nextName = String(name || existingAsset.name).trim();
    const nextPurchaseDate = purchaseDate ? new Date(purchaseDate) : existingAsset.purchaseDate;
    const nextPurchaseCost = Number(purchaseCost ?? existingAsset.purchaseCost);
    const nextUsefulLife = parseInt(String(usefulLife ?? existingAsset.usefulLife), 10);
    const nextSalvageValue = Number(salvageValue ?? existingAsset.salvageValue ?? 0);
    const nextCategory = normalizeCategory(category);
    const nextDescription = description || buildAssetDescription(nextCategory, notes ?? parseNotesFromDescription(existingAsset.description));
    if (!nextName) return apiError('اسم الأصل مطلوب', 400);
    if (Number.isNaN(nextPurchaseDate.getTime())) return apiError('تاريخ الأصل غير صالح', 400);
    if (!Number.isFinite(nextPurchaseCost) || nextPurchaseCost <= 0) return apiError('قيمة الأصل يجب أن تكون أكبر من صفر', 400);
    if (!Number.isFinite(nextUsefulLife) || nextUsefulLife <= 0) return apiError('العمر المحاسبي غير صالح', 400);
    if (!Number.isFinite(nextSalvageValue) || nextSalvageValue < 0) return apiError('القيمة التخريدية غير صالحة', 400);
    if (nextSalvageValue > nextPurchaseCost) return apiError('القيمة التخريدية لا يمكن أن تتجاوز قيمة الأصل', 400);

    const hasPostedDepreciation = await (prisma as any).depreciationSchedule.count({
      where: { fixedAssetId: id, posted: true },
    });
    const financialFieldsChanged =
      nextPurchaseCost !== Number(existingAsset.purchaseCost) ||
      nextUsefulLife !== Number(existingAsset.usefulLife) ||
      nextSalvageValue !== Number(existingAsset.salvageValue || 0) ||
      nextPurchaseDate.getTime() !== new Date(existingAsset.purchaseDate).getTime() ||
      nextName !== existingAsset.name;

    if (hasPostedDepreciation > 0 && financialFieldsChanged) {
      return apiError('لا يمكن تعديل قيمة أو تاريخ أو عمر الأصل بعد ترحيل إهلاك عليه', 400);
    }

    const { assetAccountCode, fundingAccountCode } = await resolveAssetAccounts(
      user.tenantId!,
      accountCode || existingAsset.accountCode,
      creditAccountCode,
    );

    await prisma.$transaction(async (tx) => {
      if (financialFieldsChanged) {
        await reverseAllJournalEntriesForReferenceId(tx, user.tenantId!, id, 'FixedAsset');
      }

      await (tx as any).fixedAsset.update({
        where: { id },
        data: {
          name: nextName,
          description: nextDescription,
          accountCode: assetAccountCode,
          purchaseDate: nextPurchaseDate,
          purchaseCost: nextPurchaseCost,
          usefulLife: nextUsefulLife,
          salvageValue: nextSalvageValue,
          netBookValue: nextPurchaseCost - nextSalvageValue,
        },
      });
    });

    if (financialFieldsChanged) {
      await recreateDepreciationSchedules({
        fixedAssetId: id,
        purchaseDate: nextPurchaseDate,
        purchaseCost: nextPurchaseCost,
        usefulLife: nextUsefulLife,
        salvageValue: nextSalvageValue,
      });

      await createFixedAssetJournalEntry({
        assetId: id,
        assetNumber: existingAsset.assetNumber,
        tenantId: user.tenantId!,
        userId: user.id,
        name: nextName,
        accountCode: assetAccountCode,
        creditAccountCode: fundingAccountCode,
        purchaseDate: nextPurchaseDate,
        purchaseCost: nextPurchaseCost,
      });
    }

    const asset = await (prisma as any).fixedAsset.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    // Trigger workflow transition if status changed
    if (status && status !== existingAsset.status) {
      await transitionEntity('FixedAsset', id, status, user.id, { status });
    }

    // Audit logging
    await logAuditAction(
      user.id, 'UPDATE', 'accounting', 'FixedAsset', id,
      { body, financialFieldsChanged },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    return apiSuccess(asset, 'Fixed asset updated successfully');
  } catch (error) {
    return handleApiError(error, 'Update fixed asset');
  }
}

// DELETE - Delete fixed asset
export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!checkPermission(user, 'manage_accounting')) return apiError('ليس لديك صلاحية', 403);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError('Fixed asset ID is required', 400);
    }

    // Check if asset exists
    const asset = await (prisma as any).fixedAsset.findFirst({
      where: { id, tenantId: user.tenantId },
    });

    if (!asset) {
      return apiError('Fixed asset not found', 404);
    }

    // Prevent deletion if already disposed
    if (asset.status === 'disposed') {
      return apiError('Cannot delete a disposed fixed asset', 400);
    }

    await (prisma as any).fixedAsset.delete({
      where: { id },
    });

    // Audit logging
    await logAuditAction(
      user.id, 'DELETE', 'accounting', 'FixedAsset', id,
      {},
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined
    );

    return apiSuccess({ id }, 'Fixed asset deleted successfully');
  } catch (error) {
    return handleApiError(error, 'Delete fixed asset');
  }
}
