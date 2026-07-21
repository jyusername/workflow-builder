import { useEffect, useState } from 'react'

import { CloseIcon } from '../../utils/icons'
import { displayText } from '../../utils/format'

const HIDDEN_RESULT_KEYS = new Set([
  'filename_date',
  'content_date',
  'content_digit_candidates',
  'branch_text_candidates',
  'gcs_destination',
  'gcs_path',
  'gcs_uri',
])

const COMPATIBILITY_RESULT_KEYS = new Set([
  'cloud_uri',
  'sample_uploaded_files',
  'total_gcs_errors',
  'uploaded_count',
  'upload_status',
])

const SUMMARY_RESULT_KEYS = new Set([
  'candidate_extension_summary',
  'error_extension_summary',
  'extraction_error_extension_summary',
  'file_result_extension_summary',
  'not_processed_extension_summary',
  'routed_extension_summary',
  'sample_extraction_errors',
  'sample_duplicate_delivery_files',
  'sample_signals',
  'sample_routed',
  'sample_destinations',
  'sample_file_results',
  'sample_candidates',
  'sample_not_processed',
  'sample_skipped',
  'sample_unmatched',
  'signal_extension_summary',
  'skipped_extension_summary',
  'unmatched_extension_summary',
])

const RAW_KEYS_ALREADY_COVERED_BY_CONTRACT = new Set([
  'bank_counts',
  'error_count',
  'errors',
  'input_count',
  'planned_count',
  'sample_error_files',
  'sample_errors',
  'sample_file_results',
  'sample_planned_files',
  'sample_routed',
  'sample_skipped',
  'sample_uploaded_files',
  'total_candidates',
  'total_errors',
  'total_routed',
  'total_scanned',
  'total_skipped',
  'uploaded_count',
])

function isCompatibilityResultKey(key) {
  return COMPATIBILITY_RESULT_KEYS.has(String(key || '').toLowerCase())
}

function formatNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue.toLocaleString() : '0'
}

function buildPrioritySummaryRows(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const totalScanned = Number(raw.total_scanned ?? raw.total_candidates)
  const totalRouted = Number(raw.total_routed)
  const delivered = Number(raw.delivered_count ?? raw.uploaded_count)
  const duplicateDeliveries = Number(raw.duplicate_delivery_count ?? 0)
  const deliveryErrors = Number(raw.delivery_error_count ?? raw.error_count ?? 0)
  const unmatched = Number(raw.unmatched_count ?? raw.unknown_count ?? 0)
  const needsReview =
    (Number.isFinite(duplicateDeliveries) ? duplicateDeliveries : 0) +
    (Number.isFinite(deliveryErrors) ? deliveryErrors : 0) +
    (Number.isFinite(unmatched) ? unmatched : 0)

  const rows = []
  if (Number.isFinite(totalScanned)) rows.push({ detail: '', label: 'Scanned', value: formatNumber(totalScanned) })
  if (Number.isFinite(totalRouted)) rows.push({ detail: '', label: 'Routed', value: formatNumber(totalRouted) })
  if (Number.isFinite(delivered)) rows.push({ detail: '', label: 'Delivered', value: formatNumber(delivered) })
  rows.push({ detail: '', label: 'Needs Review', value: formatNumber(needsReview) })

  if (Number.isFinite(totalRouted) && Number.isFinite(delivered) && totalRouted !== delivered) {
    const difference = Math.max(0, totalRouted - delivered)
    rows.push({
      detail: raw.delivery_note || 'Some routed files shared the same destination path, so they were not delivered separately.',
      label: 'Delivery Difference',
      value: `${formatNumber(difference)} file${difference === 1 ? '' : 's'}`,
    })
  }

  return rows
}

function getSampleName(item) {
  if (!item || typeof item !== 'object') return displayText(item, 'Item')
  return displayText(
    item.file_name ||
      item.filename ||
      item.name ||
      item.source_path ||
      item.destination_path ||
      item.gcs_path ||
      item.path,
    'Item',
  )
}

function getSampleExtension(item) {
  if (item && typeof item === 'object' && item.extension) return displayText(item.extension).toLowerCase()
  const fileName = getSampleName(item).toLowerCase()
  const match = fileName.match(/(\.[a-z0-9]+)(?:$|\?)/)
  return match?.[1] || 'no extension'
}

function getSampleReason(item) {
  if (!item || typeof item !== 'object') return 'No reason recorded'
  return displayText(
    item.reason ||
      item.skip_reason ||
      item.unknown_reason ||
      item.error ||
      item.message ||
      item.category ||
      item.status_reason ||
      item.status,
    'No reason recorded',
  )
}

