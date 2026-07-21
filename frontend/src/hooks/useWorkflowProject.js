import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addEdge, applyEdgeChanges } from 'react-flow-renderer'

import { displayText } from '../utils/format'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001'
const INGESTION_WORKSPACE_NAME = 'Ingestion Runner'
const ACTIVE_RUN_STATUSES = new Set(['starting', 'queued', 'running', 'stopping'])
const DEFAULT_AUTOSAVE_DELAY_MS = 900
const RUNNER_STATUS_POLL_MS = 7000
const ACTIVE_RUN_POLL_MS = 1500
const SELECTION_STORAGE_KEY = 'workflow-builder-selection'

const defaultIngestionSettings = {
  source_type: 'local_path',
  source_dir: '',
  credentials_file: '',
  nonbdo_matrix: '',
  bdo_matrix: '',
  cloud_provider: 'Google Cloud Storage',
  cloud_bucket: '',
  cloud_prefix: '',
  cloud_credentials_ref: '',
  valid_extensions: ['.csv', '.xlsx', '.xls', '.xlsb', '.xlsm', '.txt', '.zip'],
  skip_name_contains: [],
  bucket_name: '',
  sandbox_prefix: '',
  dry_run: true,
  upload_target: 'gcs',
  local_output_dir: '',
  local_overwrite: true,
  upload_workers: 8,
}

function getBrowserTimezoneLabel() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time'
  } catch {
    return 'Local time'
  }
}

function getBrowserOffsetMinutes() {
  return -new Date().getTimezoneOffset()
}

export function dateInputValue(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function defaultSchedule() {
  const now = new Date()
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000)
  const pad = (value) => String(value).padStart(2, '0')
  return {
    enabled: false,
    type: 'once',
    date: `${nextHour.getFullYear()}-${pad(nextHour.getMonth() + 1)}-${pad(nextHour.getDate())}`,
    time: `${pad(nextHour.getHours())}:${pad(nextHour.getMinutes())}`,
    days_of_week: [],
    utc_offset_minutes: getBrowserOffsetMinutes(),
    timezone_label: getBrowserTimezoneLabel(),
    next_run_at: null,
    last_run_at: null,
  }
}

export function normalizeSchedule(schedule) {
  const base = defaultSchedule()
  const merged = { ...base, ...(schedule || {}) }
  merged.enabled = Boolean(merged.enabled)
  merged.type = ['once', 'later', 'weekly', 'interval'].includes(merged.type) ? merged.type : 'once'
  if (merged.type === 'later') {
    merged.type = 'once'
  }
  merged.date = merged.date || base.date
  merged.time = merged.time || base.time
  merged.timezone_label = getBrowserTimezoneLabel()
  merged.utc_offset_minutes = getBrowserOffsetMinutes()
  merged.days_of_week = Array.isArray(merged.days_of_week)
    ? merged.days_of_week
        .map((day) => Number(day))
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : base.days_of_week
  merged.next_run_at = merged.next_run_at || null
  merged.last_run_at = merged.last_run_at || null
  merged.every_minutes = merged.every_minutes ? Number(merged.every_minutes) : null
  return merged
}

export function isScheduleInFuture(schedule) {
  if (!schedule?.enabled) return true
  if (schedule.type === 'weekly') return true
  if (!schedule.date || !schedule.time) return false
  return new Date(`${schedule.date}T${schedule.time}`) > new Date()
}

export function prepareScheduleForSave(schedule) {
  return normalizeSchedule({ ...schedule, enabled: true })
}

function normalizeFlowPosition(position, fallback = { x: 0, y: 0 }) {
  const fallbackX = Number(fallback?.x)
  const fallbackY = Number(fallback?.y)
  const x = Number(position?.x)
  const y = Number(position?.y)
  return {
    x: Number.isFinite(x) ? x : Number.isFinite(fallbackX) ? fallbackX : 0,
    y: Number.isFinite(y) ? y : Number.isFinite(fallbackY) ? fallbackY : 0,
  }
}

export const createScriptNode = (index, values) => ({
  id: values.id || `node-${Date.now()}`,
  label: values.label,
  script: values.script,
  config: values.config,
  position: normalizeFlowPosition(values.position, { x: 120 + index * 260, y: 160 }),
})

export const createScriptDefinition = (values) => ({
  id: values.id || `script-${Date.now()}`,
  label: values.label,
  script: values.script,
  config: values.config || {},
})

export function isActiveRunStatus(status) {
  return ACTIVE_RUN_STATUSES.has(status)
}

function formatApiError(body, status) {
  const detail = body?.detail
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (typeof item === 'string') return item
      const location = Array.isArray(item?.loc) ? item.loc.join('.') : displayText(item?.loc)
      const message = displayText(item?.msg || item?.message || item)
      return location ? `${location}: ${message}` : message
    })
    return messages.filter(Boolean).join('\n') || `Request failed with ${status}`
  }
  return displayText(detail || body?.message || body?.error, `Request failed with ${status}`)
}

function normalizeWorkflow(workflow = {}) {
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : []
  const edges = Array.isArray(workflow.edges) ? workflow.edges : []
  const settings = workflow.settings && typeof workflow.settings === 'object' ? workflow.settings : {}
  const existingLibrary = Array.isArray(settings.script_library) ? settings.script_library : []
  const scriptLibrary = existingLibrary.length
    ? existingLibrary
    : nodes.map((node) =>
        createScriptDefinition({
          id: node.id,
          label: node.label,
          script: node.script,
          config: node.config,
        }),
      )
  const canvasNodes = nodes.length
    ? nodes
    : scriptLibrary.map((script, index) =>
        createScriptNode(index, {
          ...script,
          position: { x: 120 + index * 280, y: 180 + (index % 2) * 180 },
        }),
      )

  return {
    ...workflow,
    nodes: canvasNodes,
    edges: canvasNodes.length ? edges : [],
    settings: {
      ...settings,
      ingestion_defaults: {
        ...defaultIngestionSettings,
        ...(settings.ingestion_defaults || {}),
      },
      script_library: scriptLibrary,
    },
  }
}

