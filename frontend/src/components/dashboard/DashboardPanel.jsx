import { memo, useEffect, useMemo, useRef, useState } from 'react'

const fileActivityCache = new Map()

function parseDate(value) {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date : null
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

function formatDateLabel(value) {
  const date = parseDate(value)
  if (!date) return 'Unknown date'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function runDurationSeconds(run) {
  const started = parseDate(run.started_at) || parseDate(run.created_at)
  const finished = parseDate(run.finished_at)
  if (!started || !finished) return null
  const seconds = (finished.getTime() - started.getTime()) / 1000
  return seconds >= 0 ? seconds : null
}

function filterDayGroups(groups, range) {
  if (range === 'last3') return groups.slice(-3)
  if (range === 'last7') return groups.slice(-7)
  if (range === 'month') return groups.slice(-31)
  return groups
}

function collectArrays(value, matcher, path = []) {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return matcher(path.at(-1) || '') ? value : []
  return Object.entries(value).flatMap(([key, item]) => collectArrays(item, matcher, [...path, key]))
}

function countFileActivity(run) {
  const cacheKey = `${run.id || run.created_at || 'run'}:${run.finished_at || ''}:${run.status || ''}`
  const cached = fileActivityCache.get(cacheKey)
  if (cached) return cached

  const nodeResults = run.result?.results || []
  const scannedMatcher = /scan|candidate|accepted|processed|routed|destination|upload|success|matched/i
  const skippedMatcher = /skip|reject|excluded|invalid|failed|unknown|unmatched|unmapped/i
  const activity = nodeResults.reduce(
    (total, node) => {
      const payload = node.result || {}
      const summarySkipped = [
        ...(Array.isArray(payload.skipped_extension_summary) ? payload.skipped_extension_summary : []),
        ...(Array.isArray(payload.unknown_extension_summary) ? payload.unknown_extension_summary : []),
      ].reduce((sum, item) => sum + (Number(item.count) || 0), 0)

      return {
        scanned: total.scanned + collectArrays(payload, (key) => scannedMatcher.test(key)).length,
        skipped: total.skipped + summarySkipped + collectArrays(payload, (key) => skippedMatcher.test(key)).length,
      }
    },
    { scanned: 0, skipped: 0 },
  )
  fileActivityCache.set(cacheKey, activity)
  if (fileActivityCache.size > 250) {
    fileActivityCache.delete(fileActivityCache.keys().next().value)
  }
  return activity
}

function buildDashboardAnalytics(runs) {
  const completedRuns = []
  const dayGroupMap = new Map()
  const todayRuns = []
  const successRuns = []
  const failedRuns = []
  const stoppedRuns = []
  const todayKey = new Date().toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' })
  let busiestDay = null
  let runtimeTotal = 0
  let runtimeCount = 0
  let slowestRun = null

  runs.forEach((run) => {
    if (!run.finished_at) return
    completedRuns.push(run)

    if (run.status === 'success') successRuns.push(run)
    if (run.status === 'error') failedRuns.push(run)
    if (run.status === 'stopped') stoppedRuns.push(run)

    const durationSeconds = runDurationSeconds(run)
    const isSuccessfulRun = run.status === 'success'
    if (isSuccessfulRun && Number.isFinite(durationSeconds)) {
      runtimeTotal += durationSeconds
      runtimeCount += 1
      if (!slowestRun || durationSeconds > slowestRun.durationSeconds) {
        slowestRun = { ...run, durationSeconds }
      }
    }

    const date = parseDate(run.created_at)
    const dayKey = date
      ? date.toLocaleDateString([], { year: 'numeric', month: '2-digit', day: '2-digit' })
      : 'Unknown'
    if (dayKey === todayKey) todayRuns.push(run)
    if (!dayGroupMap.has(dayKey)) {
      dayGroupMap.set(dayKey, {
        label: formatDateLabel(run.created_at),
        runs: [],
        runtimeCount: 0,
        runtimeTotal: 0,
      })
    }
    const dayGroup = dayGroupMap.get(dayKey)
    dayGroup.runs.push(run)
    if (isSuccessfulRun && Number.isFinite(durationSeconds)) {
      dayGroup.runtimeCount += 1
      dayGroup.runtimeTotal += durationSeconds
    }
    if (!busiestDay || dayGroup.runs.length > busiestDay.runs.length) {
      busiestDay = dayGroup
    }
  })

  const dayGroups = [...dayGroupMap.values()].reverse().map((group) => ({
    ...group,
    averageRuntime: group.runtimeCount ? group.runtimeTotal / group.runtimeCount : 0,
  }))
  const fileActivityByDay = dayGroups.map((group) => {
    let scanned = 0
    let skipped = 0
    group.runs.forEach((run) => {
      const activity = countFileActivity(run)
      scanned += activity.scanned
      skipped += activity.skipped
    })
    return {
      label: group.label,
      runs: group.runs,
      runCount: group.runs.length,
      averageRuntime: group.runtimeCount ? group.runtimeTotal / group.runtimeCount : 0,
      scanned,
      skipped,
    }
  })

  const totalFileActivity = fileActivityByDay.reduce(
    (sum, item) => ({
      scanned: sum.scanned + item.scanned,
      skipped: sum.skipped + item.skipped,
    }),
    { scanned: 0, skipped: 0 },
  )
  const activeFileDays = fileActivityByDay.filter((item) => item.scanned || item.skipped).length || 1

  return {
    activeFileDays,
    averageRuntime: runtimeCount ? runtimeTotal / runtimeCount : 0,
    busiestDay,
    completedRuns,
    dayGroups,
    failedRuns,
    fileActivityByDay,
    slowestRun,
    stoppedRuns,
    successRuns,
    todayRuns,
    totalFileActivity,
  }
}

function useChart(canvasRef, config) {
  useEffect(() => {
    if (!canvasRef.current || !config) return undefined
    let chart = null
    let isCancelled = false
    let animationFrameId = null

    import('chart.js/auto').then((module) => {
      if (isCancelled || !canvasRef.current) return
      const Chart = module.default
      const { animateFromZeroData, ...chartConfig } = config
      const finalDatasets = chartConfig.data.datasets
      const initialConfig = animateFromZeroData
        ? {
            ...chartConfig,
            data: {
              ...chartConfig.data,
              datasets: finalDatasets.map((dataset) => ({
                ...dataset,
                data: dataset.data.map(() => 0),
              })),
            },
          }
        : chartConfig
      chart = new Chart(canvasRef.current, initialConfig)

      if (animateFromZeroData) {
        animationFrameId = window.requestAnimationFrame(() => {
          if (isCancelled || !chart) return
          chart.data.datasets.forEach((dataset, index) => {
            dataset.data = finalDatasets[index].data
          })
          chart.update()
        })
      }
    })

    return () => {
      isCancelled = true
      if (animationFrameId) window.cancelAnimationFrame(animationFrameId)
      chart?.destroy()
    }
  }, [canvasRef, config])
}

function ChartFilter({ label, onChange, options, value }) {
  return (
    <div className="dashboard-chart-filter" aria-label={label}>
      {options.map((option) => (
        <button
          className={option.value === value ? 'active' : ''}
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function makeCountItems(count, status = '') {
  return Array.from({ length: Math.max(0, Number(count) || 0) }, (_, index) => ({
    id: `${status || 'item'}-${index}`,
    status,
  }))
}

function averagePerRunPerDay(dayGroups, key) {
  const activeGroups = dayGroups.filter((group) => group.scanned || group.skipped)
  if (!activeGroups.length) return 0
  const totalDailyAverage = activeGroups.reduce((sum, group) => {
    const runCount = group.runCount || group.runs?.length || 0
    return sum + (runCount ? (Number(group[key]) || 0) / runCount : 0)
  }, 0)
  return totalDailyAverage / activeGroups.length
}

function normalizeBackendAnalytics(data) {
  if (!data) return null
  const statusCounts = data.status_counts || {}
  const todayStatusCounts = data.today_status_counts || {}
  const dayGroups = Array.isArray(data.day_groups)
    ? data.day_groups.map((group) => ({
        averageRuntime: Number(group.average_runtime_seconds) || 0,
        label: group.label || 'Unknown date',
        runCount: Number(group.run_count) || 0,
        runs: makeCountItems(group.run_count),
        scanned: Number(group.scanned) || 0,
        skipped: Number(group.skipped) || 0,
      }))
    : []
  const busiestDay = data.busiest_day
    ? {
        label: data.busiest_day.label || 'Unknown date',
        runs: makeCountItems(data.busiest_day.run_count),
      }
    : null

  return {
    activeFileDays: Number(data.active_file_days) || 1,
    averageRuntime: Number(data.average_success_runtime_seconds) || 0,
    busiestDay,
    completedRuns: makeCountItems(data.completed_runs_count),
    dayGroups,
    failedRuns: makeCountItems(statusCounts.error, 'error'),
    fileActivityByDay: dayGroups,
    slowestRun: data.slowest_success_run
      ? {
          created_at: data.slowest_success_run.created_at,
          durationSeconds: Number(data.slowest_success_run.duration_seconds) || 0,
        }
      : null,
    stoppedRuns: makeCountItems(statusCounts.stopped, 'stopped'),
    successRuns: makeCountItems(statusCounts.success, 'success'),
    todayRuns: makeCountItems(data.today_runs_count),
    todayStatusCounts,
    totalFileActivity: {
      scanned: Number(data.total_file_activity?.scanned) || 0,
      skipped: Number(data.total_file_activity?.skipped) || 0,
    },
  }
}

function DashboardPanel({ analyticsData = null, error = '', isLoading = false, runs = [] }) {
  const [runtimeRange, setRuntimeRange] = useState('all')
  const [statusScope, setStatusScope] = useState('all')
  const runtimeCanvasRef = useRef(null)
  const statusCanvasRef = useRef(null)

  const analytics = useMemo(
    () => normalizeBackendAnalytics(analyticsData) || buildDashboardAnalytics(runs),
    [analyticsData, runs],
  )

  const filteredRuntimeGroups = useMemo(
    () => filterDayGroups(analytics.dayGroups, runtimeRange),
    [analytics.dayGroups, runtimeRange],
  )

  const statusRuns = useMemo(
    () => (statusScope === 'today' ? analytics.todayRuns : analytics.completedRuns),
    [analytics.completedRuns, analytics.todayRuns, statusScope],
  )
  const statusCounts = useMemo(
    () => {
      if (statusScope === 'all') {
        return {
          failed: analytics.failedRuns.length,
          stopped: analytics.stoppedRuns.length,
          success: analytics.successRuns.length,
        }
      }
      if (analyticsData) {
        return {
          failed: Number(analytics.todayStatusCounts?.error) || 0,
          stopped: Number(analytics.todayStatusCounts?.stopped) || 0,
          success: Number(analytics.todayStatusCounts?.success) || 0,
        }
      }
      return {
        failed: statusRuns.filter((run) => run.status === 'error').length,
        stopped: statusRuns.filter((run) => run.status === 'stopped').length,
        success: statusRuns.filter((run) => run.status === 'success').length,
      }
    },
    [
      analytics.failedRuns.length,
      analytics.stoppedRuns.length,
      analytics.successRuns.length,
      analytics.todayStatusCounts,
      analyticsData,
      statusRuns,
      statusScope,
    ],
  )

  const runtimeChartConfig = useMemo(() => {
    if (!filteredRuntimeGroups.length) return null
    return {
      animateFromZeroData: true,
      type: 'line',
      data: {
        labels: filteredRuntimeGroups.map((group) => group.label),
        datasets: [
          {
            label: 'Average successful runtime',
            data: filteredRuntimeGroups.map((group) => Math.round(group.averageRuntime || 0)),
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.12)',
            pointBackgroundColor: '#2563eb',
            pointRadius: 3,
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 700,
          easing: 'easeOutQuart',
        },
        animations: {
          tension: {
            duration: 700,
            easing: 'easeOutQuart',
            from: 0.15,
            to: 0.35,
          },
          y: {
            duration: 650,
            easing: 'easeOutCubic',
            from: 0,
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            position: 'nearest',
            intersect: false,
            callbacks: {
              label: (context) => `Successful average: ${formatDuration(context.parsed.y)}`,
            },
          },
        },
        interaction: {
          mode: 'index',
          intersect: false,
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: (value) => formatDuration(Number(value)),
            },
            grid: { color: 'rgba(148, 163, 184, 0.22)' },
          },
          x: {
            grid: { display: false },
          },
        },
      },
    }
  }, [filteredRuntimeGroups])

  const statusChartConfig = useMemo(() => {
    const totalRuns = statusCounts.success + statusCounts.failed + statusCounts.stopped
    if (!totalRuns) return null
    return {
      animateFromZeroData: true,
      type: 'doughnut',
      data: {
        labels: ['Completed', 'Failed', 'Stopped'],
        datasets: [
          {
            data: [
              statusCounts.success,
              statusCounts.failed,
              statusCounts.stopped,
            ],
            backgroundColor: ['#22c55e', '#ef4444', '#f59e0b'],
            borderColor: '#ffffff',
            borderWidth: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          animateRotate: true,
          animateScale: true,
          duration: 650,
          easing: 'easeOutQuart',
        },
        animations: {
          circumference: {
            from: 0,
            duration: 650,
            easing: 'easeOutQuart',
          },
          rotation: {
            from: -120,
            duration: 550,
            easing: 'easeOutCubic',
          },
        },
        cutout: '68%',
        plugins: {
          tooltip: {
            position: 'nearest',
          },
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 10,
              usePointStyle: true,
            },
          },
        },
      },
    }
  }, [statusCounts.failed, statusCounts.stopped, statusCounts.success])

  useChart(runtimeCanvasRef, runtimeChartConfig)
  useChart(statusCanvasRef, statusChartConfig)

  const reportCards = useMemo(
    () => [
      {
        title: 'Slowest Run',
        value: analytics.slowestRun ? formatDuration(analytics.slowestRun.durationSeconds) : '0s',
        detail: analytics.slowestRun
          ? `${formatDateLabel(analytics.slowestRun.created_at)} at ${parseDate(analytics.slowestRun.created_at)?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : 'No completed runtime data.',
      },
      {
        title: 'Avg Scanned / Run / Day',
        value: Math.round(averagePerRunPerDay(analytics.fileActivityByDay, 'scanned')).toLocaleString(),
        detail: 'Daily average per run',
      },
      {
        title: 'Avg Skipped / Run / Day',
        value: Math.round(averagePerRunPerDay(analytics.fileActivityByDay, 'skipped')).toLocaleString(),
        detail: 'Daily average per run',
      },
      {
        title: 'Busiest Day',
        value: analytics.busiestDay ? analytics.busiestDay.runs.length.toLocaleString() : '0',
        detail: analytics.busiestDay ? analytics.busiestDay.label : 'No run volume yet.',
      },
    ],
    [analytics],
  )

  const topStats = useMemo(
    () => [
      {
        title: 'Avg Successful Runtime',
        value: formatDuration(analytics.averageRuntime),
        detail: 'Successful runs',
      },
      {
        title: 'Runs Today',
        value: analytics.todayRuns.length.toLocaleString(),
        detail: `${analytics.completedRuns.length} total logs loaded`,
      },
      reportCards[0],
    ],
    [analytics.averageRuntime, analytics.completedRuns.length, analytics.todayRuns.length, reportCards],
  )
  const hasRunData = analytics.completedRuns.length > 0

  return (
    <section className={`dashboard-panel ${isLoading ? 'loading' : ''}`}>
      {isLoading && (
        <div className="dashboard-loading-overlay" role="status" aria-live="polite">
          <div className="dashboard-loading-card">
            <span className="dashboard-loading-spinner" aria-hidden="true" />
            <strong>Loading analytics...</strong>
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="dashboard-summary-bar">
        <div>
          <span className="eyebrow">Overview</span>
          <h3>Ingestion Performance</h3>
        </div>
        <p>
          {hasRunData
            ? `${analytics.completedRuns.length.toLocaleString()} completed runs analyzed`
            : 'Run the workflow to start collecting analytics.'}
        </p>
      </div>

      <div className="dashboard-top-stats">
        {topStats.map((card, index) => (
          <article
            className={`dashboard-stat-card ${index === 0 ? 'primary-stat' : index === 1 ? 'success-stat' : 'danger-stat'}`}
            key={card.title}
          >
            <span className="dashboard-card-kicker">{card.title}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </article>
        ))}
      </div>

      <div className="dashboard-chart-grid">
        <article className="dashboard-chart-card dashboard-chart-card-main">
          <div className="dashboard-chart-heading">
            <div>
              <span className="eyebrow">Trend</span>
              <h3>Average Successful Runtime by Day</h3>
            </div>
            <ChartFilter
              label="Runtime range"
              value={runtimeRange}
              onChange={setRuntimeRange}
              options={[
                { value: 'all', label: 'All' },
                { value: 'month', label: '1M' },
                { value: 'last7', label: '7D' },
                { value: 'last3', label: '3D' },
              ]}
            />
          </div>
          <div className="dashboard-chart-frame">
            {runtimeChartConfig ? (
              <canvas ref={runtimeCanvasRef} />
            ) : (
              <div className="dashboard-empty-state">
                <strong>No runtime trend yet</strong>
                <p>Completed workflow runs will appear here.</p>
              </div>
            )}
          </div>
        </article>
        <article className="dashboard-chart-card dashboard-chart-card-side">
          <div className="dashboard-chart-heading">
            <div>
              <span className="eyebrow">Health</span>
              <h3>Run Status Mix</h3>
            </div>
            <ChartFilter
              label="Status scope"
              value={statusScope}
              onChange={setStatusScope}
              options={[
                { value: 'all', label: 'All' },
                { value: 'today', label: 'Today' },
              ]}
            />
          </div>
          <div className="dashboard-chart-frame compact">
            {statusChartConfig ? (
              <canvas ref={statusCanvasRef} />
            ) : (
              <div className="dashboard-empty-state">
                <strong>No status data yet</strong>
                <p>Run outcomes will appear after the first completed run.</p>
              </div>
            )}
          </div>
        </article>
      </div>

      <div className="dashboard-report-strip">
        {reportCards.slice(1).map((card) => (
          <article className="dashboard-report-card" key={card.title}>
            <span className="dashboard-card-kicker">{card.title}</span>
            <strong>{card.value}</strong>
            <p>{card.detail}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

export default memo(DashboardPanel)
