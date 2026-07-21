import { useCallback, useEffect, useMemo, useState } from 'react'

import { displayText } from '../utils/format'
import { validateScriptSettings } from '../config/scriptSettingsSchemas'
import { defaultSchedule } from './useWorkflowProject'

export const defaultScript = "print('Running step')\nresult = {'ok': True}"
const UI_STORAGE_KEY = 'workflow-builder-ui-state'

function readStoredUiState() {
  try {
    return JSON.parse(window.localStorage.getItem(UI_STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function useWorkflowUi({
  activeSchedule,
  addScriptDefinition,
  cancelScheduledRunProject,
  deleteCanvasNodes,
  deleteEdges,
  deleteScriptDefinition,
  project,
  saveProjectSchedule,
  scriptLibrary,
  setDraftSchedule,
  setScheduleModalError,
  setSelectedEdgeId,
  setSelectedNodeId,
  notify,
  updateScriptDefinitionWithDependencies,
}) {
  const storedState = useMemo(readStoredUiState, [])
  const [isAddScriptModalOpen, setIsAddScriptModalOpen] = useState(false)
  const [newScriptLabel, setNewScriptLabel] = useState('')
  const [newScriptScript, setNewScriptScript] = useState(defaultScript)
  const [newScriptConfig, setNewScriptConfig] = useState({})
  const [newScriptConfigErrors, setNewScriptConfigErrors] = useState({})
  const [isCreatingScript, setIsCreatingScript] = useState(false)
  const [isEditScriptModalOpen, setIsEditScriptModalOpen] = useState(false)
  const [editScriptLabel, setEditScriptLabel] = useState('')
  const [editScriptScript, setEditScriptScript] = useState(defaultScript)
  const [editScriptConfig, setEditScriptConfig] = useState({})
  const [editScriptDependencyIds, setEditScriptDependencyIds] = useState([])
  const [editScriptConfigErrors, setEditScriptConfigErrors] = useState({})
  const [editingScriptId, setEditingScriptId] = useState(null)
  const [isSavingScript, setIsSavingScript] = useState(false)
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false)
  const [isScheduleConfirmOpen, setIsScheduleConfirmOpen] = useState(false)
  const [isInspectorOpen, setIsInspectorOpen] = useState(Boolean(storedState.isInspectorOpen))
  const [isSettingsOpen, setIsSettingsOpen] = useState(Boolean(storedState.isSettingsOpen))
  const [deleteAction, setDeleteAction] = useState(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [scriptSearch, setScriptSearch] = useState(storedState.scriptSearch || '')

  const filteredScriptLibrary = useMemo(() => {
    const query = scriptSearch.trim().toLowerCase()
    if (!query) return scriptLibrary
    return scriptLibrary.filter((script) => displayText(script.label).toLowerCase().includes(query))
  }, [scriptLibrary, scriptSearch])

  useEffect(() => {
    window.localStorage.setItem(
      UI_STORAGE_KEY,
      JSON.stringify({
        isInspectorOpen,
        isSettingsOpen,
        isSidebarCollapsed,
        scriptSearch,
      }),
    )
  }, [isInspectorOpen, isSettingsOpen, isSidebarCollapsed, scriptSearch])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1024px)')

    function collapseSidebarOnLaptop(event) {
      if (event.matches) {
        setIsSidebarCollapsed(true)
      }
    }

    collapseSidebarOnLaptop(mediaQuery)
    mediaQuery.addEventListener('change', collapseSidebarOnLaptop)
    return () => mediaQuery.removeEventListener('change', collapseSidebarOnLaptop)
  }, [])

  const openScheduleEditor = useCallback(() => {
    setDraftSchedule(defaultSchedule())
    setScheduleModalError('')
    setIsScheduleConfirmOpen(false)
    setIsScheduleModalOpen(true)
  }, [setDraftSchedule, setScheduleModalError])

  const openScheduleModal = useCallback(() => {
    if (activeSchedule.enabled) {
      setIsScheduleConfirmOpen(true)
      return
    }
    openScheduleEditor()
  }, [activeSchedule.enabled, openScheduleEditor])

  const closeScheduleConfirm = useCallback(() => setIsScheduleConfirmOpen(false), [])

  const closeScheduleModal = useCallback(() => {
    setIsScheduleModalOpen(false)
    setScheduleModalError('')
  }, [setScheduleModalError])

  const saveSchedule = useCallback(async (event) => {
    const saved = await saveProjectSchedule(event)
    if (saved) {
      setIsScheduleModalOpen(false)
      notify?.('Schedule updated.', 'success')
    }
  }, [notify, saveProjectSchedule])

  const cancelScheduledRun = useCallback(async () => {
    const saved = await cancelScheduledRunProject()
    if (saved) {
      setIsScheduleModalOpen(false)
      notify?.('Schedule cleared.', 'error')
    }
  }, [cancelScheduledRunProject, notify])

  const openAddScriptModal = useCallback(() => {
    setNewScriptLabel('')
    setNewScriptScript(defaultScript)
    setNewScriptConfig({})
    setNewScriptConfigErrors({})
    setIsAddScriptModalOpen(true)
  }, [])

  const closeAddScriptModal = useCallback(() => {
    setIsAddScriptModalOpen(false)
  }, [])

  const closeEditScriptModal = useCallback(() => {
    setIsEditScriptModalOpen(false)
    setEditingScriptId(null)
  }, [])

  const openEditScriptDefinition = useCallback((script) => {
    setEditingScriptId(script.id)
    setSelectedNodeId(script.id)
    setSelectedEdgeId(null)
    setEditScriptLabel(displayText(script.label))
    setEditScriptScript(script.script || defaultScript)
    setEditScriptConfig(script.config || {})
    setEditScriptDependencyIds(
      (project?.workflow.edges || [])
        .filter((edge) => edge.target === script.id)
        .map((edge) => edge.source),
    )
    setEditScriptConfigErrors({})
    setIsEditScriptModalOpen(true)
  }, [project?.workflow.edges, setSelectedEdgeId, setSelectedNodeId])

  const toggleEditScriptDependency = useCallback((scriptId) => {
    setEditScriptDependencyIds((current) =>
      current.includes(scriptId)
        ? current.filter((id) => id !== scriptId)
        : [...current, scriptId],
    )
  }, [])

  const addScriptNode = useCallback(async (event) => {
    event.preventDefault()
    if (!project) return

    const label = newScriptLabel.trim()
    const script = newScriptScript.trim()
    if (!label) {
      return
    }
    if (!script) {
      return
    }
    const configErrors = validateScriptSettings({ label, config: newScriptConfig })
    if (Object.keys(configErrors).length > 0) {
      setNewScriptConfigErrors(configErrors)
      return
    }

    setIsCreatingScript(true)
    try {
      addScriptDefinition({ label, script, config: newScriptConfig })
      closeAddScriptModal()
      notify?.('Script added.', 'success')
    } finally {
      setIsCreatingScript(false)
    }
  }, [addScriptDefinition, closeAddScriptModal, newScriptConfig, newScriptLabel, newScriptScript, notify, project])

  const saveScriptEdits = useCallback(async (event) => {
    event.preventDefault()
    if (!project || !editingScriptId) return

    const label = editScriptLabel.trim()
    const script = editScriptScript.trim()
    if (!label) {
      return
    }
    if (!script) {
      return
    }
    const configErrors = validateScriptSettings({ id: editingScriptId, label, config: editScriptConfig })
    if (Object.keys(configErrors).length > 0) {
      setEditScriptConfigErrors(configErrors)
      return
    }

    setIsSavingScript(true)
    try {
      updateScriptDefinitionWithDependencies(editingScriptId, { label, script, config: editScriptConfig }, editScriptDependencyIds)
      closeEditScriptModal()
      notify?.('Script updated.', 'success')
    } finally {
      setIsSavingScript(false)
    }
  }, [
    closeEditScriptModal,
    editScriptConfig,
    editScriptDependencyIds,
    editScriptLabel,
    editScriptScript,
    editingScriptId,
    notify,
    project,
    updateScriptDefinitionWithDependencies,
  ])

  const selectScript = useCallback((script, isOnCanvas) => {
    setSelectedNodeId(script.id)
    setSelectedEdgeId(null)
    setIsSettingsOpen(false)
    setIsInspectorOpen(isOnCanvas)
  }, [setSelectedEdgeId, setSelectedNodeId])

  const selectCanvasNode = useCallback((nodeId) => {
    setSelectedNodeId(nodeId)
    setSelectedEdgeId(null)
    setIsSettingsOpen(false)
    setIsInspectorOpen(true)
  }, [setSelectedEdgeId, setSelectedNodeId])

  const selectCanvasEdge = useCallback((edgeId) => {
    setSelectedEdgeId(edgeId)
    setSelectedNodeId(null)
  }, [setSelectedEdgeId, setSelectedNodeId])

  const clearPaneSelection = useCallback(() => {
    setSelectedEdgeId(null)
  }, [setSelectedEdgeId])

  const openSettingsPanel = useCallback(() => {
    setIsInspectorOpen(false)
    setIsSettingsOpen(true)
  }, [])

  const requestDeleteScript = useCallback((script) => {
    setSelectedNodeId(script.id)
    setSelectedEdgeId(null)
    setDeleteAction({
      type: 'script',
      ids: [script.id],
      labels: [displayText(script.label, script.id)],
    })
  }, [setSelectedEdgeId, setSelectedNodeId])

  const closeDeleteConfirm = useCallback(() => {
    setDeleteAction(null)
  }, [])

  const confirmDeleteAction = useCallback(() => {
    if (!project || !deleteAction) return
    if (deleteAction.type === 'script') {
      deleteScriptDefinition(deleteAction.ids)
      notify?.('Script deleted.', 'error')
    } else if (deleteAction.type === 'node') {
      deleteCanvasNodes(deleteAction.ids)
      notify?.('Node removed from canvas.', 'error')
    } else if (deleteAction.type === 'edge') {
      deleteEdges(deleteAction.ids)
      notify?.('Connection deleted.', 'error')
    }
    setDeleteAction(null)
  }, [deleteAction, deleteCanvasNodes, deleteEdges, deleteScriptDefinition, notify, project])

  const updateEditScriptConfig = useCallback((nextConfig) => {
    setEditScriptConfig(nextConfig)
    setEditScriptConfigErrors({})
  }, [])

  const updateNewScriptConfig = useCallback((nextConfig) => {
    setNewScriptConfig(nextConfig)
    setNewScriptConfigErrors({})
  }, [])

  return {
    addScriptNode,
    cancelScheduledRun,
    clearPaneSelection,
    closeAddScriptModal,
    closeDeleteConfirm,
    closeEditScriptModal,
    closeScheduleConfirm,
    closeScheduleModal,
    confirmDeleteAction,
    deleteAction,
    editScriptConfig,
    editScriptConfigErrors,
    editScriptDependencyIds,
    editScriptLabel,
    editScriptScript,
    editingScriptId,
    filteredScriptLibrary,
    isAddScriptModalOpen,
    isCreatingScript,
    isEditScriptModalOpen,
    isInspectorOpen,
    isSettingsOpen,
    isSavingScript,
    isScheduleConfirmOpen,
    isScheduleModalOpen,
    isSidebarCollapsed,
    newScriptConfig,
    newScriptConfigErrors,
    newScriptLabel,
    newScriptScript,
    openAddScriptModal,
    openEditScriptDefinition,
    openScheduleEditor,
    openScheduleModal,
    openSettingsPanel,
    requestDeleteScript,
    saveSchedule,
    saveScriptEdits,
    scriptSearch,
    selectCanvasEdge,
    selectCanvasNode,
    selectScript,
    setEditScriptConfig: updateEditScriptConfig,
    setEditScriptLabel,
    setEditScriptScript,
    setIsInspectorOpen,
    setIsSettingsOpen,
    setIsSidebarCollapsed,
    setNewScriptConfig: updateNewScriptConfig,
    setNewScriptLabel,
    setNewScriptScript,
    setScriptSearch,
    toggleEditScriptDependency,
  }
}

export default useWorkflowUi
