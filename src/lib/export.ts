export function exportToCSV(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (val: unknown) => { const str = String(val ?? ''); if (str.includes(',') || str.includes('"') || str.includes('\n')) return `\"${str.replace(/"/g, '""')}\"`; return str }
  return [headers.map(escape).join(','), ...rows.map(row => row.map(escape).join(','))].join('\n')
}
export function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
