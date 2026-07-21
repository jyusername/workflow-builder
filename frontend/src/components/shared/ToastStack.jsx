import { CheckCircleIcon, CloseIcon, ErrorIcon, InfoIcon, WarningIcon } from '../../utils/icons'

const toastMeta = {
  success: { Icon: CheckCircleIcon },
  error: { Icon: ErrorIcon },
  warning: { Icon: WarningIcon },
  info: { Icon: InfoIcon },
}

function ToastStack({ toasts, onDismiss }) {
  if (!toasts.length) return null

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => {
        const meta = toastMeta[toast.type] || toastMeta.info
        const Icon = meta.Icon

        return (
          <div className={`toast-item ${toast.type || 'info'}`} key={toast.id} role="status">
            <span className="toast-icon">
              <Icon fontSize="small" />
            </span>
            <span className="toast-copy">
              <span>{toast.message}</span>
            </span>
            <button
              className="toast-close"
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              title="Dismiss"
            >
              <CloseIcon fontSize="small" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default ToastStack