function summarizeSampleItem(item) {
  if (!item || typeof item !== 'object') return displayText(item, 'Item')

  if (item.example && item.count !== undefined) {
    const details = [
      item.reason && `reason: ${displayText(item.reason)}`,
      item.bank && `bank: ${displayText(item.bank)}`,
      item.matched_reference_id && `reference: ${displayText(item.matched_reference_id)}`,
    ].filter(Boolean)

    return details.length
      ? `${displayText(item.example)} (${details.slice(0, 2).join(', ')})`
      : displayText(item.example)
  }

  const details = [
    item.status && `status: ${displayText(item.status)}`,
    item.reason && `reason: ${displayText(item.reason)}`,
    item.bank && `bank: ${displayText(item.bank)}`,
    item.branch && `branch: ${displayText(item.branch)}`,
    item.destination_path && `destination: ${displayText(item.destination_path)}`,
    item.gcs_path && `gcs: ${displayText(item.gcs_path)}`,
  ].filter(Boolean)

  return details.length ? `${getSampleName(item)} (${details.slice(0, 2).join(', ')})` : getSampleName(item)
}

function summarizeSampleArray(value) {
  const groups = new Map()

  value.forEach((item) => {
    const extension = getSampleExtension(item)
    const reason = getSampleReason(item)
    const groupKey = `${extension}|${reason}`

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        extension,
        reason,
        count: 0,
        example: summarizeSampleItem(item),
      })
    }

    groups.get(groupKey).count += Number(item?.count) || 1
  })

  return {
    total: value.length,
    showing: groups.size,
    examples: [...groups.values()].map((item) => {
      const reason = item.reason === 'No reason recorded' ? '' : `; ${item.reason}`
      return `${item.extension}: ${item.count} item${item.count === 1 ? '' : 's'}${reason}. Example: ${item.example}`
    }),
  }
}

function cleanRunOutput(value, key = '') {
  if (Array.isArray(value)) {
    if (SUMMARY_RESULT_KEYS.has(key)) return summarizeSampleArray(value)
    return value.map((item) => cleanRunOutput(item))
  }
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !HIDDEN_RESULT_KEYS.has(key))
      .map(([childKey, item]) => [childKey, cleanRunOutput(item, childKey)]),
  )
}

function formatRunOutput(value) {
  return JSON.stringify(cleanRunOutput(value?.raw ?? value), null, 2)
}

function toSummaryLabel(value) {
  return displayText(value, 'Result')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function summarizeValue(key, value) {
  const cleaned = cleanRunOutput(value, key)
  if (Array.isArray(cleaned)) {
    return {
      detail: cleaned.slice(0, 3).map((item) => displayText(getSampleName(item), displayText(item))).join(', '),
      label: toSummaryLabel(key),
      value: `${cleaned.length} item${cleaned.length === 1 ? '' : 's'}`,
    }
  }
  if (cleaned && typeof cleaned === 'object' && 'total' in cleaned && Array.isArray(cleaned.examples)) {
    return {
      detail: cleaned.examples.slice(0, 2).join(' '),
      label: toSummaryLabel(key),
      value: `${cleaned.total} item${cleaned.total === 1 ? '' : 's'}`,
    }
  }
  if (cleaned && typeof cleaned === 'object') {
    const numericValues = Object.entries(cleaned)
      .filter(([, item]) => typeof item === 'number' && Number.isFinite(item))
      .map(([childKey, item]) => `${toSummaryLabel(childKey)}: ${item}`)
    const listCounts = Object.entries(cleaned)
      .filter(([, item]) => Array.isArray(item))
      .map(([childKey, item]) => `${toSummaryLabel(childKey)}: ${item.length}`)
    return {
      detail:
        [...numericValues, ...listCounts].slice(0, 4).join(', ') ||
        `${Object.keys(cleaned).length} fields recorded`,
      label: toSummaryLabel(key),
      value: numericValues.length
        ? `${numericValues.length} metric${numericValues.length === 1 ? '' : 's'}`
        : `${Object.keys(cleaned).length} fields`,
    }
  }
  return {
    detail: '',
    label: toSummaryLabel(key),
    value: displayText(cleaned, 'Recorded'),
  }
}

function summarizeRunOutput(value) {
  if (value?.schema_version === 1) {
    const priorityRows = buildPrioritySummaryRows(value.raw)
    const rows = [
      ...(Array.isArray(value.metrics)
        ? value.metrics.filter((metric) => !isCompatibilityResultKey(metric.label)).map((metric) => ({
            detail: '',
            label: displayText(metric.label, 'Metric'),
            value: displayText(metric.value, '0'),
          }))
        : []),
      ...(Array.isArray(value.examples)
        ? value.examples.map((example) => ({
            detail: [
              displayText(example.reason),
              ...(Array.isArray(example.items) ? example.items.map((item) => displayText(item)) : []),
            ]
              .filter(Boolean)
              .join(' | '),
            label: displayText(example.label, 'Example'),
            value: `${Number(example.count) || 0} item${Number(example.count) === 1 ? '' : 's'}`,
          }))
        : []),
      ...(Array.isArray(value.warnings)
        ? value.warnings.map((warning) => ({
            detail: displayText(warning),
            label: 'Warning',
            value: 'Review',
          }))
        : []),
      ...(Array.isArray(value.errors)
        ? value.errors.map((error) => ({
            detail: displayText(error),
            label: 'Error',
            value: 'Failed',
          }))
        : []),
    ]
    const rawRows =
      value.raw && typeof value.raw === 'object' && !Array.isArray(value.raw)
        ? Object.entries(cleanRunOutput(value.raw))
            .filter(([key, item]) =>
              key !== 'status' &&
              !RAW_KEYS_ALREADY_COVERED_BY_CONTRACT.has(key) &&
            item !== undefined &&
            item !== null &&
            item !== ''
              && !isCompatibilityResultKey(key)
            )
            .map(([key, item]) => summarizeValue(key, item))
        : []
    const seen = new Set()
    const allRows = [...priorityRows, ...rows, ...rawRows].filter((row) => {
      const key = `${row.label}|${row.value}|${row.detail}`
      if (row.label === 'Result') return false
      if (seen.has(key)) return false
      if (priorityRows.some((priority) => priority.label === row.label) && !priorityRows.includes(row)) return false
      seen.add(key)
      return true
    })
    return allRows.length
      ? allRows
      : [{
          detail: '',
          label: 'Summary',
          value: displayText(value.summary, 'Result recorded'),
        }]
  }

  const cleaned = cleanRunOutput(value)
  if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) {
    return [summarizeValue('result', cleaned)]
  }
  return Object.entries(cleaned)
    .filter(([key, item]) => key !== 'status' && !isCompatibilityResultKey(key) && item !== undefined && item !== null && item !== '')
    .map(([key, item]) => summarizeValue(key, item))
}

