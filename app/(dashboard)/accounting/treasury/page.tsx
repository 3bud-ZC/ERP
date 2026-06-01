import { AccountingLayout } from '@/components/accounting/AccountingLayout';
import { AccountingQuickNav } from '@/components/accounting/AccountingQuickNav';
import { TreasuryHubPageContent } from '@/components/treasury/TreasuryHubPageContent';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function AccountingTreasuryPage() {
  return (
    <AccountingLayout
      title="الخزنة"
      subtitle="الخزن + الحركات + التحليلات في شاشة واحدة"
    >
      <TreasuryHubPageContent />
      <AccountingQuickNav />
    </AccountingLayout>
  );
}
