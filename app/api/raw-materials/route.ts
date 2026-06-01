import { prisma } from '@/lib/db';
import { apiSuccess, handleApiError, apiError } from '@/lib/api-response';
import { getAuthenticatedUser, checkPermission } from '@/lib/auth';
import { CODE_ENTITY_KEYS, allocateEntityCode } from '@/lib/code-sequence.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET - Read raw materials
export async function GET(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const materials = await prisma.product.findMany({
      where: { tenantId: user.tenantId, type: 'raw_material', isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    
    return apiSuccess(materials, 'Raw materials fetched successfully');
  } catch (error) {
    return handleApiError(error, 'Fetch raw materials');
  }
}

// POST - Create raw material
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }
    if (!checkPermission(user, 'create_product')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const body = await request.json();
    const { code: _ignoredCode, nameAr, nameEn, unit, cost, stock, minStock, category, description } = body;

    if (!nameAr || !unit) {
      return apiError('الاسم والوحدة مطلوبان', 400);
    }

    if (!user.tenantId) {
      return apiError('لم يتم تعيين مستأجر للمستخدم', 400);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: user.tenantId },
      include: { _count: { select: { products: true } } },
    });
    if (!tenant || tenant.status !== 'active') {
      return apiError('حساب الشركة غير نشط', 403);
    }
    if (tenant._count.products >= tenant.maxProducts) {
      return apiError(`تم الوصول للحد الأقصى للمنتجات في خطة العميل (${tenant.maxProducts})`, 409);
    }

    const resolvedCode = await allocateEntityCode(CODE_ENTITY_KEYS.RAW_MATERIAL, user.tenantId);

    // @ts-ignore - Prisma type mismatch - tenant relation not in generated types
    const material = await prisma.product.create({
      data: {
        code: resolvedCode,
        nameAr,
        nameEn: nameEn || null,
        type: 'raw_material',
        unit,
        price: 0,
        cost: parseFloat(cost) || 0,
        stock: parseFloat(stock) || 0,
        minStock: parseFloat(minStock) || 0,
        tenant: { connect: { id: user.tenantId } },
      },
    });

    return apiSuccess(material, 'تم إنشاء المادة الخام بنجاح');
  } catch (error) {
    return handleApiError(error, 'Create raw material');
  }
}

// PUT - Update raw material
export async function PUT(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }
    if (!checkPermission(user, 'update_product')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const body = await request.json();
    const { id, code: _ignoredCode, nameAr, nameEn, unit, cost, stock, minStock, category, description } = body;

    if (!id) {
      return apiError('معرف المادة الخام مطلوب', 400);
    }
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const existing = await prisma.product.findFirst({
      where: { id, tenantId: user.tenantId, type: 'raw_material' },
      select: { id: true },
    });
    if (!existing) return apiError('المادة الخام غير موجودة', 404);

    const material = await prisma.product.update({
      where: { id },
      data: {
        ...(nameAr && { nameAr }),
        ...(nameEn !== undefined && { nameEn: nameEn || null }),
        ...(unit && { unit }),
        ...(cost !== undefined && { cost: parseFloat(cost) }),
        ...(stock !== undefined && { stock: parseFloat(stock) }),
        ...(minStock !== undefined && { minStock: parseFloat(minStock) }),
      },
    });

    return apiSuccess(material, 'تم تحديث المادة الخام بنجاح');
  } catch (error) {
    return handleApiError(error, 'Update raw material');
  }
}

// DELETE - Delete raw material
export async function DELETE(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!user) {
      return apiError('لم يتم المصادقة', 401);
    }
    if (!checkPermission(user, 'delete_product')) {
      return apiError('ليس لديك صلاحية للقيام بهذا الإجراء', 403);
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError('معرف المادة الخام مطلوب', 400);
    }
    if (!user.tenantId) return apiError('لم يتم تعيين مستأجر للمستخدم', 400);

    const existing = await prisma.product.findFirst({
      where: { id, tenantId: user.tenantId, type: 'raw_material' },
      select: { id: true },
    });
    if (!existing) return apiError('المادة الخام غير موجودة', 404);

    // Check if material is used in any BOM
    const bomCount = await prisma.bOMItem.count({
      where: { materialId: id, product: { tenantId: user.tenantId } },
    });

    if (bomCount > 0) {
      return apiError('لا يمكن حذف المادة الخام لأنها مستخدمة في قوائم المواد', 400);
    }

    await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    return apiSuccess({ id, mode: 'soft' }, 'تم إلغاء تفعيل المادة الخام بنجاح');
  } catch (error) {
    return handleApiError(error, 'Delete raw material');
  }
}
