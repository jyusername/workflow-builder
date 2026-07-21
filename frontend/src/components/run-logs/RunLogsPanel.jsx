import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ArrowDropDownIcon, ArrowDropUpIcon } from '../../utils/icons'
import { displayText, formatRunStatus } from '../../utils/format'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001'
const SECRET_KEY_PATTERN = /credential|password|secret|token|api[_-]?key|private/i
const RUN_HISTORY_PER_DATE_DISPLAY_LIMIT = 10
const RUN_HISTORY_ROW_HEIGHT = 50
const RUN_HISTORY_OVERSCAN = 6
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

const METADATA_RESULT_KEYS = new Set([
  'created_at',
  'finished_at',
  'id',
  'label',
  'node_id',
  'node_label',
  'project_id',
  'run_id',
  'schema_version',
  'started_at',
  'status',
  'updated_at',
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

function formatDateTime(value) {
  if (!value) return 'Not recorded'
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatDateDivider(value) {
  if (!value) return 'Unknown date'
  return new Date(value).toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function friendlyKey(key) {
  return displayText(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isMetadataResultKey(key) {
  return METADATA_RESULT_KEYS.has(String(key).toLowerCase().replace(/[-\s]/g, '_'))
}

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

function diagnosticStatusLabel(status) {
  if (status === 'not-run') return 'Not run'
  if (status === 'review') return 'Needs review'
  return formatRunStatus(status)
}

function isActiveRunStatus(status) {
  return ['starting', 'queued', 'running', 'stopping'].includes(status)
}

function formatConfigObject(value, depth) {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
  if (!entries.length) return 'Not set'

  if (
    Object.prototype.hasOwnProperty.call(value, 'year') ||
    Object.prototype.hasOwnProperty.call(value, 'month') ||
    Object.prototype.hasOwnProperty.call(value, 'day')
  ) {
    const year = value.year || 'YYYY'
    const month = value.month ? String(value.month).padStart(2, '0') : 'MM'
    const day = value.day ? String(value.day).padStart(2, '0') : 'DD'
    return `${year}-${month}-${day}`
  }

  if (depth >= 2) return `${entries.length} setting${entries.length === 1 ? '' : 's'}`

  return entries
    .slice(0, 5)
    .map(([childKey, childValue]) => `${friendlyKey(childKey)}: ${redactValue(childKey, childValue, depth + 1)}`)
    .join(', ')
}

function redactValue(key, value, depth = 0) {
  if (SECRET_KEY_PATTERN.test(key)) return value ? 'Set, hidden' : 'Not set'
  if (Array.isArray(value)) {
    if (!value.length) return 'None'
    return value.map((item) => redactValue(key, item, depth + 1)).join(', ')
  }
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  if (value === null || value === undefined || value === '') return 'Not set'
  if (typeof value === 'object') return formatConfigObject(value, depth)
  return String(value)
}

function summarizeConfig(config = {}) {
  return Object.entries(config)
    .filter(([, value]) => value !== undefined)
    .slice(0, 10)
    .map(([key, value]) => ({ key: friendlyKey(key), value: redactValue(key, value) }))
}

function getNodeResultPayload(node) {
  return node?.result?.raw ?? node?.result?.result ?? node?.result ?? null
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function getFileName(item) {
  if (typeof item === 'string') return item
  if (!item || typeof item !== 'object') return 'Unknown file'
  const directName = displayText(
    item.example ||
      item.file_name ||
      item.filename ||
      item.name ||
      item.source ||
      item.destination ||
      item.path ||
      item.source_path ||
      item.local_path ||
      item.target_path ||
      item.destination_path ||
      item.upload_path ||
      item.planned_path ||
      item.planned_file ||
      item.gcs_path,
    '',
  )
  if (directName) return directName

  const pathLikeValue = Object.values(item).find(
    (value) => typeof value === 'string' && /(?:^|[\\/])[^\\/]+\.[a-z0-9]+(?:$|\?)/i.test(value),
  )
  return displayText(pathLikeValue, 'Unknown file')
}

function isFileLikeItem(item) {
  if (typeof item === 'string') return /\.[a-z0-9]+(?:$|\?)/i.test(item)
  if (!item || typeof item !== 'object') return false
  return Boolean(
    item.file_name ||
      item.filename ||
      item.name ||
      item.source ||
      item.destination ||
      item.path ||
      item.source_path ||
      item.local_path ||
      item.target_path ||
      item.destination_path ||
      item.upload_path ||
      item.planned_path ||
      item.planned_file ||
      item.gcs_path,
  )
}

function getFileExtension(fileName) {
  const match = displayText(fileName).toLowerCase().match(/(\.[a-z0-9]+)(?:$|\?)/)
  return match?.[1] || 'no extension'
}

function getItemExtension(item) {
  if (item && typeof item === 'object' && item.extension) return displayText(item.extension).toLowerCase()
  return getFileExtension(getFileName(item))
}

function getReason(item, fallback = 'No reason recorded') {
  if (typeof item === 'string') return fallback
  if (!item || typeof item !== 'object') return fallback
  return displayText(
    item.reason ||
      item.skip_reason ||
      item.unknown_reason ||
      item.error ||
      item.message ||
      item.category ||
      item.status_reason,
    fallback,
  )
}

function summarizeItemsByExtension(items, fallbackReason = 'Recorded') {
  const groups = new Map()
  asArray(items).forEach((item) => {
    const extension = getItemExtension(item)
    if (!groups.has(extension)) {
      groups.set(extension, {
        count: 0,
        example: getFileName(item),
        extension,
        reason: getReason(item, fallbackReason),
      })
    }
    groups.get(extension).count += Number(item?.count) || 1
  })
  return [...groups.values()]
}

function formatExtensionSummaryLine(item) {
  const reason = item.reason && item.reason !== 'No reason recorded' && item.reason !== 'Recorded'
    ? `; ${item.reason}`
    : ''
  return `${item.extension}: ${item.count} file${item.count === 1 ? '' : 's'}${reason}. Example: ${item.example}`
}

function cleanReadableResult(value, key = '') {
  if (Array.isArray(value)) {
    if (!SUMMARY_RESULT_KEYS.has(key)) {
      return value.map((item) => cleanReadableResult(item))
    }
    const groups = summarizeItemsByExtension(value)
    const total = groups.reduce((sum, item) => sum + item.count, 0)
    return {
      examples: groups.map(formatExtensionSummaryLine),
      total,
    }
  }
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([childKey]) => !HIDDEN_RESULT_KEYS.has(childKey) && !isMetadataResultKey(childKey))
      .map(([childKey, item]) => [childKey, cleanReadableResult(item, childKey)]),
  )
}

function summarizeReadableValue(key, value) {
  const cleaned = cleanReadableResult(value, key)
  if (Array.isArray(cleaned)) {
    return {
      detail: cleaned.slice(0, 3).map((item) => getFileName(item)).join(', '),
      label: friendlyKey(key),
      value: `${cleaned.length} item${cleaned.length === 1 ? '' : 's'}`,
    }
  }
  if (cleaned && typeof cleaned === 'object' && 'total' in cleaned && Array.isArray(cleaned.examples)) {
    return {
      detail: cleaned.examples.slice(0, 2).join(' '),
      label: friendlyKey(key),
      value: `${cleaned.total} item${cleaned.total === 1 ? '' : 's'}`,
    }
  }
  if (cleaned && typeof cleaned === 'object') {
    const listCounts = Object.entries(cleaned)
      .filter(([childKey, item]) => !isMetadataResultKey(childKey) && Array.isArray(item))
      .map(([childKey, item]) => `${friendlyKey(childKey)}: ${item.length}`)
    return {
      detail: listCounts.slice(0, 3).join(', ') || `${Object.keys(cleaned).length} fields recorded`,
      label: friendlyKey(key),
      value: `${Object.keys(cleaned).length} fields`,
    }
  }
  return {
    detail: '',
    label: friendlyKey(key),
    value: displayText(cleaned, 'Recorded'),
  }
}

function buildReadableResultSummary(payload) {
  if (payload?.schema_version === 1) {
    const priorityRows = buildPrioritySummaryRows(payload.raw)
    const rows = [
      ...(Array.isArray(payload.metrics)
        ? payload.metrics
            .filter((metric) => !isMetadataResultKey(metric.label) && !isCompatibilityResultKey(metric.label))
            .map((metric) => ({
              detail: '',
              label: displayText(metric.label, 'Metric'),
              value: displayText(metric.value, '0'),
            }))
        : []),
      ...(Array.isArray(payload.examples)
        ? payload.examples.map((example) => ({
            detail: [
              displayText(example.reason),
              ...(Array.isArray(example.items) ? example.items.slice(0, 2).map((item) => displayText(item)) : []),
            ]
              .filter(Boolean)
              .join(' | '),
            label: displayText(example.label, 'Example'),
            value: `${Number(example.count) || 0} item${Number(example.count) === 1 ? '' : 's'}`,
          }))
        : []),
      ...(Array.isArray(payload.warnings)
        ? payload.warnings.slice(0, 2).map((warning) => ({
            detail: displayText(warning),
            label: 'Warning',
            value: 'Review',
          }))
        : []),
      ...(Array.isArray(payload.errors)
        ? payload.errors.slice(0, 2).map((error) => ({
            detail: displayText(error),
            label: 'Error',
            value: 'Failed',
          }))
        : []),
    ]
    const seen = new Set()
    const allRows = [...priorityRows, ...rows].filter((row) => {
      if (row.label === 'Result') return false
      if (priorityRows.some((priority) => priority.label === row.label) && !priorityRows.includes(row)) return false
      const key = `${row.label}|${row.value}|${row.detail}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return allRows.length
      ? allRows
      : [{
          detail: '',
          label: 'Summary',
          value: displayText(payload.summary, 'Result recorded'),
        }]
  }

  const cleaned = cleanReadableResult(payload)
  if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) {
    return [summarizeReadableValue('result', cleaned)]
  }
  return Object.entries(cleaned)
    .filter(([key, item]) => !isMetadataResultKey(key) && !isCompatibilityResultKey(key) && item !== undefined && item !== null && item !== '')
    .slice(0, 8)
    .map(([key, item]) => summarizeReadableValue(key, item))
}

function groupExamplesByReason(items, fallbackReason) {
  const groups = new Map()
  asArray(items).forEach((item) => {
    const reason = getReason(item, fallbackReason)
    const extension = getItemExtension(item)
    const groupKey = `${reason}|${extension}`
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        reason,
        extension,
        count: 0,
        example: getFileName(item),
      })
    }
    groups.get(groupKey).count += Number(item?.count) || 1
  })
  return [...groups.values()]
}

function extractResultArrays(payload, matcher) {
  if (!payload || typeof payload !== 'object') return []
  return Object.entries(payload).flatMap(([key, value]) => {
    if (HIDDEN_RESULT_KEYS.has(key)) return []
    if (Array.isArray(value) && matcher(key)) return value
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return extractResultArrays(value, matcher)
    }
    return []
  })
}

function extractFileLikeArrays(payload) {
  if (!payload || typeof payload !== 'object') return []
  return Object.entries(payload).flatMap(([key, value]) => {
    if (HIDDEN_RESULT_KEYS.has(key)) return []
    if (Array.isArray(value)) return value.filter(isFileLikeItem)
    if (value && typeof value === 'object') return extractFileLikeArrays(value)
    return []
  })
}

function extractFileSummaryArrays(payload) {
  if (!payload || typeof payload !== 'object') return []
  return Object.entries(payload).flatMap(([key, value]) => {
    if (HIDDEN_RESULT_KEYS.has(key)) return []
    if (Array.isArray(value) && (SUMMARY_RESULT_KEYS.has(key) || value.some(isFileLikeItem))) {
      return value
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) return extractFileSummaryArrays(value)
    return []
  })
}

function extractExtensionFindings(payload, validExtensions = []) {
  const normalizedValid = new Set(validExtensions.map((item) => displayText(item).toLowerCase()))
  if (!normalizedValid.size) return []
  const summaryRows = [
    ...asArray(payload?.skipped_extension_summary),
    ...asArray(payload?.unknown_extension_summary),
  ]
  if (summaryRows.length) {
    return summaryRows
      .filter((item) => !normalizedValid.has(getItemExtension(item)))
      .map((item) => ({
        extension: getItemExtension(item),
        count: Number(item.count) || 1,
        example: getFileName(item),
      }))
  }
  const skipped = extractFileLikeArrays(payload)
  const extensions = new Map()
  skipped.forEach((item) => {
    const fileName = getFileName(item)
    const extension = getFileExtension(fileName)
    if (normalizedValid.has(extension)) return
    if (!extensions.has(extension)) {
      extensions.set(extension, {
        extension,
        count: 0,
        example: fileName,
      })
    }
    extensions.get(extension).count += 1
  })
  return [...extensions.values()]
}

function buildSuccessfulPathingDetails(items) {
  const extensionGroups = new Map()
  asArray(items).forEach((item) => {
    const extension = getItemExtension(item)
    if (!extensionGroups.has(extension)) {
      extensionGroups.set(extension, { count: 0, item })
    }
    extensionGroups.get(extension).count += Number(item?.count) || 1
  })

  return [...extensionGroups.entries()].map(([extension, group]) => {
    const item = group.item
    if (!item || typeof item !== 'object') {
      return {
        file: getFileName(item),
        reason: `${group.count} ${extension} file(s) processed successfully.`,
      }
    }
    const parts = []
    if (item.bank || item.bank_name) parts.push(`bank matched ${displayText(item.bank || item.bank_name)}`)
    if (item.branch || item.branch_name) parts.push(`branch matched ${displayText(item.branch || item.branch_name)}`)
    if (item.rule || item.matched_rule) parts.push(`rule ${displayText(item.rule || item.matched_rule)}`)
    if (item.reference || item.reference_match) parts.push(`reference ${displayText(item.reference || item.reference_match)}`)
    if (item.destination_path || item.gcs_path || item.path) {
      parts.push(`path ${displayText(item.destination_path || item.gcs_path || item.path)}`)
    }
    return {
      file: getFileName(item),
      reason: parts.length
        ? `${group.count} ${extension} file(s): ${parts.join('; ')}`
        : `${group.count} ${extension} file(s) matched configured rules and reference data.`,
    }
  })
}

function summarizeDuplicateDeliveries(payload) {
  return asArray(payload?.sample_duplicate_delivery_files).map((item) => ({
    count: Number(item?.count) || 0,
    destination: displayText(item?.local_destination || item?.destination_path, 'Unknown destination'),
    example: displayText(item?.example, 'Unknown file'),
    notIncluded: Math.max(0, (Number(item?.count) || 0) - 1),
  }))
}

function collectArrayEvidence(value, path = []) {
  if (!value || typeof value !== 'object') return []
  if (path.at(-1) && HIDDEN_RESULT_KEYS.has(path.at(-1))) return []
  if (Array.isArray(value)) {
    const extensionRows = summarizeItemsByExtension(value)
    const total = extensionRows.reduce((sum, item) => sum + item.count, 0)
    return [
      {
        key: path.join('.') || 'items',
        count: total,
        extensionRows,
        samples: extensionRows.map(formatExtensionSummaryLine),
      },
    ]
  }
  return Object.entries(value).flatMap(([key, item]) => collectArrayEvidence(item, [...path, key]))
}

function classifyEvidence(evidence) {
  const accepted = []
  const rejected = []
  const neutral = []

  evidence.forEach((item) => {
    const key = item.key.toLowerCase()
    if (/skip|reject|invalid|failed|missing|excluded|not_allowed|not allowed|unknown|unmatched|unmapped/.test(key)) {
      rejected.push(item)
    } else if (/accept|valid|scan|file|upload|success|candidate|matched/.test(key)) {
      accepted.push(item)
    } else {
      neutral.push(item)
    }
  })

  return { accepted, rejected, neutral }
}

function getFailureReason(node, logs) {
  if (Array.isArray(node?.result?.errors) && node.result.errors.length) return displayText(node.result.errors[0])
  if (node?.result?.error) return displayText(node.result.error)
  return displayText(
    logs.find((log) => log.level === 'error')?.message ||
      logs.find((log) => /failure reason/i.test(displayText(log.message)))?.message,
  )
}

function getWarnings(logs) {
  return logs
    .filter((log) => log.level === 'warning')
    .map((log) => displayText(log.message))
    .filter(Boolean)
}

function hasReviewSignals(node, diagnosis) {
  if (node.status === 'error' || node.status === 'stopped') return false
  const payload = getNodeResultPayload(node)
  const warnings = Array.isArray(node?.result?.warnings) ? node.result.warnings : []
  const errors = Array.isArray(node?.result?.errors) ? node.result.errors : []
  const rawErrorCount = Number(payload?.total_errors ?? payload?.error_count ?? payload?.processing_error_count ?? 0)
  const rawUnmatched = Number(payload?.total_unmatched ?? payload?.unknown_count ?? 0)
  const rawSkipped = Number(payload?.total_skipped ?? payload?.total_not_processed ?? 0)
  const rawDuplicates = Number(payload?.duplicate_delivery_count ?? 0)
  return Boolean(
    warnings.length ||
      errors.length ||
      rawErrorCount > 0 ||
      rawUnmatched > 0 ||
      rawSkipped > 0 ||
      rawDuplicates > 0 ||
      diagnosis?.extensionFindings?.length ||
      diagnosis?.skippedExamples?.length ||
      diagnosis?.duplicateDeliveries?.length ||
      diagnosis?.unknownExamples?.length,
  )
}

function buildSuggestedFixes(node, diagnosis) {
  const label = node.label.toLowerCase()
  const payload = getNodeResultPayload(node)
  const fixes = []
  const errorText = [
    getFailureReason(node, node.logs || []),
    ...(diagnosis?.findings || []),
    ...(diagnosis?.technicalMessages || []).map((log) => displayText(log.message)),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (label.includes('extract')) {
    if (/password|encrypted/i.test(errorText)) fixes.push('Check if the sample files are password-protected or encrypted.')
    if (/xlsb|pyxlsb/i.test(errorText) || payload?.error_extension_summary?.some?.((item) => item.extension === '.xlsb')) {
      fixes.push('Review the .xlsb files and confirm they can be opened/read by the extractor.')
    }
    if (/date|month|year|extract_date/i.test(errorText)) {
      fixes.push('Check the filename date format and confirm it uses a valid year and month.')
    }
    fixes.push('Open one failed sample file from File Evidence and compare it with a file that extracted successfully.')
  }

  if (label.includes('routing')) {
    fixes.push('Check the unmatched sample MID or branch against the routing matrix.')
    fixes.push('Add missing MID, branch, or bank reference values to the matrix, then run again.')
    if (diagnosis?.unknownExamples?.length) fixes.push('Use the example unmatched file to identify which routing rule or reference is missing.')
  }

  if (label.includes('scan')) {
    if (diagnosis?.extensionFindings?.length) fixes.push('Add the needed extension to Valid Extensions if those files should be processed.')
    fixes.push('Review skip-name rules if expected files did not become candidates.')
  }

  if (label.includes('upload') || label.includes('deliver')) {
    fixes.push('Confirm the delivery target, credentials, or local folder permission are correct.')
    fixes.push('If delivery is slow or unstable, lower Delivery Workers and try again.')
  }

  if (label.includes('destination')) {
    fixes.push('Confirm the generated destination path uses the expected bank, branch, and date folders.')
  }

  if (!fixes.length && hasReviewSignals(node, diagnosis)) {
    fixes.push('Review the warning or unmatched sample above, update the related setting or matrix, then run again.')
  }

  return [...new Set(fixes)].slice(0, 4)
}

function buildNodeDiagnosis(node) {
  const label = node.label.toLowerCase()
  const logs = node.logs || []
  const config = node.config || {}
  const payload = getNodeResultPayload(node)
  const evidence = classifyEvidence(collectArrayEvidence(payload))
  const failureReason = getFailureReason(node, logs)
  const warnings = getWarnings(logs)
  const checks = []
  const findings = []
  const actions = []
  const extensionFindings = extractExtensionFindings(payload, config.valid_extensions || [])
  const skippedExamples = groupExamplesByReason(
    extractResultArrays(payload, (key) => /skip|reject|excluded|invalid/i.test(key)),
    'Skipped by configured rules',
  )
  const unknownExamples = groupExamplesByReason(
    extractResultArrays(payload, (key) => /unknown|unmatched|unmapped/i.test(key)),
    'Could not match configured rules or reference data',
  )
  const successfulPathing = buildSuccessfulPathingDetails(
    extractResultArrays(payload, (key) => /upload|success|accepted|processed|matched|path|file_result|routed|destination/i.test(key)),
  )
  const duplicateDeliveries = summarizeDuplicateDeliveries(payload)

  if (label === 'validate environment') {
    const sourceType = config.source_type === 'cloud' ? 'Cloud' : 'Local'
    checks.push(`Source mode was ${sourceType}.`)
    if (config.source_type === 'cloud') {
      checks.push(`Cloud bucket: ${redactValue('cloud_bucket', config.cloud_bucket)}.`)
      checks.push(`Cloud prefix: ${redactValue('cloud_prefix', config.cloud_prefix)}.`)
      if (!config.cloud_bucket) actions.push('Add the source cloud bucket before running again.')
    } else {
      checks.push(`Source folder: ${redactValue('source_dir', config.source_dir)}.`)
      checks.push(`Credentials file: ${redactValue('credentials_file', config.credentials_file)}.`)
      if (!config.source_dir) actions.push('Add a source folder path in Settings or this script.')
      if (!config.credentials_file) actions.push('Add the credentials file path if this node needs it.')
    }
  }

  if (label === 'scan candidate files') {
    checks.push(`Allowed extensions: ${redactValue('valid_extensions', config.valid_extensions)}.`)
    checks.push(`Skip name rules: ${redactValue('skip_name_contains', config.skip_name_contains)}.`)
    if (evidence.accepted.length === 0 && evidence.rejected.length === 0) {
      findings.push('This script did not return detailed accepted/skipped file lists yet.')
      actions.push('For clearer file-level logs, return accepted_files and skipped_files from this script.')
    }
    if (extensionFindings.length) {
      findings.push(
        `Found ${extensionFindings.length} extension category/categories that were not in Valid Extensions.`,
      )
      actions.push('Add any needed extension to Valid Extensions, then run the workflow again.')
    }
  }

  if (label === 'build destination paths' || label === 'build gcs destination') {
    checks.push(`Destination target: ${redactValue('bucket_name', config.bucket_name)}.`)
    checks.push(`Destination prefix: ${redactValue('sandbox_prefix', config.sandbox_prefix)}.`)
    if (!config.bucket_name) actions.push('Set the destination target.')
  }

  if (label === 'deliver files' || label === 'upload to gcs') {
    checks.push(`Delivery target: ${config.upload_target === 'local' ? 'Local Drive' : 'Cloud Storage'}.`)
    if (config.local_output_dir) checks.push(`Local output: ${redactValue('local_output_dir', config.local_output_dir)}.`)
    checks.push(`Dry run: ${redactValue('dry_run', config.dry_run)}.`)
    if (config.dry_run) findings.push('Dry run is enabled, so delivery actions may be simulated only.')
    if (duplicateDeliveries.length) {
      const duplicateCount = Number(payload?.duplicate_delivery_count ?? 0)
      findings.push(`${duplicateCount} routed file${duplicateCount === 1 ? '' : 's'} were not delivered separately because they shared a destination with another file.`)
      actions.push('Check the duplicate destination examples below. The files that were not included are represented by the file already delivered to that destination.')
    }
  }

  if (failureReason) {
    findings.unshift(failureReason)
    actions.unshift('Review the reason above, update the script settings, then run the workflow again.')
  }

  if (warnings.length) {
    findings.push(...warnings)
  }

  if (!findings.length && node.status === 'success') {
    findings.push('No problem was reported for this script in the selected run.')
  }

  if (!actions.length && node.status === 'success') {
    actions.push('No action needed.')
  }

  if (!checks.length) {
    checks.push('No special setting checks are defined for this script yet.')
  }

  return {
    actions,
    accepted: extensionFindings.length ? [] : evidence.accepted,
    checks,
    duplicateDeliveries,
    extensionFindings,
    findings,
    rejected: extensionFindings.length ? [] : evidence.rejected,
    skippedExamples,
    suggestedFixes: [],
    successfulPathing,
    technicalMessages: logs.filter((log) => !/^Settings used:|^Inputs:|^Starting node|^Node .* success$/.test(displayText(log.message))),
    unknownExamples,
  }
}

function RunLogsPanel({ activeRunState, error: runListError = '', isLoading = false, project, runs = [] }) {
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [collapsedRunDates, setCollapsedRunDates] = useState(() => new Set())
  const [runHistoryScrollTop, setRunHistoryScrollTop] = useState(0)
  const [runHistoryViewportHeight, setRunHistoryViewportHeight] = useState(420)
  const [nodeFilter, setNodeFilter] = useState('all')
  const [runLogs, setRunLogs] = useState([])
  const [runNodes, setRunNodes] = useState([])
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [detailsError, setDetailsError] = useState('')
  const [isDetailsLoading, setIsDetailsLoading] = useState(false)
  const runHistoryScrollRef = useRef(null)
  const runDetailsCacheRef = useRef(new Map())
  const knownRunDatesRef = useRef(new Set())
  const runListKey = useMemo(() => runs.map((run) => run.id).join('|'), [runs])
  const runDateKey = useMemo(
    () => [...new Set(runs.map((run) => formatDateDivider(run.created_at)))].join('|'),
    [runs],
  )
  const selectedRunStatus = useMemo(
    () => runs.find((run) => run.id === selectedRunId)?.status,
    [runs, selectedRunId],
  )

  useEffect(() => {
    const nextDates = new Set(runs.map((run) => formatDateDivider(run.created_at)))
    setCollapsedRunDates((current) => {
      const nextCollapsed = new Set()
      nextDates.forEach((dateLabel) => {
        if (!knownRunDatesRef.current.has(dateLabel) || current.has(dateLabel)) {
          nextCollapsed.add(dateLabel)
        }
      })
      return nextCollapsed
    })
    knownRunDatesRef.current = nextDates
  }, [runDateKey, runs])

  useEffect(() => {
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(null)
      setSelectedNodeId(null)
    }
  }, [runs, selectedRunId])

  useEffect(() => {
    let ignore = false

    async function loadRunDetails() {
      if (!selectedRunId) {
        setRunLogs([])
        setRunNodes([])
        setIsDetailsLoading(false)
        return
      }
      if (!isActiveRunStatus(selectedRunStatus) && runDetailsCacheRef.current.has(selectedRunId)) {
        const cached = runDetailsCacheRef.current.get(selectedRunId)
        setRunLogs(cached.logs)
        setRunNodes(cached.nodes)
        setDetailsError('')
        setIsDetailsLoading(false)
        return
      }
      setDetailsError('')
      setIsDetailsLoading(true)
      try {
        const [logsResponse, nodesResponse] = await Promise.all([
          fetch(`${API_URL}/api/runs/${selectedRunId}/logs`),
          fetch(`${API_URL}/api/runs/${selectedRunId}/nodes`),
        ])
        if (!logsResponse.ok || !nodesResponse.ok) throw new Error('Unable to load run details.')
        const [logs, nodes] = await Promise.all([logsResponse.json(), nodesResponse.json()])
        if (ignore) return
        if (!isActiveRunStatus(selectedRunStatus)) {
          runDetailsCacheRef.current.set(selectedRunId, { logs, nodes })
        }
        setRunLogs(logs)
        setRunNodes(nodes)
      } catch (err) {
        if (!ignore) setDetailsError(err.message)
      } finally {
        if (!ignore) setIsDetailsLoading(false)
      }
    }

    loadRunDetails()
    return () => {
      ignore = true
    }
  }, [selectedRunId, selectedRunStatus])

  useEffect(() => {
    const element = runHistoryScrollRef.current
    if (!element) return undefined

    function updateViewportHeight() {
      setRunHistoryViewportHeight(element.clientHeight || 420)
    }

    updateViewportHeight()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateViewportHeight)
      return () => window.removeEventListener('resize', updateViewportHeight)
    }

    const observer = new ResizeObserver(updateViewportHeight)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (
      activeRunState.runId &&
      selectedRunId === activeRunState.runId &&
      ((activeRunState.logs || []).length > 0 || (activeRunState.nodes || []).length > 0)
    ) {
      setRunLogs(activeRunState.logs || [])
      setRunNodes(activeRunState.nodes || [])
      setIsDetailsLoading(false)
    }
  }, [activeRunState.logs, activeRunState.nodes, activeRunState.runId, activeRunState.status, selectedRunId])

  const error = detailsError || runListError

  const nodeReports = useMemo(() => {
    if (!selectedRunId) return []
    const resultByNode = new Map(runNodes.map((node) => [node.node_id, node]))
    const logsByNode = new Map()
    runLogs.forEach((log) => {
      if (!log.node_id) return
      if (!logsByNode.has(log.node_id)) logsByNode.set(log.node_id, [])
      logsByNode.get(log.node_id).push(log)
    })

    return (project?.workflow.nodes || []).map((node, index) => {
      const result = resultByNode.get(node.id)
      const logs = logsByNode.get(node.id) || []
      const baseStatus = result?.status || (logs.some((log) => log.level === 'error') ? 'error' : logs.length ? 'review' : 'not-run')
      const report = {
        id: node.id,
        index: index + 1,
        label: displayText(node.label, node.id),
        config: node.config || {},
        logs,
        result,
        status: baseStatus,
      }
      const diagnosis = buildNodeDiagnosis(report)
      const status = baseStatus === 'success' && hasReviewSignals(report, diagnosis) ? 'review' : baseStatus
      const finalReport = { ...report, status }
      const suggestedFixes = buildSuggestedFixes(finalReport, diagnosis)
      return { ...finalReport, diagnosis: { ...diagnosis, suggestedFixes } }
    })
  }, [project?.workflow.nodes, runLogs, runNodes, selectedRunId])

  const filteredNodeReports = useMemo(() => {
    if (nodeFilter === 'all') return nodeReports
    if (nodeFilter === 'review') return nodeReports.filter((node) => node.status === 'review')
    if (nodeFilter === 'failed') return nodeReports.filter((node) => ['error', 'stopped'].includes(node.status))
    if (nodeFilter === 'success') return nodeReports.filter((node) => node.status === 'success')
    return nodeReports
  }, [nodeFilter, nodeReports])

  useEffect(() => {
    if (!selectedRunId) {
      setSelectedNodeId(null)
      return
    }
    if (selectedNodeId && filteredNodeReports.some((node) => node.id === selectedNodeId)) return
    const nextNode =
      filteredNodeReports.find((node) => node.status === 'error') ||
      filteredNodeReports.find((node) => node.status === 'review') ||
      filteredNodeReports.find((node) => node.result) ||
      filteredNodeReports[0]
    setSelectedNodeId(nextNode?.id || null)
  }, [filteredNodeReports, selectedNodeId, selectedRunId])

  const selectedRun = runs.find((run) => run.id === selectedRunId)
  const selectedNode = nodeReports.find((node) => node.id === selectedNodeId)
  const selectedConfig = summarizeConfig(selectedNode?.config)
  const selectedDiagnosis = selectedNode?.diagnosis
  const selectedResultSummary = useMemo(
    () =>
      buildReadableResultSummary(selectedNode?.result).filter(
        (item) => item.value !== 'Recorded' && item.label !== 'Result',
      ),
    [selectedNode],
  )
  const runGroups = useMemo(() => {
    const groups = []
    runs.forEach((run) => {
      const dateLabel = formatDateDivider(run.created_at)
      const currentGroup = groups.at(-1)
      if (currentGroup?.dateLabel === dateLabel) {
        if (currentGroup.runs.length < RUN_HISTORY_PER_DATE_DISPLAY_LIMIT) {
          currentGroup.runs.push(run)
        }
        return
      }
      groups.push({ dateLabel, runs: [run] })
    })
    return groups
  }, [runs])

  const runHistoryRows = useMemo(
    () =>
      runGroups.flatMap((group) => [
        { dateLabel: group.dateLabel, count: group.runs.length, id: `date-${group.dateLabel}`, type: 'date' },
        ...(collapsedRunDates.has(group.dateLabel)
          ? []
          : group.runs.map((run) => ({ dateLabel: group.dateLabel, id: `run-${run.id}`, run, type: 'run' }))),
      ]),
    [collapsedRunDates, runGroups],
  )

  const visibleRunHistory = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(runHistoryScrollTop / RUN_HISTORY_ROW_HEIGHT) - RUN_HISTORY_OVERSCAN)
    const endIndex = Math.min(
      runHistoryRows.length,
      Math.ceil((runHistoryScrollTop + runHistoryViewportHeight) / RUN_HISTORY_ROW_HEIGHT) +
        RUN_HISTORY_OVERSCAN,
    )
    return {
      endIndex,
      rows: runHistoryRows.slice(startIndex, endIndex),
      startIndex,
      totalHeight: runHistoryRows.length * RUN_HISTORY_ROW_HEIGHT,
    }
  }, [runHistoryRows, runHistoryScrollTop, runHistoryViewportHeight])

  const handleRunHistoryScroll = useCallback((event) => {
    setRunHistoryScrollTop(event.currentTarget.scrollTop)
  }, [])

  function toggleRunDate(dateLabel) {
    setCollapsedRunDates((current) => {
      const isCurrentlyCollapsed = current.has(dateLabel)
      if (!isCurrentlyCollapsed) {
        return new Set(runGroups.map((group) => group.dateLabel))
      }
      return new Set(runGroups.filter((group) => group.dateLabel !== dateLabel).map((group) => group.dateLabel))
    })
  }

  return (
    <div className="run-logs-panel diagnostic-panel">
      {isLoading && (
        <div className="run-logs-loading-overlay" role="status" aria-live="polite">
          <div className="run-logs-loading-card">
            <span className="run-logs-loading-spinner" aria-hidden="true" />
            <strong>Loading run logs...</strong>
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="run-logs-grid diagnostic-grid">
        <aside className="run-history-list">
          <div className="run-history-heading">
            <span>Run History</span>
          </div>
          {runs.length === 0 && !isLoading && (
            <div className="run-log-empty">No runs yet. Run the workflow to start collecting diagnostics.</div>
          )}
          <div className="run-history-scroll" ref={runHistoryScrollRef} onScroll={handleRunHistoryScroll}>
            <div className="run-history-virtual-spacer" style={{ height: visibleRunHistory.totalHeight }}>
              <div
                className="run-history-virtual-window"
                style={{ transform: `translateY(${visibleRunHistory.startIndex * RUN_HISTORY_ROW_HEIGHT}px)` }}
              >
                {visibleRunHistory.rows.map((row) => {
                  if (row.type === 'date') {
                    const isCollapsed = collapsedRunDates.has(row.dateLabel)
                    return (
                      <div className="run-history-virtual-row" key={row.id}>
                        <button
                          className={`run-date-divider ${isCollapsed ? 'collapsed' : 'open'}`}
                          type="button"
                          onClick={() => toggleRunDate(row.dateLabel)}
                        >
                          <span className="run-date-arrow">
                            {isCollapsed ? <ArrowDropDownIcon fontSize="small" /> : <ArrowDropUpIcon fontSize="small" />}
                          </span>
                          <span>{row.dateLabel}</span>
                          <small>{row.count}</small>
                        </button>
                      </div>
                    )
                  }

                  const { run } = row
                  return (
                    <div className="run-history-virtual-row" key={row.id}>
                      <button
                        className={`run-history-card ${run.status} ${run.id === selectedRunId ? 'active' : ''}`}
                        type="button"
                        onClick={() => setSelectedRunId(run.id)}
                      >
                        <span className="run-history-status-dot" aria-hidden="true" />
                        <div>
                          <strong>{formatTime(run.created_at)}</strong>
                          <small>{run.error ? displayText(run.error) : formatRunStatus(run.status)}</small>
                        </div>
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </aside>

        <section className="run-report-panel">
          {!selectedRun ? (
            <div className="run-empty-selection">
              <h3>No run selected</h3>
              <p>Select a run from the history to view diagnostics.</p>
            </div>
          ) : (
            <>
              <div className="run-report-overview">
                <div>
                  <span className="eyebrow">Selected Run</span>
                  <h3>{formatDateTime(selectedRun.created_at)}</h3>
                </div>
                <span className={`inspector-status-pill ${selectedRun.status}`}>
                  {formatRunStatus(selectedRun.status)}
                </span>
              </div>

              <div className="run-diagnostic-layout">
                <div className="run-step-list">
                  <div className="run-step-filter" aria-label="Filter run steps">
                    {[
                      ['all', 'All'],
                      ['review', 'Needs Review'],
                      ['failed', 'Failed'],
                      ['success', 'Successful'],
                    ].map(([value, label]) => (
                      <button
                        className={nodeFilter === value ? 'active' : ''}
                        type="button"
                        key={value}
                        onClick={() => setNodeFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {isDetailsLoading && nodeReports.length === 0 && (
                    <div className="run-detail-loading-inline" role="status" aria-live="polite">
                      <span className="run-logs-loading-spinner" aria-hidden="true" />
                      <strong>Loading output...</strong>
                    </div>
                  )}
                  {!isDetailsLoading && filteredNodeReports.length === 0 && (
                    <div className="run-step-empty">No scripts match this filter.</div>
                  )}
                  {filteredNodeReports.map((node) => (
                    <button
                      className={`run-step-card ${node.status} ${node.id === selectedNodeId ? 'active' : ''}`}
                      type="button"
                      key={node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                    >
                      <span className="run-step-index">{String(node.index).padStart(2, '0')}</span>
                      <div>
                        <strong>{node.label}</strong>
                      </div>
                      <span className="run-step-status-dot" title={diagnosticStatusLabel(node.status)} />
                    </button>
                  ))}
                </div>

                <div className="run-diagnosis-detail">
                  {isDetailsLoading && (
                    <div className="run-detail-loading-inline" role="status" aria-live="polite">
                      <span className="run-logs-loading-spinner" aria-hidden="true" />
                      <strong>Loading run output...</strong>
                    </div>
                  )}
                  {!isDetailsLoading && !selectedNode && (
                    <div className="run-log-empty">Select a script to see its diagnosis.</div>
                  )}
              {selectedNode && selectedDiagnosis && (
                <>
                  <section className="diagnosis-card">
                    <h4>What Happened</h4>
                    {selectedDiagnosis.findings.map((item) => (
                      <p key={item}>{item}</p>
                    ))}
                  </section>

                  {selectedResultSummary.length > 0 && (
                    <section className="diagnosis-card run-readable-summary">
                      <h4>Result Summary</h4>
                      <div className="run-readable-summary-grid">
                        {selectedResultSummary.map((summary, index) => (
                          <article className="run-readable-summary-item" key={`${summary.label}-${index}`}>
                            <span>{summary.label}</span>
                            <strong>{summary.value}</strong>
                            {summary.detail && <p>{summary.detail}</p>}
                          </article>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="diagnosis-card">
                    <h4>What Was Checked</h4>
                    <ul>
                      {selectedDiagnosis.checks.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>

                  {selectedDiagnosis.extensionFindings.length > 0 && (
                    <section className="diagnosis-card">
                      <h4>Extensions Not Scanned</h4>
                      <ul>
                        {selectedDiagnosis.extensionFindings.map((item) => (
                          <li key={item.extension}>
                            {item.extension}: {item.count} file{item.count === 1 ? '' : 's'} skipped. Example: {item.example}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {selectedDiagnosis.skippedExamples.length > 0 && (
                    <section className="diagnosis-card">
                      <h4>Skipped File Reasons</h4>
                      <ul>
                        {selectedDiagnosis.skippedExamples.map((item) => (
                          <li key={`${item.reason}-${item.extension}`}>
                            {item.reason} ({item.extension}): {item.count} file{item.count === 1 ? '' : 's'}. Example: {item.example}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {selectedDiagnosis.unknownExamples.length > 0 && (
                    <section className="diagnosis-card">
                      <h4>Unknown File Reasons</h4>
                      <ul>
                        {selectedDiagnosis.unknownExamples.map((item) => (
                          <li key={`${item.reason}-${item.extension}`}>
                            {item.reason} ({item.extension}): {item.count} file{item.count === 1 ? '' : 's'}. Example: {item.example}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {selectedDiagnosis.duplicateDeliveries.length > 0 && (
                    <section className="diagnosis-card duplicate-delivery-card">
                      <h4>Files Not Delivered Separately</h4>
                      <p>
                        These routed files shared the same destination path, so only one file was delivered for each destination.
                      </p>
                      <ul>
                        {selectedDiagnosis.duplicateDeliveries.map((item) => (
                          <li key={`${item.destination}-${item.example}`}>
                            {item.notIncluded} of {item.count} file{item.count === 1 ? '' : 's'} were not delivered separately.
                            Delivered location: {item.destination}. Example duplicate: {item.example}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {selectedDiagnosis.suggestedFixes.length > 0 && (
                    <section className="diagnosis-card suggested-fixes-card">
                      <h4>Suggested Fixes</h4>
                      <ul>
                        {selectedDiagnosis.suggestedFixes.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  )}

                  <section className="diagnosis-card">
                    <h4>Recommended Action</h4>
                    <ul>
                      {selectedDiagnosis.actions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </section>

                  {(selectedDiagnosis.accepted.length > 0 || selectedDiagnosis.rejected.length > 0) && (
                    <section className="diagnosis-card file-evidence-card">
                      <h4>File Evidence</h4>
                      {selectedDiagnosis.accepted.map((item) => (
                        <div className="file-evidence success" key={item.key}>
                          <strong>{friendlyKey(item.key)}</strong>
                          <span>{item.count} found</span>
                          {item.extensionRows?.length > 0 ? (
                            <ul className="file-evidence-extension-list">
                              {item.extensionRows.map((row) => (
                                <li key={`${item.key}-${row.extension}`}>
                                  <strong>{row.extension}</strong>
                                  <span>{row.count} file{row.count === 1 ? '' : 's'}</span>
                                  <p>Example: {row.example}</p>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            item.samples.length > 0 && <p>{item.samples.join(', ')}</p>
                          )}
                        </div>
                      ))}
                      {selectedDiagnosis.rejected.map((item) => (
                        <div className="file-evidence error" key={item.key}>
                          <strong>{friendlyKey(item.key)}</strong>
                          <span>{item.count} skipped or failed</span>
                          {item.extensionRows?.length > 0 ? (
                            <ul className="file-evidence-extension-list">
                              {item.extensionRows.map((row) => (
                                <li key={`${item.key}-${row.extension}`}>
                                  <strong>{row.extension}</strong>
                                  <span>{row.count} file{row.count === 1 ? '' : 's'}</span>
                                  <p>Example: {row.example}</p>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            item.samples.length > 0 && <p>{item.samples.join(', ')}</p>
                          )}
                        </div>
                      ))}
                    </section>
                  )}

                  <section className="diagnosis-card compact-config-card">
                    <h4>Settings Used</h4>
                    {selectedConfig.length === 0 ? (
                      <p>No settings were configured for this script.</p>
                    ) : (
                      <dl className="run-config-summary">
                        {selectedConfig.map((item) => (
                          <div key={item.key}>
                            <dt>{item.key}</dt>
                            <dd>{item.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </section>

                  {selectedDiagnosis.technicalMessages.length > 0 && (
                    <details className="diagnosis-technical-details">
                      <summary>Technical messages</summary>
                      {selectedDiagnosis.technicalMessages.map((log) => (
                        <article className={`run-log-detail-item ${log.level}`} key={log.id}>
                          <span>{formatTime(log.created_at)}</span>
                          <strong>{displayText(log.level)}</strong>
                          <p>{displayText(log.message)}</p>
                        </article>
                      ))}
                    </details>
                  )}
                </>
              )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default RunLogsPanel