function updateConfigForDefaults(script, defaults, scope) {
  const label = displayText(script.label).toLowerCase()
  const config = { ...(script.config || {}) }

  if (scope === 'environment' && label === 'validate environment') {
    return {
      ...script,
      config: {
        ...config,
        source_type: defaults.source_type,
        source_dir: defaults.source_dir,
        upload_target: defaults.upload_target,
        credentials_file: defaults.credentials_file,
        nonbdo_matrix: defaults.nonbdo_matrix,
        bdo_matrix: defaults.bdo_matrix,
        cloud_provider: defaults.cloud_provider,
        cloud_bucket: defaults.cloud_bucket,
        cloud_prefix: defaults.cloud_prefix,
        cloud_credentials_ref: defaults.cloud_credentials_ref,
      },
    }
  }

  if (scope === 'discovery' && label === 'scan candidate files') {
    return {
      ...script,
      config: {
        ...config,
        valid_extensions: defaults.valid_extensions,
        skip_name_contains: defaults.skip_name_contains,
      },
    }
  }

  if (scope === 'destination' && ['build destination paths', 'build gcs destination', 'deliver files', 'upload to gcs'].includes(label)) {
    return {
      ...script,
      config: {
        ...config,
        bucket_name: defaults.bucket_name,
        dry_run: defaults.dry_run,
        ...(label === 'deliver files' || label === 'upload to gcs'
          ? {
              upload_target: defaults.upload_target,
              local_output_dir: defaults.local_output_dir,
              local_overwrite: defaults.local_overwrite,
              upload_workers: defaults.upload_workers,
            }
          : {}),
        ...(['build destination paths', 'build gcs destination'].includes(label) ? { sandbox_prefix: defaults.sandbox_prefix } : {}),
      },
    }
  }

  return script
}

function syncDefaultsFromScript(currentDefaults, script) {
  const label = displayText(script.label).toLowerCase()
  const config = script.config || {}
  const nextDefaults = { ...currentDefaults }

  function copyConfigValue(key) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      nextDefaults[key] = config[key]
    }
  }

  if (label === 'validate environment') {
    copyConfigValue('source_type')
    copyConfigValue('source_dir')
    copyConfigValue('credentials_file')
    copyConfigValue('nonbdo_matrix')
    copyConfigValue('bdo_matrix')
    copyConfigValue('cloud_provider')
    copyConfigValue('cloud_bucket')
    copyConfigValue('cloud_prefix')
    copyConfigValue('cloud_credentials_ref')
  }

  if (label === 'scan candidate files') {
    copyConfigValue('valid_extensions')
    copyConfigValue('skip_name_contains')
  }

  if (['build destination paths', 'build gcs destination'].includes(label)) {
    copyConfigValue('bucket_name')
    copyConfigValue('sandbox_prefix')
    copyConfigValue('dry_run')
  }

  if (['deliver files', 'upload to gcs'].includes(label)) {
    copyConfigValue('bucket_name')
    copyConfigValue('dry_run')
    copyConfigValue('upload_target')
    copyConfigValue('local_output_dir')
    copyConfigValue('local_overwrite')
    copyConfigValue('upload_workers')
  }

  return nextDefaults
}

function findScriptByLabel(project, label) {
  const scripts = project?.workflow.settings?.script_library || []
  return scripts.find((script) => displayText(script.label).toLowerCase() === label.toLowerCase())
}

function findScriptByAnyLabel(project, labels) {
  const scripts = project?.workflow.settings?.script_library || []
  const normalizedLabels = new Set(labels.map((label) => label.toLowerCase()))
  return scripts.find((script) => normalizedLabels.has(displayText(script.label).toLowerCase()))
}

function deriveIngestionSettings(project) {
  const defaults = {
    ...defaultIngestionSettings,
    ...(project?.workflow.settings?.ingestion_defaults || {}),
  }
  const environment = findScriptByLabel(project, 'Validate Environment')?.config || {}
  const discovery = findScriptByLabel(project, 'Scan Candidate Files')?.config || {}
  const destination = findScriptByAnyLabel(project, ['Build Destination Paths', 'Build GCS Destination'])?.config || {}
  const upload = findScriptByAnyLabel(project, ['Deliver Files', 'Upload to GCS'])?.config || {}

  return {
    ...defaults,
    source_type: environment.source_type || defaults.source_type,
    source_dir: environment.source_dir ?? defaults.source_dir,
    credentials_file: environment.credentials_file ?? defaults.credentials_file,
    nonbdo_matrix: environment.nonbdo_matrix ?? defaults.nonbdo_matrix,
    bdo_matrix: environment.bdo_matrix ?? defaults.bdo_matrix,
    cloud_provider: environment.cloud_provider || defaults.cloud_provider || 'Google Cloud Storage',
    cloud_bucket: environment.cloud_bucket || defaults.cloud_bucket || '',
    cloud_prefix: environment.cloud_prefix || defaults.cloud_prefix || '',
    cloud_credentials_ref: environment.cloud_credentials_ref || defaults.cloud_credentials_ref || '',
    valid_extensions: discovery.valid_extensions || defaults.valid_extensions,
    skip_name_contains: discovery.skip_name_contains || defaults.skip_name_contains,
    bucket_name: destination.bucket_name || upload.bucket_name || defaults.bucket_name,
    sandbox_prefix: destination.sandbox_prefix ?? defaults.sandbox_prefix,
    dry_run:
      typeof destination.dry_run === 'boolean'
        ? destination.dry_run
        : typeof upload.dry_run === 'boolean'
          ? upload.dry_run
          : defaults.dry_run,
    upload_target: upload.upload_target || defaults.upload_target,
    local_output_dir: upload.local_output_dir ?? defaults.local_output_dir,
    local_overwrite:
      typeof upload.local_overwrite === 'boolean'
        ? upload.local_overwrite
        : defaults.local_overwrite,
    upload_workers: upload.upload_workers ?? defaults.upload_workers,
  }
}

