export const hiddenConfigKeys = new Set(['run_dir', 'resource_source_type', 'extraction_workers', 'routing_workers'])

export const localSourceKeys = new Set([
  'source_dir',
  'nonbdo_matrix',
  'bdo_matrix',
  'credentials_file',
  'credentials_file_source_type',
])

export const cloudSourceKeys = new Set([
  'cloud_provider',
  'cloud_bucket',
  'cloud_prefix',
  'cloud_credentials_ref',
])

export const fieldSchemas = {
  source_type: {
    label: 'Source Type',
    type: 'select',
    options: [
      { value: 'local', label: 'Local' },
      { value: 'cloud', label: 'Cloud' },
    ],
  },
  source_dir: { label: 'Source Directory', type: 'path', placeholder: 'Example: C:\\PaymentFiles' },
  nonbdo_matrix: { label: 'Non-BDO Matrix', type: 'path', placeholder: 'Example: inputs/matrices/NonBDO_Matrix.xlsx', helper: 'Path relative to this project workspace.' },
  bdo_matrix: { label: 'BDO Matrix', type: 'path', placeholder: 'Example: inputs/matrices/BDO_Matrix.xlsx', helper: 'Path relative to this project workspace.' },
  credentials_file: { label: 'Credentials File', type: 'path', placeholder: 'Example: secrets/gcs-service-account.json', helper: 'Path relative to this project workspace; the credential remains ignored by Git.' },
  valid_extensions: { label: 'Valid Extensions', type: 'list', placeholder: '.csv\n.xlsx\n.zip', helper: 'Only files with these extensions will be scanned.' },
  skip_names: { label: 'Skip Names', type: 'list', placeholder: 'Example: old_report.xlsx', helper: 'Optional filenames or text patterns to ignore.' },
  skip_name_contains: { label: 'Skip Names Containing', type: 'list', placeholder: 'cm.bdo\nbackup\nsample', helper: 'Files containing these values in their name will be skipped.' },
  default_date: { label: 'Default Date', type: 'group', helper: 'Fallback date used when a file does not contain a usable date.' },
  year: { label: 'Year', type: 'number', min: 0, max: 2100 },
  month: { label: 'Month', type: 'number', min: 0, max: 12 },
  day: { label: 'Day', type: 'number', min: 0, max: 31 },
  extract_content_digits: { label: 'Extract Content Digits', type: 'boolean', helper: 'Read file content for numeric signals.' },
  extract_branch_text: { label: 'Extract Branch Text', type: 'boolean', helper: 'Read branch text from candidate file content.' },
  extract_zip_content_digits: { label: 'Extract ZIP Content Digits', type: 'boolean', helper: 'Scan files inside ZIP archives for numeric signals.' },
  scan_content_rows: { label: 'Content Rows to Scan', type: 'number', min: 1, helper: 'Maximum content rows to inspect per file.' },
  scan_branch_rows: { label: 'Branch Rows to Scan', type: 'number', min: 1, helper: 'Maximum branch rows to inspect per file.' },
  pdf_max_pages: { label: 'PDF Pages to Scan', type: 'number', min: 1, helper: 'Maximum PDF pages to inspect per file. Text-based PDFs only; scanned images need OCR.' },
  rules: { label: 'Routing Rules', type: 'group' },
  pbdo_filename_rule: { label: 'PBDO Filename Rule', type: 'boolean' },
  ttl_filename_rule: { label: 'TTL Filename Rule', type: 'boolean' },
  zip_internal_filename_match: { label: 'ZIP Internal Filename Match', type: 'boolean' },
  zip_internal_content_match: { label: 'ZIP Internal Content Match', type: 'boolean' },
  inside_file_data_match: { label: 'Inside File Data Match', type: 'boolean' },
  filename_mid_match: { label: 'Filename MID Match', type: 'boolean' },
  branch_text_match: { label: 'Branch Text Match', type: 'boolean' },
  bdo_filename_fallback: { label: 'BDO Filename Fallback', type: 'boolean' },
  keyword_fallback: { label: 'Keyword Fallback', type: 'boolean' },
  mainsh_smac_rule: { label: 'MAINSH SMAC Rule', type: 'boolean' },
  pos_filename_override: { label: 'POS Filename Override', type: 'boolean' },
  bdo_filename_overrides: { label: 'BDO Filename Overrides', type: 'boolean' },
  bucket_name: { label: 'Cloud Bucket', type: 'text', placeholder: 'Example: sm-bronze', helper: 'Cloud bucket used when delivery target is cloud.' },
  sandbox_prefix: { label: 'Destination Prefix', type: 'text', placeholder: 'Example: test or archive/2026', helper: 'Optional prefix added to generated destination paths.' },
  dry_run: { label: 'Dry Run', type: 'boolean', helper: 'Preview delivery actions without copying or uploading files.' },
  upload_target: {
    label: 'Delivery Target',
    type: 'select',
    options: [
      { value: 'local', label: 'Local Drive' },
      { value: 'gcs', label: 'Cloud Storage' },
    ],
    helper: 'Choose where final files are delivered.',
  },
  local_output_dir: {
    label: 'Local Output Folder',
    type: 'path',
    placeholder: 'Example: C:\\Ingestion_Output',
    helper: 'Use a full folder path, for example C:\\Ingestion_Output or C:/Ingestion_Output.',
  },
  local_overwrite: { label: 'Overwrite Existing Local Files', type: 'boolean', helper: 'Replace files if the same local destination already exists.' },
  upload_workers: { label: 'Delivery Workers', type: 'number', min: 1, max: 32, helper: 'Number of files delivered in parallel. Start with 8; lower it if your machine or network is busy.' },
  cloud_provider: { label: 'Cloud Provider', type: 'text', placeholder: 'Example: Google Cloud Storage' },
  cloud_bucket: { label: 'Cloud Bucket', type: 'text', placeholder: 'Example: payment-source-bucket', helper: 'Placeholder for future cloud source input.' },
  cloud_prefix: { label: 'Cloud Prefix', type: 'text', placeholder: 'Example: incoming/payments' },
  cloud_credentials_ref: { label: 'Cloud Credentials Reference', type: 'text', placeholder: 'Example: payment-source-service-account' },
}

