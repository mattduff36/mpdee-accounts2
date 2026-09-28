'use client'
import { useFormStatus } from 'react-dom'
import { buttonClass } from '../ui'
export function AssignButton({count}:{count:number}) {
  const {pending}=useFormStatus()
  return <button disabled={pending} className={`${buttonClass} self-end disabled:opacity-50`}>{pending?'Saving assignment…':`Assign ${count===1?'event':`${count} events`}`}</button>
}
