import { useEffect } from 'react'
import { ReactFlowProvider } from 'react-flow-renderer'
import 'react-flow-renderer/dist/style.css'
import './App.css'
import ErrorBoundary from './components/shared/ErrorBoundary'
import WorkflowModals from './components/modals/WorkflowModals'
import WorkflowWorkspace from './components/workflow/WorkflowWorkspace'
import useWorkflowProject from './hooks/useWorkflowProject'
import useToast from './hooks/useToast'
import useWorkflowUi from './hooks/useWorkflowUi'

function App() {
  const { dismissToast, notify, toasts } = useToast()
  const {
    activeRunState,
    activeSchedule,
    addScriptDefinition,
    addScriptToCanvas,
    autoSaveStatus,
    canStopFlow,
    cancelActiveRun,
    cancelScheduledRun: cancelScheduledRunProject,
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
    saveSchedule: saveProjectSchedule,
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
  } = useWorkflowProject({ notify })

  const {
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
    setEditScriptConfig,
    setEditScriptLabel,
    setEditScriptScript,
    setIsInspectorOpen,
    setIsSettingsOpen,
    setIsSidebarCollapsed,
    setNewScriptConfig,
    setNewScriptLabel,
    setNewScriptScript,
    setScriptSearch,
    toggleEditScriptDependency,
  } = useWorkflowUi({
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
  })

  useEffect(() => {
    function handleKeyDown(event) {
      const key = event.key.toLowerCase()

      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        saveWorkspace()
        return
      }

      if (event.key !== 'Escape') return

      if (deleteAction) {
        closeDeleteConfirm()
        return
      }
      if (isScheduleConfirmOpen) {
        closeScheduleConfirm()
        return
      }
      if (isScheduleModalOpen) {
        closeScheduleModal()
        return
      }
      if (isAddScriptModalOpen) {
        closeAddScriptModal()
        return
      }
      if (isEditScriptModalOpen) {
        closeEditScriptModal()
        return
      }
      if (isInspectorOpen) {
        setIsInspectorOpen(false)
        return
      }
      if (isSettingsOpen) {
        setIsSettingsOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    closeAddScriptModal,
    closeDeleteConfirm,
    closeEditScriptModal,
    closeScheduleConfirm,
    closeScheduleModal,
    deleteAction,
    isAddScriptModalOpen,
    isEditScriptModalOpen,
    isInspectorOpen,
    isScheduleConfirmOpen,
    isScheduleModalOpen,
    isSettingsOpen,
    saveWorkspace,
    setIsInspectorOpen,
    setIsSettingsOpen,
  ])

  return (
    <ReactFlowProvider>
      <main className="app-shell">
        <div className={`app-body ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          {isLoading && <div className="workspace-loading">Loading ingestion workspace...</div>}
          {!isLoading && !project && (
            <div className="workspace-loading">
              {error || 'Ingestion workspace is not available.'}
            </div>
          )}
          {project && (
            <ErrorBoundary title="Workspace could not render">
              <WorkflowWorkspace
                activeRunState={activeRunState}
                activeSchedule={activeSchedule}
                addScriptToCanvas={addScriptToCanvas}
                autoSaveStatus={autoSaveStatus}
                canStopFlow={canStopFlow}
                cancelActiveRun={cancelActiveRun}
                canvasNodeIds={canvasNodeIds}
                clearPaneSelection={clearPaneSelection}
                error={error}
                filteredScriptLibrary={filteredScriptLibrary}
                flowEdges={flowEdges}
                flowNodes={flowNodes}
                isInspectorOpen={isInspectorOpen}
                isSettingsOpen={isSettingsOpen}
                isRunning={isRunning}
                isSidebarCollapsed={isSidebarCollapsed}
                isStopping={isStopping}
                onConnect={onConnect}
                onCloseSettings={() => setIsSettingsOpen(false)}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={onNodeDragStop}
                onNodesChange={onNodesChange}
                openAddScriptModal={openAddScriptModal}
                openEditScriptDefinition={openEditScriptDefinition}
                openScheduleModal={openScheduleModal}
                onOpenSettings={openSettingsPanel}
                onSaveIngestionSettings={(settings) => {
                  saveIngestionSettings(settings)
                  setIsSettingsOpen(false)
                  notify?.('Ingestion settings saved.', 'success')
                }}
                project={project}
                ingestionSettings={ingestionSettings}
                requestDeleteScript={requestDeleteScript}
                runResult={runResult}
                runnerStatus={runnerStatus}
                runWorkflow={runWorkflow}
                scriptLibrary={scriptLibrary}
                scriptSearch={scriptSearch}
                selectCanvasEdge={selectCanvasEdge}
                selectCanvasNode={selectCanvasNode}
                selectedNode={selectedNode}
                selectedNodeId={selectedNodeId}
                selectedNodeLabel={selectedNodeLabel}
                selectedNodeLogs={selectedNodeLogs}
                selectedNodeResults={selectedNodeResults}
                selectScript={selectScript}
                setIsInspectorOpen={setIsInspectorOpen}
                setIsSidebarCollapsed={setIsSidebarCollapsed}
                setScriptSearch={setScriptSearch}
                stopWorkflow={stopWorkflow}
                toasts={toasts}
                onDismissToast={dismissToast}
              />
            </ErrorBoundary>
          )}
        </div>

        <ErrorBoundary title="Dialog could not render">
          <WorkflowModals
            activeSchedule={activeSchedule}
            addScriptNode={addScriptNode}
            cancelScheduledRun={cancelScheduledRun}
            closeAddScriptModal={closeAddScriptModal}
            closeDeleteConfirm={closeDeleteConfirm}
            closeEditScriptModal={closeEditScriptModal}
            closeScheduleConfirm={closeScheduleConfirm}
            closeScheduleModal={closeScheduleModal}
            confirmDeleteAction={confirmDeleteAction}
            dateInputValue={dateInputValue}
            deleteAction={deleteAction}
            draftSchedule={draftSchedule}
            editScriptConfig={editScriptConfig}
            editScriptConfigErrors={editScriptConfigErrors}
            editScriptDependencyIds={editScriptDependencyIds}
            editScriptLabel={editScriptLabel}
            editScriptScript={editScriptScript}
            editingScriptId={editingScriptId}
            isAddScriptModalOpen={isAddScriptModalOpen}
            isCreatingScript={isCreatingScript}
            isEditScriptModalOpen={isEditScriptModalOpen}
            isSavingScript={isSavingScript}
            isScheduleConfirmOpen={isScheduleConfirmOpen}
            isScheduleModalOpen={isScheduleModalOpen}
            newScriptConfig={newScriptConfig}
            newScriptConfigErrors={newScriptConfigErrors}
            newScriptLabel={newScriptLabel}
            newScriptScript={newScriptScript}
            openScheduleEditor={openScheduleEditor}
            saveSchedule={saveSchedule}
            saveScriptEdits={saveScriptEdits}
            scheduleModalError={scheduleModalError}
            setEditScriptConfig={setEditScriptConfig}
            setEditScriptLabel={setEditScriptLabel}
            setEditScriptScript={setEditScriptScript}
            setNewScriptConfig={setNewScriptConfig}
            setNewScriptLabel={setNewScriptLabel}
            setNewScriptScript={setNewScriptScript}
            scriptLibrary={scriptLibrary}
            toggleEditScriptDependency={toggleEditScriptDependency}
            toggleDraftScheduleDay={toggleDraftScheduleDay}
            updateDraftSchedule={updateDraftSchedule}
          />
        </ErrorBoundary>
      </main>
    </ReactFlowProvider>
  )
}

export default App
