export function toArabicError(error: unknown, fallback = 'حدث خطأ غير متوقع، حاول مرة أخرى'): string {
  const raw =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '')
        : String(error ?? '');
  const msg = raw.toLowerCase();

  if (!raw || raw === '[object Object]') return fallback;
  if (msg.includes('invalid status transition')) return 'لا يمكن نقل الحالة بهذه الطريقة. اتبع تسلسل حالة أمر الإنتاج الصحيح.';
  if (msg.includes('insufficient stock') || msg.includes('stock update failed')) return 'الكمية غير متوفرة في المخزون';
  if (msg.includes('cost layer') || msg.includes('insufficient cost')) return 'لا يمكن إتمام العملية بسبب نقص تكلفة المخزون';
  if (msg.includes('unique') || msg.includes('p2002') || msg.includes('duplicate')) return 'هذا الكود مستخدم بالفعل';
  if (msg.includes('unauthorized') || msg.includes('not authenticated')) return 'لم يتم تسجيل الدخول';
  if (msg.includes('forbidden') || msg.includes('permission')) return 'ليس لديك صلاحية لتنفيذ هذا الإجراء';
  if (msg.includes('not found') || msg.includes('p2025')) return 'العنصر المطلوب غير موجود';
  if (msg.includes('foreign key') || msg.includes('p2003')) return 'لا يمكن تنفيذ العملية لوجود بيانات مرتبطة';
  if (msg.includes('amount must be positive')) return 'المبلغ يجب أن يكون أكبر من صفر';
  if (msg.includes('exceeds outstanding') || msg.includes('overpayment')) return 'المبلغ المدفوع يتجاوز المتبقي على الفاتورة';
  if (msg.includes('cashbox')) return 'يجب اختيار خزنة صالحة عند تسجيل مبلغ نقدي';
  if (msg.includes('warehouse')) return 'يجب اختيار مستودع قبل إتمام العملية';
  if (msg.includes('output quantity')) return 'كمية الإنتاج الفعلية يجب أن تكون أكبر من صفر';
  if (msg.includes('wip record missing')) return 'بيانات تكلفة أمر الإنتاج غير مكتملة';
  if (msg.includes('production order not found')) return 'أمر الإنتاج غير موجود';
  if (msg.includes('order already completed')) return 'أمر الإنتاج مكتمل بالفعل';
  if (msg.includes('allocation amounts must equal payment amount')) return 'إجمالي توزيعات الدفع يجب أن يساوي مبلغ الدفع';
  if (msg.includes('payment must be linked')) return 'يجب ربط الدفع بفاتورة واحدة على الأقل';
  if (msg.includes('must have at least one item')) return 'يجب أن تحتوي الفاتورة على صنف واحد على الأقل';
  if (msg.includes('paid amount cannot exceed') || msg.includes('cannot exceed invoice total')) return 'المبلغ المدفوع لا يمكن أن يتجاوز إجمالي الفاتورة';

  // If the message already appears Arabic, keep it.
  if (/[\u0600-\u06FF]/.test(raw)) return raw;
  return fallback;
}
