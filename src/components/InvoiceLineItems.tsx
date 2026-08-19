"use client"

import { Plus, Trash2 } from "lucide-react"
import { useCallback, useLayoutEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"

const BUSINESS_AREAS = [
  { value: "CREATIVE", label: "Creative" },
  { value: "DEVELOPMENT", label: "Development" },
  { value: "SUPPORT", label: "Support" },
] as const

export const DEFAULT_BUSINESS_AREA = "DEVELOPMENT"

export type InvoiceLineItemDraft = {
  id: number
  description: string
  quantity: string
  unitPrice: string
  agencyCommission: string
  businessArea: string
}

export function blankInvoiceLineItem(id: number): InvoiceLineItemDraft {
  return {
    id,
    description: "",
    quantity: "1",
    unitPrice: "",
    agencyCommission: "0",
    businessArea: DEFAULT_BUSINESS_AREA,
  }
}

function AutoGrowTextarea({
  name,
  id,
  placeholder,
  value,
  onChange,
}: {
  name: string
  id: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useLayoutEffect(() => {
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [fit, value])

  return (
    <textarea
      ref={ref}
      id={id}
      name={name}
      rows={1}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="flex min-h-10 w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
    />
  )
}

export function InvoiceLineItems({
  items,
  showAgency,
  onShowAgencyChange,
  onAddItem,
  onRemoveItem,
  onChangeItem,
}: {
  items: InvoiceLineItemDraft[]
  showAgency: boolean
  onShowAgencyChange: (show: boolean) => void
  onAddItem: () => void
  onRemoveItem: (id: number) => void
  onChangeItem: (id: number, patch: Partial<InvoiceLineItemDraft>) => void
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-gray-700">Line Items</h3>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={showAgency}
            onChange={(event) => onShowAgencyChange(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Show agency commission
        </label>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={item.id} className="space-y-3 rounded-md border p-3">
            <div>
              <label htmlFor={`invoice-description-${item.id}`} className="mb-1 block text-xs text-gray-500">
                Description
              </label>
              <AutoGrowTextarea
                id={`invoice-description-${item.id}`}
                name="description[]"
                placeholder="Item description"
                value={item.description}
                onChange={(description) => onChangeItem(item.id, { description })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-12 sm:items-end">
              <div className="sm:col-span-2">
                <label htmlFor={`invoice-quantity-${item.id}`} className="mb-1 block text-xs text-gray-500">
                  Qty
                </label>
                <Input
                  id={`invoice-quantity-${item.id}`}
                  name="quantity[]"
                  type="number"
                  step="0.01"
                  value={item.quantity}
                  onChange={(event) => onChangeItem(item.id, { quantity: event.target.value })}
                />
              </div>
              <div className="sm:col-span-3">
                <label htmlFor={`invoice-rate-${item.id}`} className="mb-1 block text-xs text-gray-500">
                  Rate
                </label>
                <Input
                  id={`invoice-rate-${item.id}`}
                  name="unitPrice[]"
                  type="text"
                  placeholder="0.00"
                  value={item.unitPrice}
                  onChange={(event) => onChangeItem(item.id, { unitPrice: event.target.value })}
                />
              </div>
              <div className={showAgency ? "sm:col-span-2" : "hidden"}>
                <label htmlFor={`invoice-agency-${item.id}`} className="mb-1 block text-xs text-gray-500">
                  Agency %
                </label>
                <Input
                  id={`invoice-agency-${item.id}`}
                  name="agencyCommission[]"
                  type="number"
                  step="0.1"
                  value={item.agencyCommission}
                  onChange={(event) => onChangeItem(item.id, { agencyCommission: event.target.value })}
                />
              </div>
              <div className={showAgency ? "sm:col-span-4" : "sm:col-span-6"}>
                <label htmlFor={`invoice-area-${item.id}`} className="mb-1 block text-xs text-gray-500">
                  Business Area
                </label>
                <Select
                  id={`invoice-area-${item.id}`}
                  name="businessArea[]"
                  value={item.businessArea}
                  onChange={(event) => onChangeItem(item.id, { businessArea: event.target.value })}
                >
                  {BUSINESS_AREAS.map((area) => (
                    <option key={area.value} value={area.value}>
                      {area.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-2 flex justify-end sm:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="px-2 text-slate-500"
                  onClick={() => onRemoveItem(item.id)}
                  disabled={items.length <= 1}
                  aria-label={`Remove item ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={onAddItem}>
        <Plus className="mr-1.5 h-4 w-4" />
        Add a new item
      </Button>
    </div>
  )
}
