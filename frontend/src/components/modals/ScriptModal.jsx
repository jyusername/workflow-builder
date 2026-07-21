import { lazy, Suspense } from 'react'

import ConfigSettingsEditor from '../settings/ConfigSettingsEditor'
import { CloseIcon } from '../../utils/icons'

const CodeEditor = lazy(() => import('../shared/CodeEditor'))

function ScriptModal({
  mode,
  scriptId,
  label,
  script,
  config,
  configErrors,
  isSaving,
  submitDisabled,
  onLabelChange,
  onScriptChange,
  onConfigChange,
  onClose,
  onSubmit,
  dependencyOptions = [],
  dependencyIds = [],
  onToggleDependency,
}) {
  const isEdit = mode === 'edit'
  const availableDependencies = dependencyOptions.filter((scriptItem) => scriptItem.id !== scriptId)
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="project-modal script-modal" onSubmit={onSubmit}>
        <div className="modal-header script-modal-header">
          <div>
            <span className="eyebrow">Script</span>
            <h2>{isEdit ? `Edit ${label || 'script'}` : 'Add script'}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close modal">
            <CloseIcon fontSize="small" />
          </button>
        </div>

        <div className="script-modal-body">
          <section className="script-basics-panel">
            <label className="script-label-field">
              Label
              <input
                value={label}
                onChange={(event) => onLabelChange(event.target.value)}
                required
                autoFocus
                placeholder="Example: Load Data"
              />
            </label>

            {isEdit && (
              <div className="dependency-settings">
                <div className="dependency-settings-header">
                  <div>
                    <span className="editor-label">Dependencies</span>
                    <p>Scripts that must finish before this one runs.</p>
                  </div>
                </div>

                {availableDependencies.length === 0 ? (
                  <div className="dependency-empty">No other scripts are available yet.</div>
                ) : (
                  <div className="dependency-toggle-list">
                    {availableDependencies.map((scriptItem) => {
                      const isSelected = dependencyIds.includes(scriptItem.id)
                      return (
                        <button
                          className={`dependency-toggle ${isSelected ? 'selected' : ''}`}
                          type="button"
                          key={scriptItem.id}
                          onClick={() => onToggleDependency?.(scriptItem.id)}
                        >
                          <span>{scriptItem.label || scriptItem.id}</span>
                          <span className="dependency-switch" aria-hidden="true">
                            <span />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </section>

          <div className="script-modal-grid">
            <div className="editor-field">
              <span className="editor-label">Python script</span>
              <Suspense fallback={<div className="code-editor-loading">Loading editor...</div>}>
                <CodeEditor value={script} language="python" height="100%" onChange={onScriptChange} />
              </Suspense>
            </div>

            <div className="editor-field script-settings-column">
              <span className="editor-label">Script settings</span>
              <ConfigSettingsEditor
                scriptId={scriptId}
                scriptLabel={label}
                value={config}
                onChange={onConfigChange}
                errors={configErrors}
                emptyMessage="No settings yet. You can add settings later by editing this script."
              />
            </div>
          </div>
        </div>

        <div className="modal-actions script-modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit" disabled={submitDisabled}>
            {isSaving ? (isEdit ? 'Saving' : 'Adding') : isEdit ? 'Save Script' : 'Add Script'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default ScriptModal
