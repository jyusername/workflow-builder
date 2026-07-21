export const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function displayText(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const text = value.map((item) => displayText(item)).filter(Boolean).join(', ')
    return text || fallback
  }
  try {
    return JSON.stringify(value)
  } catch {
    return fallback || String(value)
  }
}

export function formatRunStatus(status) {
  if (status === 'queued') return 'Queued'
  if (status === 'success') return 'Completed'
  if (status === 'stopped') return 'Stopped by user'
  if (status === 'error') return 'Failed'
  if (status === 'starting') return 'Starting'
  if (status === 'running') return 'Running'
  if (status === 'stopping') return 'Stopping'
  return status || 'Idle'
}

export function formatScheduleTime(timeValue) {
  if (!timeValue) return '--:--'
  const [rawHour, rawMinute = '00'] = String(timeValue).split(':')
  const hour = Number(rawHour)
  const minute = Number(rawMinute)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return timeValue
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function formatScheduleSummary(schedule) {
  if (!schedule?.enabled) return 'Manual'
  const displayTime = formatScheduleTime(schedule.time)
  if (schedule.type === 'weekly') {
    const days = (schedule.days_of_week || []).map((day) => weekdayLabels[day]).join(', ')
    return `Weekly ${days} at ${displayTime}`
  }
  if (schedule.type === 'interval') {
    return `Every ${schedule.every_minutes || 0} min`
  }
  const displayDate = schedule.date
    ? new Date(`${schedule.date}T00:00:00`).toLocaleDateString([], {
        month: 'long',
        day: '2-digit',
        year: 'numeric',
      })
    : 'date'
  return `Once on ${displayDate} at ${displayTime}`
}

export function toTitleLabel(value) {
  return displayText(value, 'Setting')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function parseListInput(value) {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}