function normalizeProject(data) {
  if (!data) return data
  return {
    ...data,
    workflow: normalizeWorkflow(data.workflow),
    schedule: normalizeSchedule(data.schedule),
  }
}

function serializeProjectForSave(project) {
  if (!project) return null
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    workflow: project.workflow,
    schedule: normalizeSchedule(project.schedule),
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function getProjectSnapshot(project) {
  return stableStringify(serializeProjectForSave(project))
}

function getIdleRunPollDelay(schedule) {
  const normalized = normalizeSchedule(schedule)
  if (!normalized.enabled || !normalized.next_run_at) return 15000
  const msUntilNextRun = new Date(normalized.next_run_at).getTime() - Date.now()
  if (!Number.isFinite(msUntilNextRun)) return 15000
  if (msUntilNextRun <= 0) return 700
  if (msUntilNextRun <= 30 * 1000) return 700
  if (msUntilNextRun <= 2 * 60 * 1000) return 1500
  if (msUntilNextRun <= 5 * 60 * 1000) return 5000
  return 30000
}

function readStoredSelection() {
  try {
    return JSON.parse(window.localStorage.getItem(SELECTION_STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function getRunStateSignature(state = {}) {
  const nodes = state.nodes || []
  const logs = state.logs || []
  const lastLog = logs.at(-1) || {}
  const nodeStatusSignature = nodes
    .map((node) => `${node.node_id}:${node.status}:${node.finished_at || ''}`)
    .join(',')

  return [
    state.status || 'idle',
    state.runId || '',
    state.result?.status || '',
    nodeStatusSignature,
    logs.length,
    lastLog.id || '',
    lastLog.created_at || '',
    lastLog.node_id || '',
    lastLog.message || '',
  ].join('|')
}

function formatNodeDuration(startedAt, finishedAt = null) {
  const started = startedAt ? new Date(startedAt).getTime() : null
  const finished = finishedAt ? new Date(finishedAt).getTime() : Date.now()
  if (!started || !Number.isFinite(started) || !Number.isFinite(finished)) return ''
  const totalSeconds = Math.max(0, Math.floor((finished - started) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`
}

function shallowEqualObject(first = {}, second = {}) {
  const firstKeys = Object.keys(first)
  const secondKeys = Object.keys(second)
  if (firstKeys.length !== secondKeys.length) return false
  return firstKeys.every((key) => Object.is(first[key], second[key]))
}

function areFlowNodeDataEqual(first = {}, second = {}) {
  return (
    Object.is(first.label, second.label) &&
    Object.is(first.script, second.script) &&
    Object.is(first.status, second.status) &&
    shallowEqualObject(first.config, second.config)
  )
}

function samePosition(first = {}, second = {}) {
  return Object.is(first.x, second.x) && Object.is(first.y, second.y)
}

function useWorkflowProject({ notify } = {}) {
  const [project, setProject] = useState(null)
  const storedSelection = useMemo(readStoredSelection, [])
  const [selectedNodeId, setSelectedNodeId] = useState(storedSelection.selectedNodeId || null)
  const [selectedEdgeId, setSelectedEdgeId] = useState(storedSelection.selectedEdgeId || null)
  const [isLoading, setIsLoading] = useState(true)
  const [runStates, setRunStates] = useState({})
  const [runnerStatus, setRunnerStatus] = useState({
    active: false,
    activeRunCount: 0,
    heartbeatActive: false,
    status: 'unknown',
  })
  const [error, setError] = useState('')
  const [draftSchedule, setDraftSchedule] = useState(defaultSchedule())
  const [scheduleModalError, setScheduleModalError] = useState('')
  const [autoSaveStatus, setAutoSaveStatus] = useState({ state: 'saved', savedAt: null, error: '' })
  const [nodePositions, setNodePositions] = useState(() => new Map())
  const runPollTimerRef = useRef(null)
  const runStatesRef = useRef(runStates)
  const flowNodesCacheRef = useRef([])
  const flowEdgesCacheRef = useRef([])
  const autoSaveTimerRef = useRef(null)
  const autoSaveDelayRef = useRef(DEFAULT_AUTOSAVE_DELAY_MS)
  const lastSavedSnapshotRef = useRef('')
  const saveInFlightRef = useRef(false)
  const queuedSaveProjectRef = useRef(null)

  const activeRunState = runStates[project?.id] || {
    createdAt: null,
    finishedAt: null,
    status: 'idle',
    runId: null,
    startedAt: null,
    result: null,
    logs: [],
    nodes: [],
  }
  const isRunning = isActiveRunStatus(activeRunState.status)
  const isStopping = activeRunState.status === 'stopping'
  const canStopFlow = activeRunState.status === 'queued' || activeRunState.status === 'running'

  const runResult = useMemo(
    () =>
      (activeRunState.nodes?.length
        ? {
            status: activeRunState.status,
            results: activeRunState.nodes,
          }
        : activeRunState.result || null),
    [activeRunState.nodes, activeRunState.result, activeRunState.status],
  )

  const selectedNode = useMemo(
    () => project?.workflow.nodes.find((node) => node.id === selectedNodeId),
    [project, selectedNodeId],
  )
  const scriptLibrary = useMemo(
    () => project?.workflow.settings?.script_library || [],
    [project],
  )
  const canvasNodeIds = useMemo(
    () => new Set((project?.workflow.nodes || []).map((node) => node.id)),
    [project],
  )
  const selectedNodeLabel = displayText(selectedNode?.label, 'this script')
  const selectedNodeResults = useMemo(
    () => (runResult?.results || []).filter((item) => item.node_id === selectedNodeId),
    [runResult, selectedNodeId],
  )
  const selectedNodeLogs = useMemo(
    () =>
      (activeRunState.logs || []).filter(
        (log) =>
          log.node_id === selectedNodeId ||
          (!log.node_id && selectedNode?.label && displayText(log.node_label) === selectedNodeLabel),
      ),
    [activeRunState.logs, selectedNode?.label, selectedNodeId, selectedNodeLabel],
  )
  const runStatusByNode = useMemo(() => {
    const map = new Map()
    runResult?.results.forEach((item) => map.set(item.node_id, item.status))
    return map
  }, [runResult])

  const runTimingByNode = useMemo(() => {
    const map = new Map()
    runResult?.results.forEach((item) => {
      map.set(item.node_id, {
        duration: formatNodeDuration(item.started_at, item.finished_at),
        finishedAt: item.finished_at,
        startedAt: item.started_at,
      })
    })
    return map
  }, [runResult])
  const activeSchedule = useMemo(() => normalizeSchedule(project?.schedule), [project])
  const ingestionSettings = useMemo(() => deriveIngestionSettings(project), [project])

  useEffect(() => {
    window.localStorage.setItem(
      SELECTION_STORAGE_KEY,
      JSON.stringify({
        selectedNodeId,
        selectedEdgeId,
      }),
    )
  }, [selectedEdgeId, selectedNodeId])

  useEffect(() => {
    setNodePositions(
      new Map(
        (project?.workflow.nodes || []).map((node) => [
          node.id,
          normalizeFlowPosition(node.position),
        ]),
      ),
    )
  }, [project?.id, project?.workflow.nodes.length])

  const workflowNodes = project?.workflow.nodes || []
  const workflowEdges = project?.workflow.edges || []

  const flowNodes = useMemo(() => {
    const previousById = new Map(flowNodesCacheRef.current.map((node) => [node.id, node]))
    const nextNodes = workflowNodes.map((node) => {
      const previous = previousById.get(node.id)
      const position = normalizeFlowPosition(nodePositions.get(node.id) || node.position)
      const data = {
        label: node.label,
        script: node.script,
        config: node.config,
        duration: runTimingByNode.get(node.id)?.duration || '',
        status: runStatusByNode.get(node.id),
      }

      if (
        previous &&
        previous.type === 'script' &&
        samePosition(previous.position, position) &&
        areFlowNodeDataEqual(previous.data, data)
      ) {
        return previous
      }

      return {
        id: node.id,
        type: 'script',
        position,
        data,
      }
    })
    flowNodesCacheRef.current = nextNodes
    return nextNodes
  }, [nodePositions, runStatusByNode, runTimingByNode, workflowNodes])

  const flowEdges = useMemo(() => {
    const previousById = new Map(flowEdgesCacheRef.current.map((edge) => [edge.id, edge]))
    const nextEdges = workflowEdges.map((edge) => {
      const previous = previousById.get(edge.id)
      const isSelected = edge.id === selectedEdgeId
      const style = {
        stroke: isSelected ? '#2563eb' : '#64748b',
        strokeWidth: isSelected ? 3.5 : 2.5,
      }

      if (
        previous &&
        previous.source === edge.source &&
        previous.target === edge.target &&
        previous.selected === isSelected &&
        previous.animated === isRunning &&
        shallowEqualObject(previous.style, style)
      ) {
        return previous
      }

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'smoothstep',
        selected: isSelected,
        animated: isRunning,
        style,
      }
    })
    flowEdgesCacheRef.current = nextEdges
    return nextEdges
  }, [isRunning, selectedEdgeId, workflowEdges])

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(formatApiError(body, response.status))
    }
    if (response.status === 204) return null
    return response.json()
  }, [])

  function selectFirstNode(nextProject) {
    const nodes = nextProject.workflow.nodes || []
    const edges = nextProject.workflow.edges || []
    if (selectedNodeId && nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedEdgeId(null)
      return
    }
    if (selectedEdgeId && edges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedNodeId(null)
      return
    }
    const firstNode = nextProject.workflow.nodes[0]
    setSelectedNodeId(firstNode?.id || null)
    setSelectedEdgeId(null)
  }

  const loadProjects = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const data = (await request('/api/projects')).map(normalizeProject)
      let gcsProject = data.find((item) => item.name === INGESTION_WORKSPACE_NAME) || data.find((item) => item.name === 'GCS Ingestion')
      if (!gcsProject) {
        gcsProject = normalizeProject(
          await request('/api/projects', {
            method: 'POST',
            body: JSON.stringify({
              name: INGESTION_WORKSPACE_NAME,
              description: 'Single workspace for the ingestion workflow.',
              workflow: { nodes: [], edges: [] },
            }),
          }),
        )
      }
      setProject(gcsProject)
      lastSavedSnapshotRef.current = getProjectSnapshot(gcsProject)
      selectFirstNode(gcsProject)
    } catch (err) {
      setError(err.message)
      setAutoSaveStatus({ state: 'error', savedAt: null, error: err.message })
      notify?.(err.message, 'error')
    } finally {
      setIsLoading(false)
    }
  }, [request])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  useEffect(() => {
    let isMounted = true
    let isRefreshing = false

    async function refreshRunnerStatus() {
      if (isRefreshing) return
      isRefreshing = true
      try {
        const status = await request(`/api/runner/status?t=${Date.now()}`, { cache: 'no-store' })
        if (isMounted) {
          const nextStatus = {
            active: Boolean(status.active),
            activeRunCount: Number(status.active_run_count) || 0,
            heartbeatActive: status.heartbeat_active !== false,
            status: status.status || 'unknown',
          }
          setRunnerStatus((current) =>
            current.active === nextStatus.active &&
            current.activeRunCount === nextStatus.activeRunCount &&
            current.heartbeatActive === nextStatus.heartbeatActive &&
            current.status === nextStatus.status
              ? current
              : nextStatus,
          )
        }
      } catch {
        if (isMounted) {
          setRunnerStatus((current) =>
            current.active === false && current.status === 'offline'
              ? current
              : { active: false, activeRunCount: 0, heartbeatActive: false, status: 'offline' },
          )
        }
      } finally {
        isRefreshing = false
      }
    }

    refreshRunnerStatus()
    const intervalId = setInterval(refreshRunnerStatus, RUNNER_STATUS_POLL_MS)
    window.addEventListener('focus', refreshRunnerStatus)
    document.addEventListener('visibilitychange', refreshRunnerStatus)
    return () => {
      isMounted = false
      clearInterval(intervalId)
      window.removeEventListener('focus', refreshRunnerStatus)
      document.removeEventListener('visibilitychange', refreshRunnerStatus)
    }
  }, [request])

  useEffect(
    () => () => {
      if (runPollTimerRef.current) {
        clearTimeout(runPollTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    runStatesRef.current = runStates
  }, [runStates])

  function setProjectRunState(projectId, nextState) {
    setRunStates((current) => {
      const mergedState = {
        status: 'idle',
        runId: null,
        result: null,
        logs: [],
        nodes: [],
        ...current[projectId],
        ...nextState,
      }

      if (getRunStateSignature(current[projectId]) === getRunStateSignature(mergedState)) {
        return current
      }

      return {
        ...current,
        [projectId]: mergedState,
      }
    })
  }

  const markAutoSaveDelay = useCallback((delayMs) => {
    autoSaveDelayRef.current = delayMs
  }, [])

  const updateProject = useCallback((updater, options = {}) => {
    if (options.autoSaveDelayMs) {
      markAutoSaveDelay(options.autoSaveDelayMs)
    }
    setProject((current) => (current ? updater(current) : current))
  }, [markAutoSaveDelay])

  const updateScriptDefinitionWithDependencies = useCallback((scriptId, changes, dependencyIds = null) => {
    updateProject((current) => {
      const nextScript = (current.workflow.settings?.script_library || [])
        .map((script) => (script.id === scriptId ? { ...script, ...changes } : script))
        .find((script) => script.id === scriptId)
      const currentDefaults = {
        ...defaultIngestionSettings,
        ...(current.workflow.settings?.ingestion_defaults || {}),
      }
      const safeDependencyIds = Array.isArray(dependencyIds)
        ? [...new Set(dependencyIds.filter((id) => id && id !== scriptId))]
        : null
      const currentEdges = current.workflow.edges || []
      const nextEdges =
        safeDependencyIds === null
          ? currentEdges
          : [
              ...currentEdges.filter((edge) => edge.target !== scriptId),
              ...safeDependencyIds
                .filter((sourceId) => current.workflow.nodes.some((node) => node.id === sourceId))
                .map((sourceId) => ({
                  id: `edge-${sourceId}-${scriptId}`,
                  source: sourceId,
                  target: scriptId,
                })),
            ]

      return {
        ...current,
        workflow: {
          ...current.workflow,
          nodes: current.workflow.nodes.map((node) =>
            node.id === scriptId ? { ...node, ...changes } : node,
          ),
          edges: nextEdges,
          settings: {
            ...current.workflow.settings,
            ingestion_defaults: nextScript
              ? syncDefaultsFromScript(currentDefaults, nextScript)
              : currentDefaults,
            script_library: (current.workflow.settings?.script_library || []).map((script) =>
              script.id === scriptId ? { ...script, ...changes } : script,
            ),
          },
        },
      }
    }, { autoSaveDelayMs: 250 })
  }, [updateProject])

  const saveIngestionSettings = useCallback((settings) => {
    const nextSettings = {
      ...defaultIngestionSettings,
      ...(settings || {}),
    }
    updateProject((current) => ({
      ...current,
      workflow: {
        ...current.workflow,
        nodes: current.workflow.nodes.map((node) =>
          updateConfigForDefaults(updateConfigForDefaults(updateConfigForDefaults(node, nextSettings, 'environment'), nextSettings, 'discovery'), nextSettings, 'destination'),
        ),
        settings: {
          ...current.workflow.settings,
          ingestion_defaults: nextSettings,
          script_library: (current.workflow.settings?.script_library || []).map((script) =>
            updateConfigForDefaults(updateConfigForDefaults(updateConfigForDefaults(script, nextSettings, 'environment'), nextSettings, 'discovery'), nextSettings, 'destination'),
          ),
        },
      },
    }), { autoSaveDelayMs: 250 })
  }, [updateProject])

  const addScriptToCanvas = useCallback((script, position = null) => {
    if (!script) return
    updateProject((current) => {
      if (!current || current.workflow.nodes.some((node) => node.id === script.id)) return current
      const node = createScriptNode(current.workflow.nodes.length + 1, {
        ...script,
        position,
      })
      setSelectedNodeId(node.id)
      setSelectedEdgeId(null)
      return {
        ...current,
        workflow: {
          ...current.workflow,
          nodes: [...current.workflow.nodes, node],
        },
      }
    }, { autoSaveDelayMs: 1200 })
  }, [updateProject])

  const addScriptDefinition = useCallback((values) => {
    updateProject((current) => {
      const scriptDefinition = createScriptDefinition(values)
      return {
        ...current,
        workflow: {
          ...current.workflow,
          settings: {
            ...current.workflow.settings,
            script_library: [
              ...(current.workflow.settings?.script_library || []),
              scriptDefinition,
            ],
          },
        },
      }
    }, { autoSaveDelayMs: 250 })
  }, [updateProject])

  const deleteScriptDefinition = useCallback((ids) => {
    const idSet = new Set(ids)
    const nextNode = project?.workflow.nodes.find((node) => !idSet.has(node.id))
    updateProject((current) => ({
      ...current,
      workflow: {
        ...current.workflow,
        nodes: current.workflow.nodes.filter((node) => !idSet.has(node.id)),
        edges: current.workflow.edges.filter(
          (edge) => !idSet.has(edge.source) && !idSet.has(edge.target),
        ),
        settings: {
          ...current.workflow.settings,
          script_library: (current.workflow.settings?.script_library || []).filter(
            (script) => !idSet.has(script.id),
          ),
        },
      },
    }), { autoSaveDelayMs: 250 })
    setSelectedNodeId((nodeId) => (nodeId && idSet.has(nodeId) ? nextNode?.id || null : nodeId))
    setSelectedEdgeId(null)
  }, [project?.workflow.nodes, updateProject])

  const deleteCanvasNodes = useCallback((ids) => {
    const idSet = new Set(ids)
    const nextNode = project?.workflow.nodes.find((node) => !idSet.has(node.id))
    setSelectedEdgeId(null)
    updateProject((current) => ({
      ...current,
      workflow: {
        ...current.workflow,
        nodes: current.workflow.nodes.filter((node) => !idSet.has(node.id)),
        edges: current.workflow.edges.filter(
          (edge) => !idSet.has(edge.source) && !idSet.has(edge.target),
        ),
      },
    }), { autoSaveDelayMs: 250 })
    setSelectedNodeId(nextNode?.id || null)
  }, [project?.workflow.nodes, updateProject])

  const deleteEdges = useCallback((ids) => {
    const idSet = new Set(ids)
    updateProject((current) => ({
      ...current,
      workflow: {
        ...current.workflow,
        edges: current.workflow.edges.filter((edge) => !idSet.has(edge.id)),
      },
    }), { autoSaveDelayMs: 250 })
    setSelectedEdgeId(null)
  }, [updateProject])

  function updateDraftSchedule(changes) {
    setDraftSchedule((current) =>
      normalizeSchedule({
        ...current,
        ...changes,
        enabled: true,
      }),
    )
  }

  function toggleDraftScheduleDay(day) {
    setDraftSchedule((current) => {
      const currentDays = Array.isArray(current.days_of_week) ? current.days_of_week : []
      const nextDays = currentDays.includes(day)
        ? currentDays.filter((value) => value !== day)
        : [...currentDays, day].sort((a, b) => a - b)
      return normalizeSchedule({
        ...current,
        enabled: true,
        type: 'weekly',
        days_of_week: nextDays,
      })
    })
  }

  const saveProject = useCallback(async (projectOverride = null) => {
    const hasProjectOverride =
      projectOverride &&
      typeof projectOverride === 'object' &&
      'workflow' in projectOverride &&
      'id' in projectOverride
    const projectToSave = serializeProjectForSave(hasProjectOverride ? projectOverride : project)
    if (!projectToSave) return null
    const saveSnapshot = stableStringify(projectToSave)

    if (saveSnapshot === lastSavedSnapshotRef.current) {
      return hasProjectOverride ? normalizeProject(projectToSave) : project
    }

    if (saveInFlightRef.current) {
      queuedSaveProjectRef.current = projectToSave
      setAutoSaveStatus((current) => ({ ...current, state: 'pending' }))
      return null
    }

    setError('')
    setAutoSaveStatus((current) => ({ ...current, state: 'saving', error: '' }))
    saveInFlightRef.current = true

    try {
      const saved = await request(`/api/projects/${projectToSave.id}`, {
        method: 'PUT',
        body: JSON.stringify(projectToSave),
      })

      const normalized = normalizeProject(saved)
      setProject(normalized)
      lastSavedSnapshotRef.current = getProjectSnapshot(normalized)
      setError('')
      setAutoSaveStatus({ state: 'saved', savedAt: new Date().toISOString(), error: '' })
      return normalized
    } catch (err) {
      setError(err.message)
      setAutoSaveStatus({ state: 'error', savedAt: null, error: err.message })
      notify?.(err.message, 'error')
      return null
    } finally {
      saveInFlightRef.current = false
      const queuedProject = queuedSaveProjectRef.current
      queuedSaveProjectRef.current = null
      if (queuedProject && stableStringify(queuedProject) !== lastSavedSnapshotRef.current) {
        window.setTimeout(() => saveProject(queuedProject), 0)
      }
    }
  }, [notify, project, request])

  const saveWorkspace = useCallback(async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
      autoSaveTimerRef.current = null
    }
    autoSaveDelayRef.current = DEFAULT_AUTOSAVE_DELAY_MS
    const saved = await saveProject()
    if (saved) {
      notify?.('Workspace saved.', 'success')
    }
    return saved
  }, [notify, saveProject])

  async function saveSchedule(event) {
    event.preventDefault()
    const nextSchedule = prepareScheduleForSave(draftSchedule)
    if (nextSchedule.type === 'weekly' && nextSchedule.days_of_week.length === 0) {
      setScheduleModalError('Choose at least one weekly run day.')
      return false
    }
    if (!isScheduleInFuture(nextSchedule)) {
      setScheduleModalError('Choose a future date and time.')
      return false
    }
    const nextProject = serializeProjectForSave(
      project
        ? {
            ...project,
            schedule: nextSchedule,
          }
        : null,
    )
    const saved = await saveProject(nextProject)
    if (saved) {
      setScheduleModalError('')
      return true
    }
    setDraftSchedule(normalizeSchedule(project?.schedule))
    return false
  }

  async function cancelScheduledRun() {
    const nextProject = serializeProjectForSave(
      project
        ? {
            ...project,
            schedule: {
              ...normalizeSchedule(project.schedule),
              enabled: false,
              next_run_at: null,
            },
          }
        : null,
    )
    const saved = await saveProject(nextProject)
    if (saved) {
      setScheduleModalError('')
      return true
    }
    setDraftSchedule(normalizeSchedule(project?.schedule))
    return false
  }

  useEffect(() => {
    if (isLoading || !project?.id) return undefined

    const projectToSave = serializeProjectForSave(project)
    if (!projectToSave) return undefined

    const nextSnapshot = stableStringify(projectToSave)
    if (nextSnapshot === lastSavedSnapshotRef.current) return undefined
    setAutoSaveStatus((current) => (current.state === 'saving' ? current : { ...current, state: 'pending' }))

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    const saveDelay = autoSaveDelayRef.current
    autoSaveTimerRef.current = setTimeout(() => {
      saveProject(projectToSave)
      autoSaveDelayRef.current = DEFAULT_AUTOSAVE_DELAY_MS
    }, saveDelay)

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [isLoading, project, saveProject])

  const onNodesChange = useCallback((changes) => {
    const positionChanges = changes.filter((change) => change.type === 'position')
    const projectChanges = changes.filter((change) => change.type !== 'position')

    if (positionChanges.length > 0) {
      setNodePositions((current) => {
        const nextPositions = new Map(current)
        positionChanges.forEach((change) => {
          if (change.position) {
            nextPositions.set(change.id, normalizeFlowPosition(change.position))
          }
        })
        return nextPositions
      })
    }

    if (projectChanges.length === 0) return

    markAutoSaveDelay(400)
    setProject((current) => {
      if (!current) return current
      const removedIds = projectChanges
        .filter((change) => change.type === 'remove')
        .map((change) => change.id)
      const removedIdSet = new Set(removedIds)
      if (removedIds.length > 0) {
        setSelectedNodeId((nodeId) => (nodeId && removedIdSet.has(nodeId) ? null : nodeId))
        setSelectedEdgeId(null)
        setNodePositions((currentPositions) => {
          const nextPositions = new Map(currentPositions)
          removedIds.forEach((id) => nextPositions.delete(id))
          return nextPositions
        })
      }
      return {
        ...current,
        workflow: {
          ...current.workflow,
          nodes: current.workflow.nodes.filter((node) => !removedIdSet.has(node.id)),
          edges: current.workflow.edges.filter(
            (edge) => !removedIdSet.has(edge.source) && !removedIdSet.has(edge.target),
          ),
        },
      }
    })
  }, [markAutoSaveDelay])

  const onNodeDragStop = useCallback((_, node) => {
    if (!node?.id || !node.position) return
    markAutoSaveDelay(1200)
    setProject((current) => {
      if (!current) return current
      return {
        ...current,
        workflow: {
          ...current.workflow,
          nodes: current.workflow.nodes.map((item) =>
            item.id === node.id ? { ...item, position: normalizeFlowPosition(node.position, item.position) } : item,
          ),
        },
      }
    })
  }, [markAutoSaveDelay])

  const onEdgesChange = useCallback((changes) => {
    markAutoSaveDelay(400)
    setProject((current) => {
      if (!current) return current
      const changedEdges = applyEdgeChanges(changes, current.workflow.edges)
      setSelectedEdgeId((edgeId) =>
        edgeId && changedEdges.some((edge) => edge.id === edgeId) ? edgeId : null,
      )
      return {
        ...current,
        workflow: {
          ...current.workflow,
          edges: changedEdges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
          })),
        },
      }
    })
  }, [markAutoSaveDelay])

  const onConnect = useCallback((connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return
    markAutoSaveDelay(250)
    setProject((current) => {
      if (!current) return current
      setSelectedEdgeId(null)
      const exists = current.workflow.edges.some(
        (edge) => edge.source === connection.source && edge.target === connection.target,
      )
      if (exists) return current
      const nextEdges = addEdge(
        {
          ...connection,
          id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
          type: 'smoothstep',
        },
        current.workflow.edges,
      )
      return {
        ...current,
        workflow: {
          ...current.workflow,
          edges: nextEdges.map((edge) => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
          })),
        },
      }
    })
  }, [markAutoSaveDelay])

  async function runWorkflow() {
    if (!project || isRunning) return
    if (!runnerStatus.active) {
      const message = 'Runner service is offline. Start the runner before running the workflow.'
      notify?.(message, 'error')
      return
    }
    setProjectRunState(project.id, { status: 'starting', runId: null, result: null, logs: [], nodes: [] })
    setError('')
    try {
      const saved = await saveProject()
      const targetId = saved?.id || project.id
      const job = await request(`/api/projects/${targetId}/runs`, { method: 'POST' })
      notify?.('Workflow run queued.', 'success')
      setProjectRunState(targetId, {
        createdAt: job.created_at,
        runId: job.id,
        startedAt: job.started_at,
        status: job.status,
        result: job.result,
        logs: [],
        nodes: [],
      })
      pollRunStatus(targetId, job.id)
    } catch (err) {
      setProjectRunState(project.id, { status: 'idle' })
      setError(err.message)
      notify?.(err.message, 'error')
    }
  }

  async function stopWorkflow() {
    if (!project || !isRunning || !canStopFlow || isStopping) return
    setProjectRunState(project.id, { status: 'stopping' })
    setError('')
    try {
      const runId = runStatesRef.current[project.id]?.runId
      if (runId) {
        await request(`/api/runs/${runId}/stop`, { method: 'POST' })
      } else {
        await request(`/api/projects/${project.id}/stop`, { method: 'POST' })
      }
    } catch (err) {
      setError(err.message)
      notify?.(err.message, 'error')
    }
  }

  async function cancelActiveRun() {
    if (!project?.id) return
    try {
      const stopped = await request(`/api/projects/${project.id}/runs/cancel-active`, { method: 'POST' })
      setProjectRunState(project.id, {
        finishedAt: stopped?.finished_at || null,
        status: stopped?.status || 'stopped',
        runId: stopped?.id || activeRunState.runId || null,
        result: stopped?.result || activeRunState.result,
        logs: activeRunState.logs,
        nodes: activeRunState.nodes,
      })
      notify?.('Waiting run cleared.', 'success')
    } catch (err) {
      notify?.(err.message, 'error')
    }
  }

  const pollRunStatus = useCallback(async (projectId, runId = null) => {
    if (runPollTimerRef.current) {
      clearTimeout(runPollTimerRef.current)
    }
    try {
      const activeRunId = runId
      const previousStatus = runStatesRef.current[projectId]?.status
      const previousRunId = runStatesRef.current[projectId]?.runId
      let job = activeRunId ? null : await request(`/api/projects/${projectId}/run/status`)
      const nextRunId = activeRunId || job?.id || job?.run_id
      const previousLogs = previousRunId === nextRunId ? runStatesRef.current[projectId]?.logs || [] : []
      let nodes = []
      let logs = previousLogs
      if (nextRunId) {
        const afterLogId = previousLogs.at(-1)?.id || 0
        const snapshot = await request(`/api/runs/${nextRunId}/snapshot?after_log_id=${afterLogId}`)
        job = snapshot.run
        nodes = snapshot.nodes || []
        logs = afterLogId ? [...previousLogs, ...(snapshot.logs || [])] : snapshot.logs || []
      }
      const result =
        (nodes.length
          ? {
              project_id: projectId,
              run_id: nextRunId,
              status: job?.status,
              results: nodes,
            }
          : job?.result || runStatesRef.current[projectId]?.result || null)
      setProjectRunState(projectId, {
        createdAt: job?.created_at || runStatesRef.current[projectId]?.createdAt || null,
        finishedAt: job?.finished_at || null,
        startedAt: job?.started_at || runStatesRef.current[projectId]?.startedAt || null,
        status: job?.status || 'idle',
        runId: nextRunId || null,
        result,
        logs,
        nodes,
      })
      if (isActiveRunStatus(job?.status)) {
        runPollTimerRef.current = setTimeout(() => pollRunStatus(projectId, nextRunId), ACTIVE_RUN_POLL_MS)
      } else if (isActiveRunStatus(previousStatus)) {
        if (job?.status !== 'stopped') {
          notify?.(`Workflow finished: ${job?.status}.`, job?.status === 'success' ? 'success' : 'warning')
        }
        const refreshed = normalizeProject(await request(`/api/projects/${projectId}`))
        setProject((current) => (current?.id === projectId ? refreshed : current))
      }
    } catch (err) {
      setProjectRunState(projectId, { status: 'idle' })
      setError(err.message)
    }
  }, [notify, request])

  useEffect(() => {
    if (!project?.id) return
    pollRunStatus(project.id)
  }, [pollRunStatus, project?.id])

  useEffect(() => {
    if (!project?.id) return undefined

    if (isActiveRunStatus(activeRunState.status)) {
      return undefined
    }

    const pollDelay = getIdleRunPollDelay(activeSchedule)
    const intervalId = setInterval(() => {
      pollRunStatus(project.id)
    }, pollDelay)

    return () => clearInterval(intervalId)
  }, [activeRunState.status, activeSchedule, pollRunStatus, project?.id])

  return {
    activeRunState,
    activeSchedule,
    addScriptDefinition,
    addScriptToCanvas,
    autoSaveStatus,
    canStopFlow,
    cancelActiveRun,
    cancelScheduledRun,
    canvasNodeIds,
    dateInputValue,
    deleteCanvasNodes,
    deleteEdges,
    deleteScriptDefinition,
    draftSchedule,
    error,
    flowEdges,
    flowNodes,
    ingestionSettings,
    isLoading,
    isRunning,
    isStopping,
    onConnect,
    onEdgesChange,
    onNodeDragStop,
    onNodesChange,
    project,
    runResult,
    runnerStatus,
    saveSchedule,
    saveWorkspace,
    saveIngestionSettings,
    scheduleModalError,
    scriptLibrary,
    selectedNode,
    selectedNodeId,
    selectedNodeLabel,
    selectedNodeLogs,
    selectedNodeResults,
    setDraftSchedule,
    setScheduleModalError,
    setSelectedEdgeId,
    setSelectedNodeId,
    stopWorkflow,
    toggleDraftScheduleDay,
    updateDraftSchedule,
    updateScriptDefinitionWithDependencies,
    runWorkflow,
  }
}

export default useWorkflowProject
