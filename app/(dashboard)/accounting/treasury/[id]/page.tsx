import { CashboxDetailPageContent } from '@/components/treasury/CashboxDetailPageContent';

export const dynamic = 'force-dynamic';

export default function AccountingCashboxDetailPage({ params }: { params: { id: string } }) {
  return <CashboxDetailPageContent id={params.id} basePath="/accounting/treasury" />;
}
