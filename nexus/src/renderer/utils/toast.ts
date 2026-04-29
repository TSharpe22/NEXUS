// Phase 04b §5.1 — single entry point for toasts. Wraps react-hot-toast with
// the four spec'd variants and consistent durations. Style + position are
// already configured on the global <Toaster/> in App.tsx.

import baseToast from 'react-hot-toast'

export const nx = {
  success(message: string) {
    return baseToast.success(message, { duration: 2500 })
  },
  error(message: string) {
    return baseToast.error(message, { duration: 5000 })
  },
  info(message: string) {
    return baseToast(message, { duration: 3000 })
  },
  warning(message: string) {
    return baseToast(message, {
      duration: 4000,
      icon: '⚠',
    })
  },
}
