import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MiniMap,
  Position,
} from 'react-flow-renderer'

import Inspector from './Inspector'
import ScriptSidebar from './ScriptSidebar'
import ToastStack from '../shared/ToastStack'
import {
  AddCircleOutlineIcon,
  CalendarMonthIcon,
  CheckCircleIcon,
  CloseIcon,
  PlayArrowIcon,
  StopIcon,
  WarningIcon,
} from '../../utils/icons'
import { displayText, formatRunStatus, formatScheduleSummary } from '../../utils/format'

const DashboardPanel = lazy(() => import('../dashboard/DashboardPanel'))
const IngestionSettingsPanel = lazy(() => import('../settings/IngestionSettingsPanel'))
const LazyRunLogsPanel = lazy(() => import('../run-logs/RunLogsPanel'))
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8001'
const WORKSPACE_VIEW_STORAGE_KEY = 'workflow-builder-active-view'
const RUN_SUMMARY_DISMISSED_STORAGE_KEY = 'workflow-builder-dismissed-run-summary'
const RUN_HISTORY_CACHE_PREFIX = 'workflow-builder-run-history'
const deleteKeyCodes = ['Backspace', 'Delete']
const fitViewOptions = { padding: 0.45, maxZoom: 0.72 }
const snapGrid = [20, 20]
const defaultEdgeOptions = { type: 'smoothstep', style: { strokeWidth: 2.5 } }
const miniMapStyle = { width: 152, height: 116 }

function PanelLoadingFallback({ label = 'Loading...' }) {
  return (
    <div className="workspace-panel-loading" role="status" aria-live="polite">
      <span className="workspace-panel-loading-spinner" aria-hidden="true" />
      <strong>{label}</strong>
    </div>
  )
}

