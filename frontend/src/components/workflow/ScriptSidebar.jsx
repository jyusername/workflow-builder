import { memo, useMemo, useState } from 'react'
import {
  AccountTreeIcon,
  DashboardIcon,
  DeleteIcon,
  EditOutlinedIcon,
  KeyboardArrowDownIcon,
  KeyboardArrowRightIcon,
  MenuOpenIcon,
  SearchIcon,
  SchemaIcon,
  SettingsOutlinedIcon,
  TuneIcon,
  ReceiptLongIcon,
} from '../../utils/icons'
import { displayText } from '../../utils/format'

const SidebarBrandMark = memo(function SidebarBrandMark() {
  return (
    <div className="brand-mark" aria-label="Ingestion Runner">
      <SchemaIcon className="brand-symbol" fontSize="small" aria-hidden="true" />
      <span className="brand-text"></span>
    </div>
  )
})

const ScriptListRow = memo(function ScriptListRow({
  configCount,
  displayIndex,
  isActive,
  isCollapsed,
  isDashboardOpen,
  isOnCanvas,
  isSettingsOpen,
  label,
  onDeleteScript,
  onDragStart,
  onEditScript,
  onSelectScript,
  script,
}) {
  return (
    <div
      className={`script-list-row ${isActive ? 'active' : ''} ${isOnCanvas ? 'on-canvas' : ''}`}
      draggable
      onDragStart={(event) => onDragStart(event, script)}
    >
      <button
        className="script-list-button"
        type="button"
        onClick={() => onSelectScript(script, isOnCanvas)}
        title={label}
      >
        <span>{String(displayIndex).padStart(2, '0')}</span>
        {!isCollapsed && <strong>{label}</strong>}
        {!isCollapsed && configCount > 0 && !isActive && (
          <span className="script-config-indicator" title="Configurable script">
            <TuneIcon fontSize="small" />
          </span>
        )}
      </button>
      {!isCollapsed && isActive && !isDashboardOpen && !isSettingsOpen && (
        <div className="script-list-actions">
          <button
            className="icon-button script-list-icon-button"
            type="button"
            onClick={() => onEditScript(script)}
            title={`Edit script ${label}`}
          >
            <EditOutlinedIcon fontSize="small" />
          </button>
          <button
            className="icon-button script-list-icon-button danger"
            type="button"
            onClick={() => onDeleteScript(script)}
            title={`Delete script ${label}`}
          >
            <DeleteIcon fontSize="small" />
          </button>
        </div>
      )}
    </div>
  )
})

function ScriptSidebar({
  isCollapsed,
  scripts,
  allScripts = scripts,
  canvasNodeIds = new Set(),
  selectedNodeId,
  scriptSearch,
  onToggleCollapse,
  onSearchChange,
  onSelectScript,
  onDragStart,
  onEditScript,
  onDeleteScript,
  onOpenDashboard,
  onOpenRunLogs,
  onOpenSettings,
  onOpenWorkspace,
  isDashboardOpen = false,
  isRunLogsOpen = false,
  isSettingsOpen = false,
}) {
  const [isScriptsExpanded, setIsScriptsExpanded] = useState(true)
  const isWorkspaceActive = !isDashboardOpen && !isRunLogsOpen && !isSettingsOpen
  const scriptRows = useMemo(() => {
    const indexById = new Map(allScripts.map((script, index) => [script.id, index]))
    return scripts.map((script, index) => {
      const scriptIndex = indexById.get(script.id)
      const configCount = Object.keys(script.config || {}).filter((key) => key !== 'run_dir').length
      return {
        configCount,
        displayIndex: (scriptIndex ?? index) + 1,
        isOnCanvas: canvasNodeIds.has(script.id),
        label: displayText(script.label, 'Untitled script'),
        script,
      }
    })
  }, [allScripts, canvasNodeIds, scripts])

  function handleWorkspaceClick() {
    onOpenWorkspace()
    setIsScriptsExpanded((current) => !current)
  }

  return (
    <aside className={`script-sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand-row">
        <div className="brand">
          <SidebarBrandMark />
        </div>
        <button className="icon-button sidebar-toggle-button" type="button" onClick={onToggleCollapse} title="Toggle sidebar">
          <MenuOpenIcon fontSize="small" />
        </button>
      </div>

      {!isCollapsed && (
        <label className="sidebar-search">
          <SearchIcon fontSize="small" />
          <input
            value={scriptSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search"
          />
        </label>
      )}

      <nav className="sidebar-nav-group" aria-label="Workspace navigation">
        <button
          className={`sidebar-nav-button sidebar-dashboard-button ${isDashboardOpen ? 'active' : ''}`}
          type="button"
          onClick={onOpenDashboard}
          title={isDashboardOpen ? 'Dashboard' : 'Dashboard'}
          aria-label="Dashboard"
        >
          <DashboardIcon fontSize="small" />
          {!isCollapsed && <span>Dashboard</span>}
        </button>

        <button
          className={`sidebar-nav-button sidebar-run-logs-button ${isRunLogsOpen ? 'active' : ''}`}
          type="button"
          onClick={onOpenRunLogs}
          title="Run logs"
          aria-label="Run logs"
        >
          <ReceiptLongIcon fontSize="small" />
          {!isCollapsed && <span>Run Logs</span>}
        </button>

        <button
          className={`sidebar-nav-button sidebar-workspace-button ${isWorkspaceActive ? 'active' : ''}`}
          type="button"
          onClick={handleWorkspaceClick}
          title="Workspace scripts"
          aria-label="Workspace scripts"
          aria-expanded={!isCollapsed && isScriptsExpanded}
        >
          <AccountTreeIcon fontSize="small" />
          {!isCollapsed && <span>Workspace Scripts</span>}
          {!isCollapsed && (
            isScriptsExpanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />
          )}
        </button>
      </nav>

      {isScriptsExpanded && (
      <div className="script-list">
        {scripts.length === 0 && !isCollapsed && (
          <div className="sidebar-empty-state">
            <strong>No scripts found</strong>
            <p>Add or search for a script to place it on the canvas.</p>
          </div>
        )}
        {scriptRows.map(({ configCount, displayIndex, isOnCanvas, label, script }) => {
          const isActive = !isDashboardOpen && !isSettingsOpen && script.id === selectedNodeId
          return (
            <ScriptListRow
              configCount={configCount}
              displayIndex={displayIndex}
              isActive={isActive}
              isCollapsed={isCollapsed}
              isDashboardOpen={isDashboardOpen}
              isOnCanvas={isOnCanvas}
              isSettingsOpen={isSettingsOpen}
              key={script.id}
              label={label}
              onDeleteScript={onDeleteScript}
              onDragStart={onDragStart}
              onEditScript={onEditScript}
              onSelectScript={onSelectScript}
              script={script}
            />
          )
        })}
      </div>
      )}

      <div className="sidebar-footer">
        <button
          className={`sidebar-nav-button ${isSettingsOpen ? 'active' : ''}`}
          type="button"
          onClick={onOpenSettings}
        >
          <SettingsOutlinedIcon fontSize="small" />
          {!isCollapsed && <span>Settings</span>}
        </button>
      </div>
    </aside>
  )
}

export default memo(ScriptSidebar)
