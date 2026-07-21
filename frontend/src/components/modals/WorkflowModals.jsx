import DeleteConfirmModal from './DeleteConfirmModal'
import ScheduleModal, { ScheduleConfirmModal } from './ScheduleModal'
import ScriptModal from './ScriptModal'

function WorkflowModals({
  activeSchedule,
  addScriptNode,
  cancelScheduledRun,
  closeAddScriptModal,
  closeDeleteConfirm,
  closeEditScriptModal,
  closeScheduleConfirm,
  closeScheduleModal,
  confirmDeleteAction,
  dateInputValue,
  deleteAction,
  draftSchedule,
  editScriptConfig,
  editScriptConfigErrors,
  editScriptDependencyIds,
  editScriptLabel,
  editScriptScript,
  editingScriptId,
  isAddScriptModalOpen,
  isCreatingScript,
  isEditScriptModalOpen,
  isSavingScript,
  isScheduleConfirmOpen,
  isScheduleModalOpen,
  newScriptConfig,
  newScriptConfigErrors,
  newScriptLabel,
  newScriptScript,
  openScheduleEditor,
  saveSchedule,
  saveScriptEdits,
  scheduleModalError,
  setEditScriptConfig,
  setEditScriptLabel,
  setEditScriptScript,
  setNewScriptConfig,
  setNewScriptLabel,
  setNewScriptScript,
  scriptLibrary,
  toggleEditScriptDependency,
  toggleDraftScheduleDay,
  updateDraftSchedule,
}) {
  return (
    <>
      {isAddScriptModalOpen && (
        <ScriptModal
          mode="add"
          scriptId={null}
          label={newScriptLabel}
          script={newScriptScript}
          config={newScriptConfig}
          configErrors={newScriptConfigErrors}
          isSaving={isCreatingScript}
          submitDisabled={isCreatingScript || !newScriptLabel.trim() || !newScriptScript.trim()}
          onLabelChange={setNewScriptLabel}
          onScriptChange={setNewScriptScript}
          onConfigChange={setNewScriptConfig}
          onClose={closeAddScriptModal}
          onSubmit={addScriptNode}
          dependencyOptions={scriptLibrary}
          dependencyIds={[]}
        />
      )}

      {isEditScriptModalOpen && (
        <ScriptModal
          mode="edit"
          scriptId={editingScriptId}
          label={editScriptLabel}
          script={editScriptScript}
          config={editScriptConfig}
          configErrors={editScriptConfigErrors}
          isSaving={isSavingScript}
          submitDisabled={isSavingScript || !editScriptLabel.trim() || !editScriptScript.trim()}
          onLabelChange={setEditScriptLabel}
          onScriptChange={setEditScriptScript}
          onConfigChange={setEditScriptConfig}
          onClose={closeEditScriptModal}
          onSubmit={saveScriptEdits}
          dependencyOptions={scriptLibrary}
          dependencyIds={editScriptDependencyIds}
          onToggleDependency={toggleEditScriptDependency}
        />
      )}

      {isScheduleModalOpen && (
        <ScheduleModal
          activeSchedule={activeSchedule}
          draftSchedule={draftSchedule}
          error={scheduleModalError}
          dateInputValue={dateInputValue}
          onUpdateDraft={updateDraftSchedule}
          onToggleDay={toggleDraftScheduleDay}
          onCancelSchedule={cancelScheduledRun}
          onClose={closeScheduleModal}
          onSubmit={saveSchedule}
        />
      )}

      {isScheduleConfirmOpen && (
        <ScheduleConfirmModal
          activeSchedule={activeSchedule}
          onClose={closeScheduleConfirm}
          onSetNew={openScheduleEditor}
        />
      )}

      {deleteAction && (
        <DeleteConfirmModal
          deleteAction={deleteAction}
          onClose={closeDeleteConfirm}
          onConfirm={confirmDeleteAction}
        />
      )}
    </>
  )
}

export default WorkflowModals
