'use client';

import { ProductForm } from '@/components/products/ProductForm';

export default function NewFinishedProductPage() {
  return (
    <ProductForm
      mode="create"
      lockedType="finished_product"
      backHref="/inventory/finished-products"
      listHref="/inventory/finished-products"
    />
  );
}