function formatElapsedTime(startedAt, now = Date.now()) {
  const started = startedAt ? new Date(startedAt).getTime() : null
  if (!started || !Number.isFinite(started)) return '0s'
  const totalSeconds = Math.max(0, Math.floor((now - started) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) return `${seconds}s`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

function formatRunDuration(startedAt, finishedAt) {
  const started = startedAt ? new Date(startedAt).getTime() : null
  const finished = finishedAt ? new Date(finishedAt).getTime() : null
  if (!started || !finished || !Number.isFinite(started) || !Number.isFinite(finished)) return ''
  return formatElapsedTime(startedAt, finished)
}

function asNumber(value) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function compactNumber(value) {
  const numberValue = asNumber(value)
  return numberValue === null ? '0' : numberValue.toLocaleString()
}

function resultRaw(nodeResult) {
  return nodeResult?.result?.raw || nodeResult?.result || {}
}

function findResultByLabel(results, label) {
  const target = label.toLowerCase()
  return results.find((item) => displayText(item.label).toLowerCase() === target)
}

function findResultByAnyLabel(results, labels) {
  const targets = new Set(labels.map((label) => label.toLowerCase()))
  return results.find((item) => targets.has(displayText(item.label).toLowerCase()))
}

function buildPostRunSummary(runResult, duration) {
  const results = runResult?.results || []
  if (!results.length || ['queued', 'running', 'starting'].includes(runResult?.status)) return null

  const scan = resultRaw(findResultByLabel(results, 'Scan Candidate Files'))
  const extract = resultRaw(findResultByLabel(results, 'Extract File Signals'))
  const routing = resultRaw(findResultByLabel(results, 'Apply Routing Rules'))
  const delivery = resultRaw(findResultByAnyLabel(results, ['Deliver Files', 'Upload to GCS']))

  const scanned = asNumber(scan.total_candidates ?? scan.total_scanned ?? scan.total_files)
  const signals = asNumber(extract.total_signals)
  const routed = asNumber(routing.total_routed)
  const unmatched = asNumber(routing.total_unmatched) || 0
  const routingErrors = asNumber(routing.total_errors) || 0
  const delivered = asNumber(delivery.delivered_count ?? delivery.uploaded_count)
  const planned = asNumber(delivery.planned_count)
  const deliveryErrors = asNumber(delivery.error_count) || 0
  const deliveryInput = asNumber(delivery.input_count)
  const deliveredOrPlanned = delivered ?? planned

  const issues = []
  if (unmatched > 0) issues.push(`${compactNumber(unmatched)} unmatched`)
  if (routingErrors > 0) issues.push(`${compactNumber(routingErrors)} routing errors`)
  if (deliveryErrors > 0) issues.push(`${compactNumber(deliveryErrors)} delivery errors`)
  if (scanned !== null && routed !== null && scanned !== routed) {
    issues.push(`${compactNumber(Math.abs(scanned - routed))} not routed`)
  }
  if (deliveryInput !== null && deliveredOrPlanned !== null && deliveryInput !== deliveredOrPlanned) {
    issues.push(`${compactNumber(Math.abs(deliveryInput - deliveredOrPlanned))} not delivered`)
  }

  const chips = [
    scanned !== null && { label: 'Scanned', value: compactNumber(scanned) },
    signals !== null && { label: 'Extracted', value: compactNumber(signals) },
    routed !== null && { label: 'Routed', value: compactNumber(routed) },
    deliveredOrPlanned !== null && { label: delivered !== null ? 'Delivered' : 'Planned', value: compactNumber(deliveredOrPlanned) },
  ].filter(Boolean)

  if (!chips.length && !duration) return null

  const isReview = issues.length > 0 || ['error', 'stopped'].includes(runResult?.status)
  return {
    chips,
    duration,
    issues,
    status: isReview ? 'review' : 'success',
    title: isReview ? 'Needs Review' : 'Run Complete',
  }
}

function normalizeCanvasPosition(position, fallback = { x: 0, y: 0 }) {
  const x = Number(position?.x)
  const y = Number(position?.y)
  return {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
  }
}

function readStoredWorkspaceView() {
  try {
    return window.localStorage.getItem(WORKSPACE_VIEW_STORAGE_KEY) || 'workflow'
  } catch {
    return 'workflow'
  }
}

function readDismissedSummaryRunId() {
  try {
    return window.localStorage.getItem(RUN_SUMMARY_DISMISSED_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeDismissedSummaryRunId(runId) {
  try {
    if (runId) window.localStorage.setItem(RUN_SUMMARY_DISMISSED_STORAGE_KEY, String(runId))
  } catch {
    // Dismiss state is only a UI preference.
  }
}

function runHistoryCacheKey(projectId) {
  return `${RUN_HISTORY_CACHE_PREFIX}:${projectId}`
}

function readCachedRunHistory(projectId) {
  if (!projectId) return []
  try {
    const cached = window.sessionStorage.getItem(runHistoryCacheKey(projectId))
    const parsed = cached ? JSON.parse(cached) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeCachedRunHistory(projectId, runs) {
  if (!projectId) return
  try {
    window.sessionStorage.setItem(runHistoryCacheKey(projectId), JSON.stringify(runs))
  } catch {
    // Cache failures should not block fresh analytics data.
  }
}

const ScriptNode = memo(function ScriptNode({ data, selected }) {
  const label = displayText(data.label, 'Untitled script')
  const scriptPreview = displayText(data.script?.split?.('\n')?.[0], 'result = None')

  return (
    <div className={`flow-script-node ${selected ? 'selected' : ''} ${data.status || ''}`}>
      <Handle className="node-handle" type="target" position={Position.Left} />
      <div className="node-topline">
        <span>{label}</span>
        <small>{data.status || 'ready'}</small>
      </div>
      <code>{scriptPreview}</code>
      {data.progress && <p className="node-progress-line">{data.progress}</p>}
      <div className="node-meta">
        <span>{Object.keys(data.config || {}).length} config keys</span>
        {data.duration && <span className="node-duration">{data.duration}</span>}
      </div>
      <Handle className="node-handle" type="source" position={Position.Right} />
    </div>
  )
})

const nodeTypes = { script: ScriptNode }

function WorkflowWorkspace({
  activeRunState,
  activeSchedule,
  autoSaveStatus,
  canStopFlow,
  cancelActiveRun,
  canvasNodeIds,
  clearPaneSelection,
  filteredScriptLibrary,
  flowEdges,
  flowNodes,
  error,
  isInspectorOpen,
  isSettingsOpen,
  isRunning,
  isSidebarCollapsed,
  isStopping,
  onConnect,
  onEdgesChange,
  onNodeDragStop,
  onNodesChange,
  onCloseSettings,
  openAddScriptModal,
  openEditScriptDefinition,
  openScheduleModal,
  project,
  requestDeleteScript,
  runResult,
  runnerStatus,
  runWorkflow,
  scriptLibrary,
  scriptSearch,
  selectCanvasEdge,
  selectCanvasNode,
  selectedNode,
  selectedNodeId,
  selectedNodeLabel,
  selectedNodeLogs,
  selectedNodeResults,
  selectScript,
  setIsInspectorOpen,
  setIsSidebarCollapsed,
  onOpenSettings,
  setScriptSearch,
  ingestionSettings,
  onSaveIngestionSettings,
  stopWorkflow,
  toasts,
  onDismissToast,
  addScriptToCanvas,
}) {
  const flowShellRef = useRef(null)
  const autoFollowInterruptedRef = useRef(false)
  const lastAutoFocusedNodeRef = useRef(null)
  const lastRunIdRef = useRef(null)
  const wasRunningRef = useRef(false)
  const [reactFlowInstance, setReactFlowInstance] = useState(null)
  const [isRunLogsOpen, setIsRunLogsOpen] = useState(false)
  const [isDashboardOpen, setIsDashboardOpen] = useState(() => readStoredWorkspaceView() === 'dashboard')
  const [dashboardRuns, setDashboardRuns] = useState([])
  const [dashboardRunsProjectId, setDashboardRunsProjectId] = useState(null)
  const [dashboardAnalytics, setDashboardAnalytics] = useState(null)
  const [elapsedNow, setElapsedNow] = useState(() => Date.now())
  const [isRunHistoryLoading, setIsRunHistoryLoading] = useState(false)
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false)
  const [dismissedSummaryRunId, setDismissedSummaryRunId] = useState(() => readDismissedSummaryRunId())
  const [dashboardError, setDashboardError] = useState('')
  const dashboardRequestRef = useRef(0)
  const dashboardRunsProjectIdRef = useRef(null)
  const dashboardRunsRef = useRef([])
  const dashboardAnalyticsRef = useRef(null)
  const pendingFocusRef = useRef(null)

  const handleScriptDragStart = useCallback((event, script) => {
    event.dataTransfer.setData('application/workflow-script-id', script.id)
    event.dataTransfer.effectAllowed = 'copy'
  }, [])

  function handleCanvasDrop(event) {
    event.preventDefault()
    const scriptId = event.dataTransfer.getData('application/workflow-script-id')
    if (!scriptId || !reactFlowInstance) return
    const script = scriptLibrary.find((item) => item.id === scriptId)
    if (!script) return
    const projectedPosition = reactFlowInstance.screenToFlowPosition
      ? reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      : reactFlowInstance.project({
          x: event.clientX - (flowShellRef.current?.getBoundingClientRect().left || 0),
          y: event.clientY - (flowShellRef.current?.getBoundingClientRect().top || 0),
        })
    const position = normalizeCanvasPosition(projectedPosition, { x: 120, y: 160 })
    addScriptToCanvas(script, position)
  }

  function handleCanvasDragOver(event) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const focusCanvasNode = useCallback((scriptId, options = {}) => {
    const node = flowNodes.find((item) => item.id === scriptId)
    if (!node || !reactFlowInstance) return

    const position = normalizeCanvasPosition(node.position)
    const x = position.x + 120
    const y = position.y + 55
    const zoom = options.zoom || 0.82
    const duration = options.duration || 520
    if (typeof reactFlowInstance.setCenter === 'function') {
      reactFlowInstance.setCenter(x, y, { zoom, duration })
      return
    }
    if (typeof reactFlowInstance.fitView === 'function') {
      reactFlowInstance.fitView({ padding: 0.45, maxZoom: 0.72, duration })
    }
  }, [flowNodes, reactFlowInstance])

  const queueCanvasFocus = useCallback((scriptId, options = {}) => {
    pendingFocusRef.current = { scriptId, options }
    window.setTimeout(() => {
      const pendingFocus = pendingFocusRef.current
      if (!pendingFocus || pendingFocus.scriptId !== scriptId) return
      pendingFocusRef.current = null
      focusCanvasNode(scriptId, pendingFocus.options)
    }, options.delay ?? 160)
  }, [focusCanvasNode])

  const stopAutoFollow = useCallback(() => {
    autoFollowInterruptedRef.current = true
  }, [])

  const fitCanvasView = useCallback((duration = 520) => {
    if (typeof reactFlowInstance?.fitView !== 'function') return
    reactFlowInstance.fitView({ ...fitViewOptions, duration })
  }, [reactFlowInstance])

  const handleCloseInspector = useCallback(() => {
    setIsInspectorOpen(false)
    window.setTimeout(() => fitCanvasView(540), 180)
  }, [fitCanvasView, setIsInspectorOpen])

  const handleSelectScript = useCallback((script, isOnCanvas) => {
    stopAutoFollow()
    setIsDashboardOpen(false)
    setIsRunLogsOpen(false)
    selectScript(script, isOnCanvas)
    if (!isOnCanvas) return
    queueCanvasFocus(script.id, { delay: 180 })
  }, [queueCanvasFocus, selectScript, stopAutoFollow])

  function handleNodeClick(_, node) {
    stopAutoFollow()
    setIsDashboardOpen(false)
    setIsRunLogsOpen(false)
    selectCanvasNode(node.id)
    queueCanvasFocus(node.id, { zoom: 0.86, duration: 460, delay: 170 })
  }

  function handleRunWorkflow() {
    setIsDashboardOpen(false)
    setIsRunLogsOpen(false)
    setIsInspectorOpen(false)
    runWorkflow()
  }

  function handleAddScript() {
    setIsDashboardOpen(false)
    setIsRunLogsOpen(false)
    setIsInspectorOpen(false)
    onCloseSettings()
    openAddScriptModal()
  }

  const openSettings = useCallback(() => {
    setIsDashboardOpen(false)
    setIsRunLogsOpen(false)
    onOpenSettings()
  }, [onOpenSettings])

  const openWorkspace = useCallback(() => {
    setIsDashboardOpen(false)
    setIsRunLogsOpen(false)
    setIsInspectorOpen(false)
    onCloseSettings()
  }, [onCloseSettings, setIsInspectorOpen])

  const loadDashboardRuns = useCallback(
    async ({ force = false, includeRuns = true, includeAnalytics = true } = {}) => {
      if (!project?.id) return
      const hasRunCache = dashboardRunsProjectIdRef.current === project.id && dashboardRunsRef.current.length > 0
      const hasAnalyticsCache = dashboardRunsProjectIdRef.current === project.id && dashboardAnalyticsRef.current
      if (!force && (!includeRuns || hasRunCache) && (!includeAnalytics || hasAnalyticsCache)) return

      const requestId = dashboardRequestRef.current + 1
      dashboardRequestRef.current = requestId
      if (includeRuns) setIsRunHistoryLoading(!hasRunCache)
      if (includeAnalytics) setIsAnalyticsLoading(!hasAnalyticsCache)
      setDashboardError('')

      try {
        const [runsResponse, analyticsResponse] = await Promise.all([
          includeRuns ? fetch(`${API_URL}/api/projects/${project.id}/runs?limit=5000&include_result=false`) : Promise.resolve(null),
          includeAnalytics ? fetch(`${API_URL}/api/projects/${project.id}/analytics`) : Promise.resolve(null),
        ])
        if (runsResponse && !runsResponse.ok) throw new Error('Unable to load run history.')
        if (analyticsResponse && !analyticsResponse.ok) throw new Error('Unable to load dashboard analytics.')
        const [data, analytics] = await Promise.all([
          runsResponse ? runsResponse.json() : Promise.resolve(dashboardRunsRef.current),
          analyticsResponse ? analyticsResponse.json() : Promise.resolve(dashboardAnalyticsRef.current),
        ])
        if (dashboardRequestRef.current !== requestId) return
        const nextRuns = Array.isArray(data) ? data : []
        dashboardRunsRef.current = nextRuns
        dashboardAnalyticsRef.current = analytics || null
        setDashboardRuns(nextRuns)
        setDashboardAnalytics(analytics || null)
        dashboardRunsProjectIdRef.current = project.id
        setDashboardRunsProjectId(project.id)
        if (includeRuns) {
          writeCachedRunHistory(project.id, nextRuns)
        }
      } catch (err) {
        if (dashboardRequestRef.current !== requestId) return
        setDashboardError(err.message)
      } finally {
        if (dashboardRequestRef.current === requestId) {
          if (includeRuns) setIsRunHistoryLoading(false)
          if (includeAnalytics) setIsAnalyticsLoading(false)
        }
      }
    },
    [project?.id],
  )

  const updateVisibleRunFromActiveState = useCallback(() => {
    if (!project?.id || !activeRunState.runId) return
    const optimisticRun = {
      id: activeRunState.runId,
      project_id: project.id,
      status: activeRunState.status || 'idle',
      created_at: activeRunState.createdAt || activeRunState.startedAt || new Date().toISOString(),
      started_at: activeRunState.startedAt || null,
      finished_at: activeRunState.finishedAt || null,
      error: activeRunState.error || null,
    }
    const nextRuns = [optimisticRun, ...dashboardRunsRef.current.filter((run) => run.id !== activeRunState.runId)]
    dashboardRunsRef.current = nextRuns
    dashboardRunsProjectIdRef.current = project.id
    setDashboardRuns(nextRuns)
    setDashboardRunsProjectId(project.id)
    writeCachedRunHistory(project.id, nextRuns)
  }, [
    activeRunState.createdAt,
    activeRunState.error,
    activeRunState.finishedAt,
    activeRunState.runId,
    activeRunState.startedAt,
    activeRunState.status,
    project?.id,
  ])

  const openRunLogs = useCallback(() => {
    setIsDashboardOpen(false)
    setIsRunLogsOpen(true)
    setIsInspectorOpen(false)
    onCloseSettings()
    loadDashboardRuns({ force: true, includeAnalytics: false })
  }, [loadDashboardRuns, onCloseSettings, setIsInspectorOpen])

  const openDashboard = useCallback(() => {
    if (isDashboardOpen) return
    setIsDashboardOpen(true)
    setIsRunLogsOpen(false)
    setIsInspectorOpen(false)
    setIsSidebarCollapsed(false)
    loadDashboardRuns({ force: dashboardRunsProjectId !== project?.id, includeRuns: false })
  }, [dashboardRunsProjectId, isDashboardOpen, loadDashboardRuns, project?.id, setIsInspectorOpen, setIsSidebarCollapsed])

  function backToWorkflow() {
    setIsDashboardOpen(false)
    setIsRunLogsOpen(false)
    setIsInspectorOpen(false)
    onCloseSettings()
  }

  function activeRunningNodeId() {
    const nodeResults = activeRunState.nodes || []
    const terminalNodeIds = new Set(
      nodeResults
        .filter((node) => ['success', 'error', 'stopped'].includes(node.status))
        .map((node) => node.node_id),
    )
    const startLogs = (activeRunState.logs || []).filter(
      (log) => log.node_id && displayText(log.message).toLowerCase().startsWith('starting node'),
    )
    const latestUnfinishedStart = [...startLogs].reverse().find((log) => !terminalNodeIds.has(log.node_id))
    if (latestUnfinishedStart?.node_id) return latestUnfinishedStart.node_id

    const latestCompletedNodeId = nodeResults.at(-1)?.node_id
    const latestCompletedIndex = flowNodes.findIndex((node) => node.id === latestCompletedNodeId)
    if (latestCompletedIndex >= 0) {
      return flowNodes.slice(latestCompletedIndex + 1).find((node) => !terminalNodeIds.has(node.id))?.id || null
    }

    return flowNodes[0]?.id || null
  }

  const runnerServiceClass = runnerStatus.active ? 'service-online' : 'service-offline'
  const runnerServiceLabel = runnerStatus.active ? 'Service Online' : 'Service Offline'
  const isWaitingForRunner = isRunning && !runnerStatus.active
  const processedNodeResults = (activeRunState.nodes || []).filter((node) =>
    ['success', 'error', 'stopped'].includes(node.status),
  )
  const successfulNodeCount = processedNodeResults.filter((node) => node.status === 'success').length
  const failedNodeCount = processedNodeResults.filter((node) => node.status === 'error').length
  const stoppedNodeCount = processedNodeResults.filter((node) => node.status === 'stopped').length
  const totalNodeCount = flowNodes.length || project?.workflow.nodes.length || 0
  const progressPercent = totalNodeCount > 0 ? Math.min(100, (processedNodeResults.length / totalNodeCount) * 100) : 0
  const activeNodeId = isRunning ? activeRunningNodeId() : null
  const activeNode = activeNodeId ? flowNodes.find((node) => node.id === activeNodeId) : null
  const activeNodeStartLog = [...(activeRunState.logs || [])]
    .reverse()
    .find((log) => log.node_id === activeNodeId && displayText(log.message).toLowerCase().startsWith('starting node'))
  const latestProgressLog = [...(activeRunState.logs || [])]
    .reverse()
    .find((log) => {
      const message = displayText(log.message).toLowerCase()
      return message.includes('progress') || message.includes('uploaded') || message.startsWith('node ')
    })
  const latestProgressMessage = displayText(latestProgressLog?.message, '')
  const latestProgressByNode = useMemo(() => {
    const map = new Map()
    ;[...(activeRunState.logs || [])].reverse().forEach((log) => {
      if (!log.node_id || map.has(log.node_id)) return
      const message = displayText(log.message)
      const lowerMessage = message.toLowerCase()
      if (
        lowerMessage.includes('progress') ||
        lowerMessage.includes('uploading') ||
        lowerMessage.includes('extracted') ||
        lowerMessage.includes('routed')
      ) {
        map.set(log.node_id, message)
      }
    })
    return map
  }, [activeRunState.logs])
  const activeElapsedSource =
    activeNodeStartLog?.created_at || activeRunState.startedAt || activeRunState.createdAt || null
  const activeElapsed = isRunning ? formatElapsedTime(activeElapsedSource, elapsedNow) : ''
  const lastRunDuration = !isRunning
    ? formatRunDuration(activeRunState.startedAt || activeRunState.createdAt, activeRunState.finishedAt)
    : ''
  const workflowStatusLabel = isRunning
    ? `Workflow: ${formatRunStatus(activeRunState.status)}`
    : runResult
      ? `Last run: ${formatRunStatus(runResult.status)}`
      : 'Workflow: Idle'
  const postRunSummary = useMemo(
    () => (!isRunning ? buildPostRunSummary(runResult, lastRunDuration) : null),
    [isRunning, lastRunDuration, runResult],
  )
  const shouldShowPostRunSummary =
    Boolean(postRunSummary) && String(dismissedSummaryRunId || '') !== String(activeRunState.runId || runResult?.run_id || '')
  const visibleFlowNodes = useMemo(() => {
    if (!isRunning || !activeNodeId) return flowNodes
    return flowNodes.map((node) => {
      const progress = latestProgressByNode.get(node.id)
      if (node.id !== activeNodeId && !progress) return node
      return {
        ...node,
        data: {
          ...node.data,
          progress: progress || node.data?.progress || '',
          status:
            node.data?.status ||
            (node.id === activeNodeId ? (activeRunState.status === 'queued' ? 'queued' : 'running') : node.data?.status),
        },
      }
    })
  }, [activeNodeId, activeRunState.status, flowNodes, isRunning, latestProgressByNode])

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((current) => !current)
  }, [setIsSidebarCollapsed])

  useEffect(() => {
    if (!isRunning) return undefined
    const intervalId = window.setInterval(() => setElapsedNow(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [isRunning])

  useEffect(() => {
    if (isRunning) setDismissedSummaryRunId(null)
  }, [isRunning])

  const dismissPostRunSummary = useCallback(() => {
    const runId = activeRunState.runId || runResult?.run_id || null
    setDismissedSummaryRunId(runId)
    writeDismissedSummaryRunId(runId)
  }, [activeRunState.runId, runResult?.run_id])

  useEffect(() => {
    if (!shouldShowPostRunSummary || postRunSummary?.status !== 'review') return undefined
    const timeoutId = window.setTimeout(() => {
      dismissPostRunSummary()
    }, 5000)
    return () => window.clearTimeout(timeoutId)
  }, [dismissPostRunSummary, postRunSummary?.status, shouldShowPostRunSummary])

  useEffect(() => {
    const currentRunId = activeRunState.runId || `${activeRunState.status}-${isRunning}`
    if (lastRunIdRef.current !== currentRunId) {
      autoFollowInterruptedRef.current = false
      lastAutoFocusedNodeRef.current = null
      lastRunIdRef.current = currentRunId
    }
  }, [activeRunState.runId, activeRunState.status, isRunning])

  useEffect(() => {
    if (!isRunning || autoFollowInterruptedRef.current) return
    const nodeId = activeRunningNodeId()
    if (!nodeId || lastAutoFocusedNodeRef.current === nodeId) return
    lastAutoFocusedNodeRef.current = nodeId
    focusCanvasNode(nodeId, { zoom: 0.84, duration: 620 })
  }, [activeRunState.logs, activeRunState.nodes, flowNodes, isRunning, reactFlowInstance])

  useEffect(() => {
    if (wasRunningRef.current && !isRunning && !isSettingsOpen && reactFlowInstance?.fitView) {
      window.setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.45, maxZoom: 0.72, duration: 650 })
      }, 180)
    }
    if (wasRunningRef.current && !isRunning && project?.id) {
      updateVisibleRunFromActiveState()
      loadDashboardRuns({ force: true, includeRuns: isRunLogsOpen, includeAnalytics: true })
    }
    wasRunningRef.current = isRunning
  }, [
    isRunning,
    isRunLogsOpen,
    isSettingsOpen,
    loadDashboardRuns,
    project?.id,
    reactFlowInstance,
    updateVisibleRunFromActiveState,
  ])

  useEffect(() => {
    if (!project?.id) return
    const cachedRuns = readCachedRunHistory(project.id)
    dashboardRunsRef.current = cachedRuns
    dashboardAnalyticsRef.current = null
    setDashboardRuns(cachedRuns)
    setDashboardAnalytics(null)
    dashboardRunsProjectIdRef.current = cachedRuns.length ? project.id : null
    setDashboardRunsProjectId(cachedRuns.length ? project.id : null)
    setDashboardError('')
  }, [project?.id])

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_VIEW_STORAGE_KEY, isDashboardOpen ? 'dashboard' : 'workflow')
    } catch {
      // Ignore storage failures; the view can still work for the current session.
    }

    if (!isDashboardOpen) return
    setIsRunLogsOpen(false)
    setIsInspectorOpen(false)
    onCloseSettings()
    loadDashboardRuns({ force: dashboardRunsProjectId !== project?.id, includeRuns: false })
  }, [
    dashboardRunsProjectId,
    isDashboardOpen,
    loadDashboardRuns,
    project?.id,
  ])

  return (
    <>
      <ScriptSidebar
        isCollapsed={isSidebarCollapsed}
        scripts={filteredScriptLibrary}
        allScripts={scriptLibrary}
        canvasNodeIds={canvasNodeIds}
        selectedNodeId={selectedNodeId}
        scriptSearch={scriptSearch}
        onToggleCollapse={toggleSidebar}
        onSearchChange={setScriptSearch}
        onSelectScript={handleSelectScript}
        onDragStart={handleScriptDragStart}
        onEditScript={openEditScriptDefinition}
        onDeleteScript={requestDeleteScript}
        onOpenDashboard={openDashboard}
        onOpenRunLogs={openRunLogs}
        onOpenSettings={openSettings}
        onOpenWorkspace={openWorkspace}
        isDashboardOpen={isDashboardOpen}
        isRunLogsOpen={isRunLogsOpen}
        isSettingsOpen={isSettingsOpen}
      />

      <section
        className={`workspace ${isDashboardOpen ? 'dashboard-mode' : ''} ${
          isInspectorOpen && !isSettingsOpen && !isRunLogsOpen && !isDashboardOpen ? 'with-inspector' : ''
        }`}
      >
        <div className={`canvas-titlebar ${isDashboardOpen || isSettingsOpen || isRunLogsOpen ? 'detail-titlebar' : ''}`}>
          {isDashboardOpen || isSettingsOpen || isRunLogsOpen ? (
            <>
              <div className="canvas-title">
                <h2>
                  {isDashboardOpen
                    ? 'Ingestion Dashboard'
                    : isSettingsOpen
                      ? 'Ingestion Settings'
                      : 'Run Logs'}
                </h2>
              </div>
              <div className="canvas-title-actions">
                <button
                  className="dashboard-back-inline"
                  type="button"
                  onClick={backToWorkflow}
                  title="Back to workflow"
                  aria-label="Back to workflow"
                >
                  Back to Workflow
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="canvas-title">
                <h2>Workspace Scripts</h2>
              </div>
              <div className="canvas-title-actions">
                <button
                  className={`schedule-flow-button flow-action-button icon-label-button ${
                    activeSchedule?.enabled ? 'scheduled' : ''
                  }`}
                  type="button"
                  onClick={openScheduleModal}
                  title={activeSchedule?.enabled ? `Scheduled: ${formatScheduleSummary(activeSchedule)}` : 'Schedule run'}
                  aria-label={activeSchedule?.enabled ? 'Scheduled run is set' : 'Schedule run'}
                >
                  <CalendarMonthIcon fontSize="small" />
                  <span>{activeSchedule?.enabled ? 'Scheduled' : 'Schedule Run'}</span>
                </button>
                {isRunning ? (
                  <button
                    className="danger flow-action-button icon-label-button"
                    type="button"
                    onClick={stopWorkflow}
                    disabled={!canStopFlow || isStopping}
                    title={isStopping ? 'Stopping flow' : 'Stop flow'}
                    aria-label={isStopping ? 'Stopping flow' : 'Stop flow'}
                  >
                    <StopIcon fontSize="small" />
                    <span>{isStopping ? 'Stopping' : 'Stop Flow'}</span>
                  </button>
                ) : (
                  <button
                    className="run-flow-button flow-action-button icon-label-button"
                    type="button"
                    onClick={handleRunWorkflow}
                    title="Run flow"
                    aria-label="Run flow"
                  >
                    <PlayArrowIcon fontSize="small" />
                    <span>Run Workflow</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {error && !isDashboardOpen && <div className="error-banner">{error}</div>}

        {isDashboardOpen ? (
          <Suspense fallback={<PanelLoadingFallback label="Loading dashboard..." />}>
            <DashboardPanel
              analyticsData={dashboardAnalytics}
              error={dashboardError}
              isLoading={isAnalyticsLoading && !dashboardAnalytics}
              runs={dashboardRuns}
            />
          </Suspense>
        ) : isSettingsOpen ? (
          <Suspense fallback={<PanelLoadingFallback label="Loading settings..." />}>
            <IngestionSettingsPanel
              settings={ingestionSettings}
              onClose={onCloseSettings}
              onSave={onSaveIngestionSettings}
            />
          </Suspense>
        ) : isRunLogsOpen ? (
          <Suspense fallback={<PanelLoadingFallback label="Loading run logs..." />}>
            <LazyRunLogsPanel
              activeRunState={activeRunState}
              error={dashboardError}
              isLoading={isRunHistoryLoading && dashboardRuns.length === 0}
              onClose={() => setIsRunLogsOpen(false)}
              project={project}
              runs={dashboardRuns}
            />
          </Suspense>
        ) : (
          <>
            {error && <div className="error-banner">{error}</div>}
            <div
              className="flow-shell"
              ref={flowShellRef}
              onDrop={handleCanvasDrop}
              onDragOver={handleCanvasDragOver}
              onMouseDown={stopAutoFollow}
              onWheel={stopAutoFollow}
            >
              <ToastStack toasts={toasts} onDismiss={onDismissToast} />
              <button
                className="flow-shell-add-button flow-action-button icon-label-button"
                type="button"
                onClick={handleAddScript}
                title="Add script"
                aria-label="Add script"
              >
                <AddCircleOutlineIcon fontSize="small" />
                <span>Add Script</span>
              </button>
              <div className="canvas-toolbar">
                <div className="canvas-toolbar-row">
                  <span className={`service-status-pill ${runnerServiceClass}`}>
                    {runnerServiceLabel}
                  </span>
                  <span className={`workflow-status-pill ${isRunning ? 'running' : runResult?.status || ''}`}>
                    <span>{workflowStatusLabel}</span>
                    {lastRunDuration && <strong>{lastRunDuration}</strong>}
                  </span>
                  {isRunning && (
                    <span className="active-node-status-pill">
                      {activeNode?.data?.label ? `${displayText(activeNode.data.label)} • ${activeElapsed}` : `Waiting • ${activeElapsed}`}
                    </span>
                  )}
                  <span className={`autosave-status ${autoSaveStatus?.state || 'saved'}`}>
                    {autoSaveStatus?.state === 'saving'
                      ? 'Saving...'
                      : autoSaveStatus?.state === 'pending'
                        ? 'Unsaved changes'
                        : autoSaveStatus?.state === 'error'
                          ? 'Autosave failed'
                          : 'Saved'}
                  </span>
                </div>
                {isRunning && (
                  <div className="run-progress-strip" role="status" aria-live="polite">
                    <div className="run-progress-main">
                      <span>Processed {processedNodeResults.length}/{totalNodeCount}</span>
                      <strong>
                        {successfulNodeCount} successful
                        {failedNodeCount ? `, ${failedNodeCount} failed` : ''}
                        {stoppedNodeCount ? `, ${stoppedNodeCount} stopped` : ''}
                      </strong>
                    </div>
                    <div className="run-progress-track" aria-hidden="true">
                      <span style={{ width: `${progressPercent}%` }} />
                    </div>
                    {latestProgressMessage && <p>{latestProgressMessage}</p>}
                  </div>
                )}
                {!isRunning && shouldShowPostRunSummary && (
                  <div
                    className={`post-run-summary-card ${postRunSummary.status}`}
                    role="status"
                    aria-live="polite"
                  >
                    <div className="post-run-summary-icon" aria-hidden="true">
                      {postRunSummary.status === 'review' ? <WarningIcon fontSize="small" /> : <CheckCircleIcon fontSize="small" />}
                    </div>
                    <div className="post-run-summary-content">
                      <div className="post-run-summary-heading">
                        <span>{postRunSummary.title}</span>
                        {postRunSummary.duration && <strong>{postRunSummary.duration}</strong>}
                      </div>
                      <div className="post-run-summary-metrics">
                        {postRunSummary.chips.map((chip) => (
                          <span key={chip.label}>
                            {chip.label} <strong>{chip.value}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      className="post-run-summary-close"
                      type="button"
                      onClick={dismissPostRunSummary}
                      aria-label="Close run summary"
                      title="Close"
                    >
                      <CloseIcon fontSize="small" />
                    </button>
                  </div>
                )}
              </div>
              <div className="canvas-footer-toolbar">
                <span>{project.workflow.nodes.length} nodes</span>
                <span>{project.workflow.edges.length} connections</span>
                <span>{formatScheduleSummary(activeSchedule)}</span>
              </div>
              {flowNodes.length === 0 && (
                <div className="flow-empty-state">
                  Drag a script from the sidebar into the canvas.
                </div>
              )}
              {isWaitingForRunner && (
                <div className="flow-waiting-state">
                  <div>
                    <strong>Workflow is waiting for the runner</strong>
                    <p>Start the runner service to continue, or clear this queued run if it was started by mistake.</p>
                  </div>
                  <button type="button" onClick={cancelActiveRun}>
                    Clear Run
                  </button>
                </div>
              )}
              <ReactFlow
                nodes={visibleFlowNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                onNodeClick={handleNodeClick}
                onEdgeClick={(_, edge) => {
                  stopAutoFollow()
                  selectCanvasEdge(edge.id)
                }}
                onPaneClick={() => {
                  stopAutoFollow()
                  clearPaneSelection()
                }}
                onEdgesDelete={() => {}}
                onNodesDelete={() => {}}
                onInit={setReactFlowInstance}
                connectionMode={ConnectionMode.Loose}
                panOnDrag
                panOnScroll={false}
                zoomOnScroll
                zoomOnPinch
                zoomOnDoubleClick
                nodesConnectable
                nodesDraggable
                elementsSelectable
                deleteKeyCode={deleteKeyCodes}
                edgeUpdaterRadius={18}
                elevateEdgesOnSelect
                minZoom={0.2}
                maxZoom={1.6}
                fitView
                fitViewOptions={fitViewOptions}
                snapToGrid
                snapGrid={snapGrid}
                defaultEdgeOptions={defaultEdgeOptions}
              >
                <Background color="#3732538a" gap={18} size={1.3} />
                <MiniMap
                  nodeColor={(node) => (node.id === selectedNodeId ? '#2563eb' : '#7c8da5')}
                  nodeStrokeColor={(node) => (node.id === selectedNodeId ? '#1d4ed8' : '#475569')}
                  nodeBorderRadius={6}
                  nodeStrokeWidth={3}
                  bgColor="#ffffff"
                  maskColor="rgba(246, 247, 249, 0.72)"
                  style={miniMapStyle}
                />
                <Controls />
              </ReactFlow>
            </div>
          </>
        )}
      </section>

      <Inspector
        isOpen={isInspectorOpen && !isDashboardOpen}
        selectedNode={selectedNode}
        selectedNodeLabel={selectedNodeLabel}
        runResult={runResult}
        selectedNodeResults={selectedNodeResults}
        selectedNodeLogs={selectedNodeLogs}
        onClose={handleCloseInspector}
      />
    </>
  )
}

export default memo(WorkflowWorkspace)
