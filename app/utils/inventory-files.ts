// Display helpers for the inventory files page (ADR 0033).

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const

/** "4,2 MB" / "4.2 MB": the largest unit that keeps the number at 1 or more, in the interface language. */
export function formatBytes(bytes: number, locale: string): string {
  let unit = 0
  let value = Math.max(0, bytes)
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: BYTE_UNITS[unit]!,
    unitDisplay: 'short',
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value)
}

const SPREADSHEET_EXTENSIONS = new Set(['xlsx', 'xls', 'ods', 'csv'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'])

/** The Lucide icon for a file, by its extension. */
export function fileIcon(name: string): string {
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  if (SPREADSHEET_EXTENSIONS.has(extension)) {
    return 'i-lucide-file-spreadsheet'
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'i-lucide-file-image'
  }
  if (extension === 'pdf' || extension === 'txt' || extension === 'docx') {
    return 'i-lucide-file-text'
  }
  return 'i-lucide-file'
}
