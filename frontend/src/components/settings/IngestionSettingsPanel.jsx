import { useEffect, useState } from 'react'

import { validateIngestionSettings } from '../../config/scriptSettingsSchemas'
import { parseListInput } from '../../utils/format'

function normalizeSettings(settings) {
  return {
    source_type: 'local_path',
    source_dir: '',
    credentials_file: '',
    nonbdo_matrix: '',
    bdo_matrix: '',
    cloud_provider: 'Google Cloud Storage',
    cloud_bucket: '',
    cloud_prefix: '',
    cloud_credentials_ref: '',
    valid_extensions: [],
    skip_name_contains: [],
    bucket_name: '',
    sandbox_prefix: '',
    dry_run: true,
    upload_target: 'gcs',
    local_output_dir: '',
    local_overwrite: true,
    upload_workers: 8,
    ...(settings || {}),
  }
}

function IngestionSettingsPanel({ settings, onClose, onSave }) {
  const [draft, setDraft] = useState(() => normalizeSettings(settings))
  const [errors, setErrors] = useState({})
  const [shouldValidateLive, setShouldValidateLive] = useState(false)
  const [listDrafts, setListDrafts] = useState({})
  const [activeTab, setActiveTab] = useState('source')
  const isCloud = draft.source_type === 'cloud'
  const isLocalDelivery = draft.upload_target === 'local'
  const needsCredentialsFile = !isLocalDelivery

  useEffect(() => {
    setDraft(normalizeSettings(settings))
    setErrors({})
    setShouldValidateLive(false)
    setListDrafts({})
  }, [settings])

  useEffect(() => {
    if (shouldValidateLive) {
      setErrors(validateIngestionSettings(draft))
    }
  }, [draft, shouldValidateLive])

  function update(changes) {
    setDraft((current) => ({ ...current, ...changes }))
  }

  function saveSettings() {
    const nextErrors = validateIngestionSettings(draft)
    setErrors(nextErrors)
    setShouldValidateLive(true)
    if (Object.keys(nextErrors).length > 0) return
    onSave(draft)
  }

  function fieldError(key) {
    return errors[key] || ''
  }

  function renderFieldMeta(key) {
    const error = fieldError(key)
    return error ? <span className="settings-error">{error}</span> : null
  }

  function isRequired(key) {
    return Boolean(fieldError(key))
  }

  function labelText(label, key) {
    return (
      <span className="settings-label-text">
        {label}
        {isRequired(key) && <span className="required-mark">Required</span>}
      </span>
    )
  }

  function listValue(key) {
    if (Object.prototype.hasOwnProperty.call(listDrafts, key)) {
      return listDrafts[key]
    }
    return (draft[key] || []).join('\n')
  }

  function updateList(key, value) {
    setListDrafts((current) => ({ ...current, [key]: value }))
    update({ [key]: parseListInput(value) })
  }

  function clearListDraft(key) {
    setListDrafts((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  const tabs = [
    {
      id: 'source',
      label: 'Source',
      summary: isCloud ? 'Cloud input' : draft.source_dir ? 'Folder set' : 'Needs folder',
    },
    {
      id: 'destination',
      label: 'Destination',
      summary: isLocalDelivery
        ? draft.local_output_dir
          ? 'Local drive'
          : 'Needs folder'
        : draft.bucket_name
          ? (draft.dry_run ? 'Dry run' : 'Cloud delivery')
          : 'Needs target',
    },
    {
      id: 'scanner',
      label: 'Scanner',
      summary: `${(draft.valid_extensions || []).length} extensions`,
    },
  ]

  const tabHasError = {
    source: [
      'source_dir',
      'cloud_bucket',
      ...(needsCredentialsFile ? ['credentials_file'] : []),
      'nonbdo_matrix',
      'bdo_matrix',
    ].some(fieldError),
    scanner: ['valid_extensions', 'skip_name_contains'].some(fieldError),
    destination: ['bucket_name', 'local_output_dir', 'sandbox_prefix', 'dry_run'].some(fieldError),
  }

  return (
    <div className="ingestion-settings-panel">
      <div className="settings-tabbar" role="tablist" aria-label="Ingestion settings categories">
        {tabs.map((tab) => (
          <button
            className={`${activeTab === tab.id ? 'active' : ''} ${tabHasError[tab.id] ? 'has-error' : ''}`}
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            <span>{tab.label}</span>
            <small>{tab.summary}</small>
          </button>
        ))}
      </div>

      <div className="settings-workspace-grid tabbed">
        {activeTab === 'source' && (
        <section className="settings-card">
          <div className="settings-card-heading">
            <span>Source</span>
            <p>Choose where ingestion reads files from. The visible fields change based on the source type.</p>
          </div>

          <div className="settings-source-toggle">
            <button
              className={isCloud ? '' : 'active'}
              type="button"
              onClick={() => update({ source_type: 'local_path' })}
            >
              Local
            </button>
            <button
              className={isCloud ? 'active' : ''}
              type="button"
              onClick={() => update({ source_type: 'cloud' })}
            >
              Cloud
            </button>
          </div>

          {isCloud ? (
            <div className="settings-form-grid">
              <label className="settings-field">
                {labelText('Cloud Provider', 'cloud_provider')}
                <input
                  value={draft.cloud_provider || ''}
                  aria-invalid={Boolean(fieldError('cloud_provider'))}
                  onChange={(event) => update({ cloud_provider: event.target.value })}
                  placeholder="Google Cloud Storage"
                />
                {renderFieldMeta('cloud_provider')}
              </label>
              <label className="settings-field">
                {labelText('Cloud Bucket', 'cloud_bucket')}
                <input
                  value={draft.cloud_bucket || ''}
                  aria-invalid={Boolean(fieldError('cloud_bucket'))}
                  onChange={(event) => update({ cloud_bucket: event.target.value })}
                  placeholder="Source bucket"
                />
                {renderFieldMeta('cloud_bucket')}
              </label>
              <label className="settings-field">
                {labelText('Cloud Prefix', 'cloud_prefix')}
                <input
                  value={draft.cloud_prefix || ''}
                  aria-invalid={Boolean(fieldError('cloud_prefix'))}
                  onChange={(event) => update({ cloud_prefix: event.target.value })}
                  placeholder="Optional folder/prefix"
                />
                {renderFieldMeta('cloud_prefix')}
              </label>
              <label className="settings-field">
                {labelText('Credentials Reference', 'cloud_credentials_ref')}
                <input
                  value={draft.cloud_credentials_ref || ''}
                  aria-invalid={Boolean(fieldError('cloud_credentials_ref'))}
                  onChange={(event) => update({ cloud_credentials_ref: event.target.value })}
                  placeholder="Credential reference"
                />
                {renderFieldMeta('cloud_credentials_ref')}
              </label>
            </div>
          ) : (
            <div className="settings-form-grid">
              <label className="settings-field">
                {labelText('Source Folder', 'source_dir')}
                <input
                  value={draft.source_dir || ''}
                  aria-invalid={Boolean(fieldError('source_dir'))}
                  onChange={(event) => update({ source_dir: event.target.value })}
                  placeholder="Source folder path"
                />
                {renderFieldMeta('source_dir')}
              </label>
              {needsCredentialsFile && (
                <label className="settings-field">
                  {labelText('Credentials File', 'credentials_file')}
                  <input
                    value={draft.credentials_file || ''}
                    aria-invalid={Boolean(fieldError('credentials_file'))}
                    onChange={(event) => update({ credentials_file: event.target.value })}
                    placeholder="Credential file path"
                  />
                  {renderFieldMeta('credentials_file')}
                </label>
              )}
              <label className="settings-field">
                {labelText('Non-BDO Matrix', 'nonbdo_matrix')}
                <input
                  value={draft.nonbdo_matrix || ''}
                  aria-invalid={Boolean(fieldError('nonbdo_matrix'))}
                  onChange={(event) => update({ nonbdo_matrix: event.target.value })}
                  placeholder="Matrix file path"
                />
                {renderFieldMeta('nonbdo_matrix')}
              </label>
              <label className="settings-field">
                {labelText('BDO Matrix', 'bdo_matrix')}
                <input
                  value={draft.bdo_matrix || ''}
                  aria-invalid={Boolean(fieldError('bdo_matrix'))}
                  onChange={(event) => update({ bdo_matrix: event.target.value })}
                  placeholder="Matrix file path"
                />
                {renderFieldMeta('bdo_matrix')}
              </label>
            </div>
          )}
        </section>
        )}

        {activeTab === 'scanner' && (
        <section className="settings-card">
          <div className="settings-card-heading">
            <span>File Discovery</span>
            <p>These values update the scanner script.</p>
          </div>
          <div className="settings-form-grid two-column">
            <label className="settings-field">
              {labelText('Valid Extensions', 'valid_extensions')}
              <textarea
                value={listValue('valid_extensions')}
                aria-invalid={Boolean(fieldError('valid_extensions'))}
                onChange={(event) => updateList('valid_extensions', event.target.value)}
                onBlur={() => clearListDraft('valid_extensions')}
                placeholder=".csv&#10;.xlsx&#10;.zip"
              />
              {renderFieldMeta('valid_extensions')}
            </label>
            <label className="settings-field">
              {labelText('Skip Names Containing', 'skip_name_contains')}
              <textarea
                value={listValue('skip_name_contains')}
                aria-invalid={Boolean(fieldError('skip_name_contains'))}
                onChange={(event) => updateList('skip_name_contains', event.target.value)}
                onBlur={() => clearListDraft('skip_name_contains')}
                placeholder="cm.bdo"
              />
              {renderFieldMeta('skip_name_contains')}
            </label>
          </div>
        </section>
        )}

        {activeTab === 'destination' && (
        <section className="settings-card">
          <div className="settings-card-heading">
            <span>Destination</span>
            <p>Set the target path options and choose whether delivery previews or sends files.</p>
          </div>

          <div className="settings-source-toggle">
            <button
              className={isLocalDelivery ? 'active' : ''}
              type="button"
              onClick={() => update({ upload_target: 'local' })}
            >
              Local
            </button>
            <button
              className={isLocalDelivery ? '' : 'active'}
              type="button"
              onClick={() => update({ upload_target: 'gcs' })}
            >
              Cloud
            </button>
          </div>

          <div className="settings-form-grid two-column">
            {isLocalDelivery ? (
              <>
                <label className="settings-field">
                  {labelText('Local Output Folder', 'local_output_dir')}
                  <input
                    value={draft.local_output_dir || ''}
                    aria-invalid={Boolean(fieldError('local_output_dir'))}
                    onChange={(event) => update({ local_output_dir: event.target.value })}
                    placeholder="Example: C:\\Ingestion_Output"
                  />
                  <span className="settings-help">Use a full folder path, for example C:\Ingestion_Output or C:/Ingestion_Output.</span>
                  {renderFieldMeta('local_output_dir')}
                </label>
                <label className="settings-toggle compact-toggle settings-option-tile">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.local_overwrite)}
                    onChange={(event) => update({ local_overwrite: event.target.checked })}
                  />
                  <span>
                    Overwrite Existing Files
                    <small>Replace local files when the same destination already exists.</small>
                  </span>
                </label>
              </>
            ) : (
            <label className="settings-field">
              {labelText('Cloud Bucket', 'bucket_name')}
              <input
                value={draft.bucket_name || ''}
                aria-invalid={Boolean(fieldError('bucket_name'))}
                onChange={(event) => update({ bucket_name: event.target.value })}
                placeholder="Example: sm-bronze"
              />
              {renderFieldMeta('bucket_name')}
            </label>
            )}
            <label className="settings-field">
              {labelText('Sandbox Prefix', 'sandbox_prefix')}
              <input
                value={draft.sandbox_prefix || ''}
                aria-invalid={Boolean(fieldError('sandbox_prefix'))}
                onChange={(event) => update({ sandbox_prefix: event.target.value })}
                placeholder="Optional destination prefix"
              />
                {renderFieldMeta('sandbox_prefix')}
            </label>
            <label className="settings-toggle compact-toggle settings-option-tile">
              <input
                type="checkbox"
                checked={Boolean(draft.dry_run)}
                onChange={(event) => update({ dry_run: event.target.checked })}
              />
              <span>
                Dry Run
                <small>Preview delivery actions without copying or uploading files.</small>
              </span>
            </label>
          </div>
        </section>
        )}
      </div>

      <div className="settings-workspace-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="primary" type="button" onClick={saveSettings}>
          Save Settings
        </button>
      </div>
    </div>
  )
}

export default IngestionSettingsPanel
