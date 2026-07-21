import { CloseIcon } from '../../utils/icons'
import { formatScheduleSummary, weekdayLabels } from '../../utils/format'

function ScheduleModal({
  activeSchedule,
  draftSchedule,
  error,
  dateInputValue,
  onUpdateDraft,
  onToggleDay,
  onCancelSchedule,
  onClose,
  onSubmit,
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <form className="project-modal schedule-modal" onSubmit={onSubmit}>
        <div className="modal-header schedule-modal-header">
          <div>
            <span className="eyebrow">Schedule Run</span>
            <h2>{draftSchedule.type === 'weekly' ? 'Repeat weekly' : 'Run once'}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close modal">
            <CloseIcon fontSize="small" />
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}

        <div className="schedule-mode-grid" role="group" aria-label="Schedule mode">
          <button
            className={`schedule-mode-card ${draftSchedule.type === 'once' ? 'active' : ''}`}
            type="button"
            onClick={() => onUpdateDraft({ type: 'once', days_of_week: [] })}
          >
            <strong>Once</strong>
            <span>Run on one future date and time</span>
          </button>
          <button
            className={`schedule-mode-card ${draftSchedule.type === 'weekly' ? 'active' : ''}`}
            type="button"
            onClick={() => onUpdateDraft({ type: 'weekly' })}
          >
            <strong>Weekly</strong>
            <span>Repeat on selected weekdays</span>
          </button>
        </div>

        {draftSchedule.type === 'weekly' ? (
          <div className="schedule-panel">
            <label className="schedule-field">
              Run time
              <input
                type="time"
                value={draftSchedule.time}
                onChange={(event) => onUpdateDraft({ time: event.target.value })}
              />
            </label>
            <div className="schedule-field">
              <span>Run days</span>
              <div className="weekday-row">
                {weekdayLabels.map((label, day) => {
                  const active = draftSchedule.days_of_week.includes(day)
                  return (
                    <button
                      className={`weekday-chip ${active ? 'active' : ''}`}
                      key={label}
                      type="button"
                      onClick={() => onToggleDay(day)}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="schedule-panel schedule-fields-grid">
            <label className="schedule-field">
              Run date
              <input
                type="date"
                min={dateInputValue()}
                value={draftSchedule.date}
                onChange={(event) => onUpdateDraft({ date: event.target.value })}
              />
            </label>
            <label className="schedule-field">
              Run time
              <input
                type="time"
                value={draftSchedule.time}
                onChange={(event) => onUpdateDraft({ time: event.target.value })}
              />
            </label>
          </div>
        )}

        {draftSchedule.next_run_at && (
          <div className="schedule-preview">
            <span>Next run</span>
            <strong>{new Date(draftSchedule.next_run_at).toLocaleString()}</strong>
          </div>
        )}

        <div className="modal-actions schedule-modal-actions">
          <button
            className="clear-schedule-button"
            type="button"
            onClick={onCancelSchedule}
            disabled={!activeSchedule.enabled}
          >
            Clear Schedule
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Save Schedule
          </button>
        </div>
      </form>
    </div>
  )
}

export function ScheduleConfirmModal({ activeSchedule, onClose, onSetNew }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="project-modal compact-modal schedule-confirm-modal" role="dialog" aria-modal="true">
        <div className="modal-header schedule-modal-header">
          <div>
            <span className="eyebrow">Schedule</span>
            <h2>Schedule already set</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Close modal">
            <CloseIcon fontSize="small" />
          </button>
        </div>

        <div className="schedule-confirm-card">
          <span>Current schedule</span>
          <strong>{formatScheduleSummary(activeSchedule)}</strong>
        </div>

        <p className="modal-copy schedule-confirm-copy">
          Setting a new schedule will replace the current one.
        </p>

        <div className="modal-actions schedule-confirm-actions">
          <button type="button" onClick={onClose}>
            Keep Current
          </button>
          <button className="primary" type="button" onClick={onSetNew}>
            Set New Schedule
          </button>
        </div>
      </div>
    </div>
  )
}

export default ScheduleModal
