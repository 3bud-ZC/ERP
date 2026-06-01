import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser, logAuditAction } from '@/lib/auth';
import { CODE_ENTITY_KEYS, allocateEntityCode } from '@/lib/code-sequence.service';
import { recordCashboxTransactionInTx } from '@/lib/services/cashbox.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const status = searchParams.get('status');
    const report = searchParams.get('report') === 'true';
    const type = searchParams.get('type') || undefined;
    const reference = searchParams.get('reference') || undefined;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const transactions = searchParams.get('transactions') === 'true';
    const takeParam = searchParams.get('take');
    const take = takeParam ? Math.max(1, Math.min(1000, Number(takeParam))) : undefined;

    const txFilters: Record<string, unknown> = { tenantId: user.tenantId };
    if (type) txFilters.type = type;
    if (reference) {
      txFilters.OR = [
        { referenceType: { contains: reference, mode: 'insensitive' } },
        { referenceId: { contains: reference, mode: 'insensitive' } },
        { description: { contains: reference, mode: 'insensitive' } },
      ];
    }
    if (from || to) {
      txFilters.date = {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      };
    }

    if (transactions) {
      const rows = await (prisma as any).cashboxTransaction.findMany({
        where: txFilters,
        include: { cashbox: { select: { id: true, code: true, name: true } } },
        orderBy: { date: 'desc' },
        // Keep the default smaller to avoid heavy payloads; UI can request more with ?take=...
        take: take ?? 100,
      });
      return apiSuccess({
        rows,
        summary: {
          totalInflow: rows.filter((r: { direction: string }) => r.direction === 'in').reduce((s: number, r: { amount: number }) => s + Number(r.amount || 0), 0),
          totalOutflow: rows.filter((r: { direction: string }) => r.direction === 'out').reduce((s: number, r: { amount: number }) => s + Number(r.amount || 0), 0),
          transactionCount: rows.length,
        },
      }, 'تم جلب حركات الخزنة');
    }

    if (id) {
      const txWhere: Record<string, unknown> = { ...txFilters, cashboxId: id };
      const cashbox = await (prisma as any).cashbox.findFirst({
        where: { id, tenantId: user.tenantId },
        include: {
          transactions: { where: txWhere, orderBy: { date: 'desc' }, take: 200 },
        },
      });
      if (!cashbox) return apiError('الخزنة غير موجودة', 404);
      const [inflow, outflow] = await Promise.all([
        (prisma as any).cashboxTransaction.aggregate({
          where: { cashboxId: id, tenantId: user.tenantId, direction: 'in' },
          _sum: { amount: true },
        }),
        (prisma as any).cashboxTransaction.aggregate({
          where: { cashboxId: id, tenantId: user.tenantId, direction: 'out' },
          _sum: { amount: true },
        }),
      ]);
      return apiSuccess({
        ...cashbox,
        summary: {
          totalInflow: inflow._sum.amount || 0,
          totalOutflow: outflow._sum.amount || 0,
          transactionCount: cashbox.transactions.length,
        },
      }, 'تم جلب الخزنة');
    }

    const where: Record<string, unknown> = { tenantId: user.tenantId };
    if (status) where.status = status;

    // Avoid relation includes here (can cause N+1). We add "last transaction" separately when report=true.
    const cashboxes = await (prisma as any).cashbox.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        currency: true,
        openingBalance: true,
        currentBalance: true,
        status: true,
        notes: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!report) return apiSuccess(cashboxes, 'تم جلب الخزن');

    const lastTx = await (prisma as any).cashboxTransaction.findMany({
      where: { tenantId: user.tenantId },
      // Prisma on Postgres uses DISTINCT ON here; ordering ensures latest transaction per cashbox.
      distinct: ['cashboxId'],
      orderBy: [{ cashboxId: 'asc' }, { date: 'desc' }],
      select: {
        id: true,
        cashboxId: true,
        type: true,
        direction: true,
        amount: true,
        date: true,
        description: true,
        referenceType: true,
        referenceId: true,
      },
    });
    const txByCashbox = new Map<string, any>();
    for (const t of lastTx) txByCashbox.set(t.cashboxId, t);
    const cashboxesWithLast = cashboxes.map((c: any) => ({
      ...c,
      transactions: txByCashbox.get(c.id) ? [txByCashbox.get(c.id)] : [],
    }));

    const [inflow, outflow, txCount] = await Promise.all([
      (prisma as any).cashboxTransaction.aggregate({
        where: { tenantId: user.tenantId, direction: 'in' },
        _sum: { amount: true },
      }),
      (prisma as any).cashboxTransaction.aggregate({
        where: { tenantId: user.tenantId, direction: 'out' },
        _sum: { amount: true },
      }),
      (prisma as any).cashboxTransaction.count({ where: { tenantId: user.tenantId } }),
    ]);

    return apiSuccess({
      cashboxes: cashboxesWithLast,
      summary: {
        totalBalance: cashboxes.reduce((s: number, c: { currentBalance: number }) => s + Number(c.currentBalance || 0), 0),
        totalInflow: inflow._sum.amount || 0,
        totalOutflow: outflow._sum.amount || 0,
        activeCashboxes: cashboxes.filter((c: { status: string }) => c.status === 'active').length,
        lowBalanceCount: cashboxes.filter((c: { currentBalance: number }) => Number(c.currentBalance || 0) <= 0).length,
        transactionCount: txCount,
      },
    }, 'تم جلب الخزن');
  } catch (error) {
    return handleApiError(error, 'Fetch cashboxes');
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const body = await request.json();
    const name = String(body.name || '').trim();
    if (!name) return apiError('اسم الخزنة مطلوب', 400);

    const openingBalance = Number(body.openingBalance || 0);
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      return apiError('الرصيد الافتتاحي يجب أن يكون رقماً صحيحاً', 400);
    }

    const result = await prisma.$transaction(async tx => {
      const code = body.code && String(body.code).trim()
        ? String(body.code).trim().toUpperCase()
        : await allocateEntityCode(CODE_ENTITY_KEYS.CASHBOX, user.tenantId!, tx);

      const existing = await (tx as any).cashbox.findUnique({ where: { code }, select: { id: true } });
      if (existing) throw new Error('هذا الكود مستخدم بالفعل');

      const cashbox = await (tx as any).cashbox.create({
        data: {
          code,
          name,
          currency: String(body.currency || 'EGP'),
          openingBalance,
          currentBalance: 0,
          status: body.status || 'active',
          notes: body.notes || null,
          tenantId: user.tenantId,
        },
      });

      if (openingBalance > 0) {
        await recordCashboxTransactionInTx(tx, {
          tenantId: user.tenantId!,
          cashboxId: cashbox.id,
          type: 'opening_balance',
          direction: 'in',
          amount: openingBalance,
          referenceType: 'Cashbox',
          referenceId: cashbox.id,
          description: 'رصيد افتتاحي للخزنة',
          createdBy: user.id,
        });
      }

      return (tx as any).cashbox.findUniqueOrThrow({ where: { id: cashbox.id } });
    });

    await logAuditAction(
      user.id,
      'CREATE',
      'treasury',
      'Cashbox',
      result.id,
      { cashbox: result },
      request.headers.get('x-forwarded-for') || undefined,
      request.headers.get('user-agent') || undefined,
    );

    return apiSuccess(result, 'تم إنشاء الخزنة بنجاح');
  } catch (error) {
    return handleApiError(error, 'Create cashbox');
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const body = await request.json();
    if (!body.id) return apiError('معرف الخزنة مطلوب', 400);

    const cashbox = await (prisma as any).cashbox.findFirst({
      where: { id: body.id, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!cashbox) return apiError('الخزنة غير موجودة', 404);

    const updated = await (prisma as any).cashbox.update({
      where: { id: body.id },
      data: {
        ...(body.name !== undefined && { name: String(body.name).trim() }),
        ...(body.currency !== undefined && { currency: String(body.currency || 'EGP') }),
        ...(body.status !== undefined && { status: body.status }),
        ...(body.notes !== undefined && { notes: body.notes || null }),
      },
    });

    return apiSuccess(updated, 'تم تحديث الخزنة بنجاح');
  } catch (error) {
    return handleApiError(error, 'Update cashbox');
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) return apiError('لم يتم المصادقة', 401);
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const id = new URL(request.url).searchParams.get('id');
    if (!id) return apiError('معرف الخزنة مطلوب', 400);

    const cashbox = await (prisma as any).cashbox.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true },
    });
    if (!cashbox) return apiError('الخزنة غير موجودة', 404);

    await (prisma as any).cashbox.update({
      where: { id },
      data: { status: 'inactive' },
    });

    return apiSuccess({ id, mode: 'inactive' }, 'تم إلغاء تفعيل الخزنة');
  } catch (error) {
    return handleApiError(error, 'Delete cashbox');
  }
}