function isPrimarySummary(summary) {
  return !summary.detail && /^[\d,.]+(?:\.\d+)?$|^(yes|no|true|false)$/i.test(String(summary.value))
}

function splitSummaryRows(rows) {
  return rows.reduce(
    (groups, row) => {
      if (isPrimarySummary(row)) groups.metrics.push(row)
      else groups.details.push(row)
      return groups
    },
    { details: [], metrics: [] },
  )
}

function Inspector({
  isOpen,
  selectedNode,
  selectedNodeLabel,
  runResult,
  selectedNodeResults,
  onClose,
}) {
  const [showRawOutput, setShowRawOutput] = useState(false)
  const hasResultOutput = selectedNodeResults.some((item) => item.result !== undefined)

  useEffect(() => {
    setShowRawOutput(false)
  }, [selectedNode?.id])

  return (
    <aside className={`inspector ${isOpen ? 'open' : ''}`}>
      <div className="inspector-close-row">
        <div className="inspector-title">
          <span className="eyebrow">Selected script</span>
          <strong>{selectedNode ? selectedNodeLabel : 'No script selected'}</strong>
        </div>
        <button className="icon-button inspector-icon-button" type="button" onClick={onClose} title="Close inspector">
          <CloseIcon fontSize="small" />
        </button>
      </div>

      <section className="run-output">
        <div className="run-output-header">
          <div>
            <span className="eyebrow">Latest Result</span>
            <h2>Run Output</h2>
          </div>
        </div>
        {hasResultOutput && (
          <button
            aria-checked={showRawOutput}
            className={`raw-output-toggle ${showRawOutput ? 'active' : ''}`}
            role="switch"
            type="button"
            onClick={() => setShowRawOutput((current) => !current)}
            title="Toggle raw output"
          >
            <span>View raw</span>
            <span className="raw-output-switch" aria-hidden="true">
              <span />
            </span>
          </button>
        )}
        {!selectedNode && (
          <div className="inspector-empty-state">Select a script node to see its latest result.</div>
        )}
        {selectedNode && !runResult && (
          <div className="inspector-empty-state">Run the flow to see this script result.</div>
        )}
        {selectedNode && runResult && selectedNodeResults.length === 0 && (
          <div className="inspector-empty-state">No result recorded for {selectedNodeLabel} in the latest run.</div>
        )}
        {selectedNodeResults.map((item) => (
          <div className={`result-item ${item.status}`} key={`${item.node_id}-${item.started_at}`}>
            {item.stdout && <pre className="compact-output-pre">{displayText(item.stdout)}</pre>}
            {item.error && <pre className="compact-output-pre error-output">{displayText(item.error)}</pre>}
            {item.result !== undefined &&
              !showRawOutput &&
              (() => {
                const summaries = summarizeRunOutput(item.result)
                const summaryGroups = splitSummaryRows(summaries)
                return (
                  <div className="result-summary-list">
                    {summaryGroups.metrics.length > 0 && (
                      <div className="result-metric-grid">
                        {summaryGroups.metrics.map((summary, index) => (
                          <div className="result-metric-card" key={`${summary.label}-${index}`}>
                            <span>{summary.label}</span>
                            <strong>{summary.value}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                    {summaryGroups.details.length > 0 && (
                      <div className="result-detail-list">
                        {summaryGroups.details.map((summary, index) => (
                          <div className="result-detail-row" key={`${summary.label}-${index}`}>
                            <div>
                              <span>{summary.label}</span>
                              <strong>{summary.value}</strong>
                            </div>
                            {summary.detail && <p>{summary.detail}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })()}
            {item.result !== undefined && showRawOutput && <pre>{formatRunOutput(item.result)}</pre>}
          </div>
        ))}
      </section>
    </aside>
  )
}

export default Inspector
