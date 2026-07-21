import { useCallback, useState } from 'react'

function useToast() {
  const [toasts, setToasts] = useState([])

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const notify = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((current) => [...current.slice(-3), { id, message, type }])
    window.setTimeout(() => dismissToast(id), 6000)
  }, [dismissToast])

  return { dismissToast, notify, toasts }
}

export default useToast
