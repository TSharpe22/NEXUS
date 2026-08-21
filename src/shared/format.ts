/**
 * Small formatters shared between views.
 *
 * Here rather than private to a view because the second copy is the problem:
 * two panels rounding the same number differently is the kind of thing nobody
 * files a bug about and everybody notices.
 */

/** Bytes, at the precision a person reading a panel actually wants. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
