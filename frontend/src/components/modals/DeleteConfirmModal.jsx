import { CloseIcon, DeleteIcon } from '../../utils/icons'
import { displayText } from '../../utils/format'

function DeleteConfirmModal({ deleteAction, onClose, onConfirm }) {
  const targetType = deleteAction.type === 'edge' ? 'Connection' : 'Script'
  const targetName = displayText(deleteAction.labels?.[0], deleteAction.type === 'edge' ? 'this connection' : 'this script')

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="project-modal compact-modal delete-confirm-modal" role="dialog" aria-modal="true">
        <div className="modal-header delete-confirm-header">
          <div className="delete-confirm-title-row">
            <span className="delete-confirm-mark">
              <DeleteIcon />
            </span>
            <div>
              <span className="eyebrow">Confirm delete</span>
              <h2>Delete {targetType.toLowerCase()}</h2>
            </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close modal">
            <CloseIcon fontSize="small" />
          </button>
        </div>

        <div className="delete-confirm-card">
          <span>{targetType}</span>
          <strong title={targetName}>{targetName}</strong>
        </div>

        <p className="modal-copy delete-confirm-copy">
          {deleteAction.type === 'edge'
            ? 'This connection will be removed from the canvas.'
            : 'This removes the script from the script list and the canvas.'}
        </p>

        <div className="modal-actions delete-confirm-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="delete-confirm-button" type="button" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export default DeleteConfirmModal