export const scriptSettingsSchemas = [
  {
    match: ['Validate Environment'],
    title: 'Environment Inputs',
    description: 'Set where the ingestion reads files and routing references from.',
    required: ['source_type'],
    requiredWhen: {
      local: ['source_dir', 'nonbdo_matrix', 'bdo_matrix', 'credentials_file'],
      cloud: ['cloud_bucket'],
    },
    fields: [
      'source_type',
      'source_dir',
      'nonbdo_matrix',
      'bdo_matrix',
      'credentials_file',
      'cloud_provider',
      'cloud_bucket',
      'cloud_prefix',
      'cloud_credentials_ref',
    ],
  },
  {
    match: ['Scan Candidate Files'],
    title: 'File Discovery',
    description: 'Control which source files are considered by the scanner.',
    required: ['valid_extensions'],
    fields: ['valid_extensions', 'skip_name_contains', 'skip_names'],
  },
  {
    match: ['Extract File Signals'],
    title: 'Signal Extraction',
    description: 'Tune how dates, branch text, and content digits are detected.',
    required: ['default_date.year', 'default_date.month', 'default_date.day', 'scan_content_rows', 'scan_branch_rows'],
    fields: [
      'default_date',
      'extract_content_digits',
      'extract_branch_text',
      'extract_zip_content_digits',
      'scan_content_rows',
      'scan_branch_rows',
      'pdf_max_pages',
    ],
  },
  {
    match: ['Apply Routing Rules'],
    title: 'Routing Rules',
    description: 'Enable or disable routing checks used to classify each file.',
    fields: ['rules'],
  },
  {
    match: ['Build Destination Paths', 'Build GCS Destination'],
    title: 'Destination Paths',
    description: 'Configure the generated destination path and optional prefix.',
    required: ['bucket_name'],
    fields: ['bucket_name', 'sandbox_prefix', 'dry_run'],
  },
  {
    match: ['Deliver Files', 'Upload to GCS'],
    title: 'Delivery Settings',
    description: 'Choose whether routed files are delivered to cloud storage or copied to a local folder.',
    fields: ['upload_target', 'bucket_name', 'local_output_dir', 'local_overwrite', 'dry_run', 'upload_workers'],
  },
]

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

export function getScriptSettingsSchema({ id, label } = {}) {
  const normalizedId = normalizeText(id)
  const normalizedLabel = normalizeText(label)
  return scriptSettingsSchemas.find((schema) =>
    schema.match.some((item) => {
      const normalizedMatch = normalizeText(item)
      return normalizedMatch === normalizedId || normalizedMatch === normalizedLabel
    }),
  )
}

export function getOrderedConfigEntries(config, scriptSchema) {
  const entries = Object.entries(config || {}).filter(([key]) => !hiddenConfigKeys.has(key))
  if (!scriptSchema?.fields?.length) return entries
  const fieldSet = new Set(scriptSchema.fields)
  const ordered = scriptSchema.fields
    .filter((key) => Object.prototype.hasOwnProperty.call(config, key))
    .map((key) => [key, config[key]])
  const extras = entries.filter(([key]) => !fieldSet.has(key))
  return [...ordered, ...extras]
}

function getPathValue(config, path) {
  return path.split('.').reduce((current, key) => current?.[key], config)
}

