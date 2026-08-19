export const INVOICE_STATUSES = ['draft','sent','viewed','partial','paid','overdue','cancelled','written_off'] as const
export const PAYMENT_METHODS = ['bank_transfer','cash','card','cheque','paypal','stripe','other'] as const
export const DEFAULT_PAYMENT_METHOD = PAYMENT_METHODS[0]
export const MARK_PAID_ELIGIBLE_STATUSES = ['sent', 'viewed', 'partial', 'overdue'] as const
export const EXPENSE_PAYMENT_METHODS = ['bank_transfer','cash','card','cheque','paypal','credit_card','other'] as const
export const VAT_RATES = [{ label: 'Standard 20%', value: 20 }, { label: 'Reduced 5%', value: 5 }, { label: 'Zero 0%', value: 0 }, { label: 'Exempt', value: -1 }] as const
export const QUOTE_STATUSES = ['draft','sent','accepted','rejected','converted','expired'] as const
export const RECURRING_FREQUENCIES = [{ label: 'Weekly', value: 'weekly' }, { label: 'Monthly', value: 'monthly' }, { label: 'Quarterly', value: 'quarterly' }, { label: 'Yearly', value: 'yearly' }] as const
export const EXPENSE_CATEGORIES = [
  { name: 'Advertising', color: '#F59E0B' }, { name: 'Bank Charges', color: '#6B7280' }, { name: 'Computer Equipment', color: '#3B82F6' },
  { name: 'Insurance', color: '#10B981' }, { name: 'Legal & Professional', color: '#8B5CF6' }, { name: 'Meals & Entertainment', color: '#EF4444' },
  { name: 'Office Rent', color: '#6366F1' }, { name: 'Office Supplies', color: '#14B8A6' }, { name: 'Phone & Internet', color: '#0EA5E9' },
  { name: 'Postage & Shipping', color: '#F97316' }, { name: 'Professional Development', color: '#84CC16' },
  { name: 'Salaries & Wages', color: '#A855F7' }, { name: 'Software & Subscriptions', color: '#06B6D4' },
  { name: 'Travel & Transport', color: '#EC4899' }, { name: 'Utilities', color: '#64748B' }, { name: 'VAT', color: '#D946EF' }, { name: 'Other', color: '#9CA3AF' },
] as const
