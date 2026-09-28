"use client"

import { Button } from "./ui/button"
import { useEffect, useId, useRef } from "react"
import { createPortal } from "react-dom"

export function ConfirmModal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "danger",
}: {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: "primary" | "danger"
}) {
  const dialog=useRef<HTMLDialogElement>(null)
  const titleId=useId(),messageId=useId()
  useEffect(()=>{
    if(!open) return
    const previous=document.activeElement as HTMLElement|null
    const element=dialog.current
    element?.showModal()
    const overflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    return ()=>{element?.close();document.body.style.overflow=overflow;previous?.focus()}
  },[open])
  if (!open) return null
  return createPortal(
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={messageId} onCancel={e=>{e.preventDefault();onCancel()}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onCancel()}}} className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border-0 bg-white p-6 text-left text-slate-950 shadow-xl backdrop:bg-slate-950/50">
        <h3 id={titleId} className="text-lg font-semibold">{title}</h3>
        <p id={messageId} className="mt-2 whitespace-normal text-sm leading-6 text-slate-600">{message}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button type="button" autoFocus variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={confirmVariant} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
    </dialog>, document.body)
}
