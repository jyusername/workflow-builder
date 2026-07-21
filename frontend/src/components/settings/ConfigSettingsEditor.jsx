import { useState } from 'react'

import {
  cloudSourceKeys,
  getFieldSchema,
  getOrderedConfigEntries,
  getScriptSettingsSchema,
  hiddenConfigKeys,
  localSourceKeys,
} from '../../config/scriptSettingsSchemas'
import { displayText, parseListInput, toTitleLabel } from '../../utils/format'

function updateConfigPath(config, path, value) {
  if (!path.length) return value
  const [head, ...rest] = path
  return {
    ...(config || {}),
    [head]: rest.length ? updateConfigPath(config?.[head] || {}, rest, value) : value,
  }
}

function fieldLabel(key, schema) {
  return schema.label || toTitleLabel(key)
}

function ConfigSettingsEditor({
  scriptId,
  scriptLabel,
  value,
  onChange,
  errors = {},
  emptyMessage = 'This script has no custom settings yet.',
}) {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const [draftLists, setDraftLists] = useState({})
  const scriptSchema = getScriptSettingsSchema({ id: scriptId, label: scriptLabel })
  const hasSourceType = Object.prototype.hasOwnProperty.call(config, 'source_type')
  const sourceType = config.source_type === 'cloud' ? 'cloud' : 'local_path'
  const entries = getOrderedConfigEntries(config, scriptSchema).filter(([key]) => {
    if (hiddenConfigKeys.has(key) || key === 'source_type') return false
    if (hasSourceType && (localSourceKeys.has(key) || cloudSourceKeys.has(key))) return false
    if (Object.prototype.hasOwnProperty.call(config, 'upload_target')) {
      const uploadTarget = config.upload_target === 'local' ? 'local' : 'gcs'
      if (uploadTarget === 'local' && (key === 'bucket_name' || key === 'upload_workers')) return false
      if (uploadTarget !== 'local' && (key === 'local_output_dir' || key === 'local_overwrite')) return false
    }
    return true
  })

  function updateField(path, nextValue) {
    onChange(updateConfigPath(config, path, nextValue))
  }

  function fieldError(path) {
    return errors[path.join('.')] || ''
  }

  function isRequired(path) {
    return Boolean(errors[path.join('.')])
  }

  function renderFieldMeta(schema, path) {
    const error = fieldError(path)
    return (
      <>
        {schema.helper && <span className="settings-help">{schema.helper}</span>}
        {error && <span className="settings-error">{error}</span>}
      </>
    )
  }

  function renderLabelText(label, path) {
    return (
      <span className="settings-label-text">
        {label}
        {isRequired(path) && <span className="required-mark">Required</span>}
      </span>
    )
  }

  function updateSourceType(nextType) {
    if (nextType === 'cloud') {
      onChange({
        ...config,
        source_type: 'cloud',
        cloud_provider: config.cloud_provider || 'Google Cloud Storage',
        cloud_bucket: config.cloud_bucket || '',
        cloud_prefix: config.cloud_prefix || '',
        cloud_credentials_ref: config.cloud_credentials_ref || '',
      })
      return
    }
    onChange({
      ...config,
      source_type: 'local_path',
    })
  }

  function renderField(key, fieldValue, path = [key]) {
    const fieldId = path.join('.')
    const schema = getFieldSchema(key, fieldValue)
    const label = fieldLabel(key, schema)

    if (schema.type === 'boolean') {
      return (
        <div className="settings-toggle-wrap" key={fieldId}>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={Boolean(fieldValue)}
              onChange={(event) => updateField(path, event.target.checked)}
            />
            <span>{label}</span>
          </label>
          {renderFieldMeta(schema, path)}
        </div>
      )
    }

    if (schema.type === 'number') {
      return (
        <label className="settings-field" key={fieldId}>
          {renderLabelText(label, path)}
          <input
            type="number"
            value={Number.isFinite(fieldValue) ? fieldValue : 0}
            min={schema.min}
            max={schema.max}
            aria-invalid={Boolean(fieldError(path))}
            onChange={(event) => updateField(path, Number(event.target.value))}
          />
          {renderFieldMeta(schema, path)}
        </label>
      )
    }

    if (schema.type === 'select') {
      return (
        <label className="settings-field" key={fieldId}>
          {renderLabelText(label, path)}
          <select
            value={displayText(fieldValue, schema.options?.[0]?.value || '')}
            aria-invalid={Boolean(fieldError(path))}
            onChange={(event) => updateField(path, event.target.value)}
          >
            {(schema.options || []).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {renderFieldMeta(schema, path)}
        </label>
      )
    }

    if (schema.type === 'list') {
      const listValue = Array.isArray(fieldValue) ? fieldValue : parseListInput(displayText(fieldValue))
      const draftValue = Object.prototype.hasOwnProperty.call(draftLists, fieldId)
        ? draftLists[fieldId]
        : listValue.join('\n')
      return (
        <label className="settings-field" key={fieldId}>
          {renderLabelText(label, path)}
          <textarea
            value={draftValue}
            aria-invalid={Boolean(fieldError(path))}
            onChange={(event) => {
              const nextValue = event.target.value
              setDraftLists((current) => ({ ...current, [fieldId]: nextValue }))
              updateField(path, parseListInput(nextValue))
            }}
            onBlur={() => {
              setDraftLists((current) => {
                const nextDrafts = { ...current }
                delete nextDrafts[fieldId]
                return nextDrafts
              })
            }}
            placeholder={schema.placeholder || 'One value per line'}
          />
          {renderFieldMeta(schema, path)}
        </label>
      )
    }

    if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
      const childEntries = Object.entries(fieldValue)
      return (
        <fieldset className="settings-group" key={fieldId}>
          <legend>{label}</legend>
          {schema.helper && <p className="settings-group-help">{schema.helper}</p>}
          <div className={childEntries.every(([, item]) => typeof item === 'boolean') ? 'settings-switch-grid' : ''}>
            {childEntries.map(([childKey, childValue]) => renderField(childKey, childValue, [...path, childKey]))}
          </div>
        </fieldset>
      )
    }

    return (
      <label className="settings-field" key={fieldId}>
        {renderLabelText(label, path)}
        <input
          value={displayText(fieldValue)}
          aria-invalid={Boolean(fieldError(path))}
          onChange={(event) => updateField(path, event.target.value)}
          placeholder={schema.placeholder || ''}
        />
        {renderFieldMeta(schema, path)}
      </label>
    )
  }

  if (entries.length === 0 && !hasSourceType) {
    return <p className="settings-empty">{emptyMessage}</p>
  }

  const localSourceEntries = hasSourceType
    ? Array.from(localSourceKeys)
        .filter((key) => key !== 'credentials_file_source_type')
        .filter((key) => Object.prototype.hasOwnProperty.call(config, key))
        .map((key) => [key, config[key]])
    : []

  return (
    <div className="settings-editor">
      {scriptSchema && (
        <div className="settings-schema-header">
          <strong>{scriptSchema.title}</strong>
          <p>{scriptSchema.description}</p>
        </div>
      )}
      {hasSourceType && (
        <div className="settings-section">
          <label className="settings-field">
            {renderLabelText(fieldSchemasLabel('source_type'), ['source_type'])}
            <select value={sourceType === 'cloud' ? 'cloud' : 'local'} onChange={(event) => updateSourceType(event.target.value)}>
              <option value="local">Local</option>
              <option value="cloud">Cloud</option>
            </select>
          </label>
          {sourceType === 'cloud' ? (
            <>
              <p className="settings-note">Cloud source settings are placeholders. Backend cloud input is not connected yet.</p>
              {renderField('cloud_provider', config.cloud_provider || 'Google Cloud Storage')}
              {renderField('cloud_bucket', config.cloud_bucket || '')}
              {renderField('cloud_prefix', config.cloud_prefix || '')}
              {renderField('cloud_credentials_ref', config.cloud_credentials_ref || '')}
            </>
          ) : (
            <>
              {localSourceEntries.map(([key, fieldValue]) => renderField(key, fieldValue))}
            </>
          )}
        </div>
      )}
      {entries.map(([key, fieldValue]) => renderField(key, fieldValue))}
    </div>
  )
}

function fieldSchemasLabel(key) {
  return fieldLabel(key, getFieldSchema(key))
}

export default ConfigSettingsEditor