function isBlankValue(value) {
  if (Array.isArray(value)) return value.length === 0
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  return false
}

function validateRequiredField(errors, config, path) {
  if (isBlankValue(getPathValue(config, path))) {
    errors[path] = 'This setting is required.'
  }
}

function validateNumberField(errors, config, path) {
  const key = path.split('.').at(-1)
  const schema = getFieldSchema(key, getPathValue(config, path))
  const value = getPathValue(config, path)
  if (isBlankValue(value) || schema.type !== 'number') return
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) {
    errors[path] = 'Enter a valid number.'
    return
  }
  if (Number.isFinite(schema.min) && numberValue < schema.min) {
    errors[path] = `Must be ${schema.min} or higher.`
  }
  if (Number.isFinite(schema.max) && numberValue > schema.max) {
    errors[path] = `Must be ${schema.max} or lower.`
  }
}

function validateValidExtensions(errors, config) {
  if (!Object.prototype.hasOwnProperty.call(config, 'valid_extensions')) return
  const extensions = Array.isArray(config.valid_extensions) ? config.valid_extensions : []
  if (extensions.length === 0) {
    errors.valid_extensions = 'Add at least one valid extension.'
    return
  }
  const invalid = extensions.find((item) => {
    const text = String(item || '').trim()
    return !text.startsWith('.') || /\s/.test(text) || text.length < 2
  })
  if (invalid) {
    errors.valid_extensions = 'Each extension must start with a dot and contain no spaces.'
  }
}

function validateBucketName(errors, config, path = 'bucket_name') {
  if (!Object.prototype.hasOwnProperty.call(config, path)) return
  const value = String(config[path] || '').trim()
  if (!value) return
  if (/\s/.test(value)) {
    errors[path] = 'Bucket name cannot contain spaces.'
  }
}

function validateCommonSettings(errors, config) {
  validateValidExtensions(errors, config)
  validateBucketName(errors, config, 'bucket_name')
  validateBucketName(errors, config, 'cloud_bucket')
}

export function validateScriptSettings({ id, label, config } = {}) {
  const scriptSchema = getScriptSettingsSchema({ id, label })
  if (!scriptSchema) return {}

  const errors = {}
  const safeConfig = config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  const sourceType = safeConfig.source_type === 'cloud' ? 'cloud' : 'local'
  const uploadTarget = safeConfig.upload_target === 'local' ? 'local' : 'gcs'
  const requiredFields = [
    ...(scriptSchema.required || []),
    ...((scriptSchema.requiredWhen && scriptSchema.requiredWhen[sourceType]) || []),
  ].filter((path) => !(path === 'credentials_file' && uploadTarget === 'local'))

  requiredFields.forEach((path) => validateRequiredField(errors, safeConfig, path))
  if (['deliver files', 'upload to gcs'].includes(normalizeText(label))) {
    const uploadTarget = safeConfig.upload_target === 'local' ? 'local' : 'gcs'
    validateRequiredField(errors, safeConfig, uploadTarget === 'local' ? 'local_output_dir' : 'bucket_name')
  }
  getOrderedConfigEntries(safeConfig, scriptSchema).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.keys(value).forEach((childKey) => validateNumberField(errors, safeConfig, `${key}.${childKey}`))
      return
    }
    validateNumberField(errors, safeConfig, key)
  })
  validateCommonSettings(errors, safeConfig)

  return errors
}

export function validateIngestionSettings(settings = {}) {
  const safeSettings = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
  const errors = {}
  const sourceType = safeSettings.source_type === 'cloud' ? 'cloud' : 'local'
  const deliveryTarget = safeSettings.upload_target === 'local' ? 'local' : 'gcs'
  const requiredFields =
    sourceType === 'cloud'
      ? ['cloud_bucket']
      : [
          'source_dir',
          ...(deliveryTarget === 'local' ? [] : ['credentials_file']),
          'nonbdo_matrix',
          'bdo_matrix',
        ]

  requiredFields.forEach((path) => validateRequiredField(errors, safeSettings, path))
  validateRequiredField(errors, safeSettings, 'valid_extensions')
  validateRequiredField(errors, safeSettings, deliveryTarget === 'local' ? 'local_output_dir' : 'bucket_name')
  validateCommonSettings(errors, safeSettings)

  return errors
}

export function getFieldSchema(key, value) {
  if (fieldSchemas[key]) return fieldSchemas[key]
  if (Array.isArray(value)) return { label: null, type: 'list' }
  if (typeof value === 'boolean') return { label: null, type: 'boolean' }
  if (typeof value === 'number') return { label: null, type: 'number' }
  if (key.includes('dir') || key.includes('file') || key.includes('path')) {
    return { label: null, type: 'path', placeholder: 'Enter a path' }
  }
  return { label: null, type: 'text' }
}
