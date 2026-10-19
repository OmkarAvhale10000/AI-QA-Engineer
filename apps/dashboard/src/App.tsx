import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Play, Square, RotateCcw, Bug, Code2, Terminal,
  Globe, CheckCircle2, XCircle, Clock, AlertTriangle,
  ChevronRight, ChevronDown, Download, Copy, Check,
  Settings, Layers, ExternalLink, Filter, Search, FileCode2,
  ListChecks, HelpCircle, Bell, ShoppingBag, FileText,
  Sliders, Zap, ShieldAlert, BookOpen, X, PanelLeftClose, PanelLeftOpen
} from 'lucide-react'

// ── Type Definitions ────────────────────────────────────────────────────────

type SessionStatus = 'idle' | 'exploring' | 'planning' | 'executing' | 'verifying' | 'synthesizing' | 'done' | 'error'
type AgentName = 'cartographer' | 'planner' | 'executor' | 'critic' | 'synthesizer'

interface ActionLog {
  timestamp: number
  agent: AgentName
  type: 'thought' | 'action' | 'observation' | 'error' | 'success'
  message: string
}

interface TestStep {
  index: number
  description: string
  action: {
    type: string
    url?: string
    selector?: string
    value?: string
    ms?: number
  }
  expectedOutcome: string
  actualOutcome?: string
  passed?: boolean
  durationMs?: number
}

interface TestCase {
  id: string
  title: string
  category: 'happy-path' | 'boundary' | 'edge' | 'error'
  priority: 'critical' | 'high' | 'medium' | 'low'
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  durationMs?: number
  steps?: TestStep[]
}

interface BugReport {
  id: string
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  category: string
  reproducible: boolean
  reproductionSteps: { index: number; description: string; selector?: string; value?: string }[]
  expectedBehavior: string
  actualBehavior: string
  screenshotPath?: string
  consoleErrors: string[]
  networkErrors: { url: string; method: string; status: number }[]
  discoveredAt: number
}

interface GeneratedTest {
  id: string
  filename: string
  title: string
  code: string
  status: 'generated' | 'running' | 'passed' | 'failed'
}

interface StateNode {
  id: string
  url: string
  title: string
  components: string[]
}

interface AgentSession {
  id: string
  targetUrl: string
  appDescription: string
  status: SessionStatus
  startedAt: number
  currentAgent: AgentName
  stateGraph: StateNode[]
  testCases: TestCase[]
  executionLog: ActionLog[]
  bugs: BugReport[]
  generatedTests: GeneratedTest[]
}

interface NotificationItem {
  id: string
  title: string
  time: string
  type: 'info' | 'bug' | 'success'
}

const AGENT_PORT = 3001

const PIPELINE_STEPS = [
  { agent: 'cartographer' as AgentName, label: 'Cartographer', desc: 'Site Mapping', status: ['exploring'] },
  { agent: 'planner' as AgentName, label: 'Planner', desc: 'Test Strategy', status: ['planning'] },
  { agent: 'executor' as AgentName, label: 'Executor', desc: 'Playwright Run', status: ['executing'] },
  { agent: 'critic' as AgentName, label: 'Critic', desc: 'Bug Verification', status: ['verifying'] },
  { agent: 'synthesizer' as AgentName, label: 'Synthesizer', desc: 'Code Generation', status: ['synthesizing'] },
]

type StudioTab = 'tests' | 'bugs' | 'code' | 'sitemap' | 'logs'
type SidebarView = 'target' | 'methods' | 'sitemap' | 'search' | 'help' | 'settings'

// ── Default Ready State Data ────────────────────────────────────────────────

const INITIAL_STATE_GRAPH: StateNode[] = []

const INITIAL_TEST_CASES: TestCase[] = []

const INITIAL_BUGS: BugReport[] = []

const INITIAL_GENERATED_TESTS: GeneratedTest[] = []

const INITIAL_LOGS: ActionLog[] = []
const INITIAL_NOTIFICATIONS: NotificationItem[] = []

export default function App() {
  const [session, setSession] = useState<AgentSession | null>(null)
  const [logs, setLogs] = useState<ActionLog[]>([])
  const [testCases, setTestCases] = useState<TestCase[]>([])
  const [bugs, setBugs] = useState<BugReport[]>([])
  const [generatedTests, setGeneratedTests] = useState<GeneratedTest[]>([])
  const [stateGraph, setStateGraph] = useState<StateNode[]>([])
  const [studioTab, setStudioTab] = useState<StudioTab>('tests')

  // Selection states
  const [selectedBug, setSelectedBug] = useState<BugReport | null>(null)
  const [selectedTest, setSelectedTest] = useState<GeneratedTest | null>(null)
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null)

  // Sidebar Configuration States
  const [targetUrl, setTargetUrl] = useState('')
  const [appDesc, setAppDesc] = useState('')
  const [presetType, setPresetType] = useState<'buggycart' | 'custom'>('custom')
  const [testScope, setTestScope] = useState<'comprehensive' | 'smoke'>('comprehensive')

  // Preferred Testing Types with toggles
  const [testMethods, setTestMethods] = useState({
    happyPath: true,
    boundary: true,
    edgeCases: true,
    errorStates: true,
  })

  // Top Bar & Modal States
  const [showNotifications, setShowNotifications] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [notifications, setNotifications] = useState<NotificationItem[]>([])

  // Search & Filters
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [logFilterAgent, setLogFilterAgent] = useState<string>('all')
  const [logSearchQuery, setLogSearchQuery] = useState('')
  const [bugFilterSeverity, setBugFilterSeverity] = useState<string>('all')

  // UI state
  const [copied, setCopied] = useState(false)
  const [copiedBugId, setCopiedBugId] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [activeSidebarView, setActiveSidebarView] = useState<SidebarView | null>('target')

  const toggleSidebarView = (view: SidebarView) => {
    setActiveSidebarView(prev => prev === view ? null : view)
  }

  const wsRef = useRef<WebSocket | null>(null)
  const logsEndRef = useRef<HTMLDivElement>(null)

  const status: SessionStatus = session?.status ?? 'idle'
  const isRunning = ['exploring', 'planning', 'executing', 'verifying', 'synthesizing'].includes(status)
  const currentAgent: AgentName = session?.currentAgent ?? 'cartographer'

  // ── WebSocket Connection ─────────────────────────────────────────────────

  const handleWsMessage = useCallback((msg: { type: string;[key: string]: unknown }) => {
    switch (msg.type) {
      case 'session_update': {
        const s = msg.session as Partial<AgentSession>
        setSession(prev => ({
          ...(prev ?? {} as AgentSession),
          ...s
        }))
        if (s.testCases) setTestCases(s.testCases)
        if (s.stateGraph) setStateGraph(s.stateGraph)
        if (s.bugs) setBugs(s.bugs)
        if (s.generatedTests) setGeneratedTests(s.generatedTests)
        break
      }

      case 'log':
        setLogs(prev => [...prev.slice(-400), msg.log as ActionLog])
        break

      case 'test_update': {
        const tc = msg.testCase as TestCase
        setTestCases(prev => {
          const idx = prev.findIndex(t => t.id === tc.id)
          if (idx >= 0) {
            const next = [...prev]
            next[idx] = tc
            return next
          }
          return [...prev, tc]
        })
        break
      }

      case 'bug_found': {
        const b = msg.bug as BugReport
        setBugs(prev => {
          const exists = prev.find(x => x.id === b.id)
          if (!exists) {
            setStudioTab('bugs')
            setSelectedBug(b)
            setNotifications(n => [{
              id: `notif_${Date.now()}`,
              title: `New verified bug found: ${b.title}`,
              time: 'Just now',
              type: 'bug'
            }, ...n.slice(0, 19)])
            return [b, ...prev]
          }
          return prev
        })
        break
      }

      case 'test_generated': {
        const t = msg.test as GeneratedTest
        setGeneratedTests(prev => {
          const exists = prev.find(x => x.id === t.id)
          if (!exists) {
            setSelectedTest(t)
            setNotifications(n => [{
              id: `notif_${Date.now()}`,
              title: `Generated Playwright spec: ${t.filename}`,
              time: 'Just now',
              type: 'success'
            }, ...n.slice(0, 19)])
            return [...prev, t]
          }
          return prev
        })
        break
      }
    }
  }, [])

  const connectWS = useCallback(() => {
    const ws = new WebSocket(`ws://localhost:${AGENT_PORT}`)
    wsRef.current = ws

    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => {
      setWsConnected(false)
      setTimeout(connectWS, 3000)
    }
    ws.onerror = () => setWsConnected(false)
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        handleWsMessage(msg)
      } catch {
        // ignore malformed payloads
      }
    }
  }, [handleWsMessage])

  useEffect(() => {
    connectWS()
    return () => {
      wsRef.current?.close()
    }
  }, [connectWS])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        const target = e.target as HTMLElement
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
          return
        }
        e.preventDefault()
        setActiveSidebarView(prev => prev ? null : 'target')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  useEffect(() => {
    if (!selectedBug && bugs.length > 0) {
      setSelectedBug(bugs[0])
    }
  }, [bugs, selectedBug])

  useEffect(() => {
    if (!selectedTest && generatedTests.length > 0) {
      setSelectedTest(generatedTests[0])
    }
  }, [generatedTests, selectedTest])

  // ── Session Controls ─────────────────────────────────────────────────────

  const startSession = async () => {
    setLogs([])
    setTestCases([])
    setBugs([])
    setGeneratedTests([])
    setStateGraph([])
    setSelectedBug(null)
    setSelectedTest(null)

    try {
      const res = await fetch(`http://localhost:${AGENT_PORT}/api/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl, appDescription: appDesc }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
    } catch (err) {
      const msg = (err as Error).message
      setLogs([{
        timestamp: Date.now(),
        agent: 'cartographer',
        type: 'error',
        message: `Failed to connect to agent backend on port ${AGENT_PORT}: ${msg}`,
      }])
      setSession(prev => prev ? { ...prev, status: 'error' } : null)
    }
  }

  const stopSession = async () => {
    await fetch(`http://localhost:${AGENT_PORT}/api/session/stop`, { method: 'POST' }).catch(() => { })
    setSession(prev => prev ? { ...prev, status: 'idle' } : null)
  }

  const resetStudio = () => {
    setSession(null)
    setLogs([])
    setTestCases([])
    setBugs([])
    setGeneratedTests([])
    setStateGraph([])
    setSelectedBug(null)
    setSelectedTest(null)
    setExpandedTestId(null)
    setNotifications([])
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getStepState = (step: typeof PIPELINE_STEPS[0]) => {
    if (!session || status === 'idle') return 'ready'
    if (status === 'done') return 'done'
    if (status === 'error') return 'error'
    const idx = PIPELINE_STEPS.indexOf(step)
    const currentIdx = PIPELINE_STEPS.findIndex(s => s.status.includes(status))
    if (idx < currentIdx) return 'done'
    if (step.status.includes(status)) return 'active'
    return 'queued'
  }

  const latestLog = logs[logs.length - 1]

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadCode = (filename: string, code: string) => {
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyBugMarkdown = (bug: BugReport) => {
    const md = `### Bug Report: ${bug.title}
**Severity:** ${bug.severity.toUpperCase()}
**Category:** ${bug.category}
**Reproducible:** ${bug.reproducible ? 'Verified' : 'Unconfirmed'}

#### Steps to Reproduce:
${bug.reproductionSteps.map(s => `${s.index}. ${s.description}`).join('\n')}

#### Expected Behavior:
${bug.expectedBehavior}

#### Actual Behavior:
${bug.actualBehavior}

${bug.consoleErrors.length ? `#### Console Errors:\n\`\`\`\n${bug.consoleErrors.join('\n')}\n\`\`\`` : ''}
${bug.networkErrors.length ? `#### Network Errors:\n\`\`\`\n${bug.networkErrors.map(e => `${e.method} ${e.url} [Status: ${e.status}]`).join('\n')}\n\`\`\`` : ''}
`
    navigator.clipboard.writeText(md)
    setCopiedBugId(bug.id)
    setTimeout(() => setCopiedBugId(null), 2000)
  }

  const formatMs = (ms?: number) => ms ? `${(ms / 1000).toFixed(1)}s` : ''
  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

  // Filtered views
  const filteredBugs = bugs.filter(b => bugFilterSeverity === 'all' || b.severity === bugFilterSeverity)
  const filteredLogs = logs.filter(l => {
    const matchAgent = logFilterAgent === 'all' || l.agent === logFilterAgent
    const matchSearch = !logSearchQuery || l.message.toLowerCase().includes(logSearchQuery.toLowerCase())
    return matchAgent && matchSearch
  })

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mission-control-app">
      {/* ── Top Bar: Studio Header & Global Controls ── */}
      <header className="mission-topbar">
        <div className="topbar-left">
          <div className="brand-badge">AI</div>
          <div className="brand-text">
            <span className="brand-title">Autonomous AI QA Engineer</span>
            <span className="brand-subtitle">Mission Control Studio</span>
          </div>
        </div>

        {/* Global Status Telemetry */}
        <div className="topbar-center-telemetry">
          <div className="target-summary-pill">
            <Globe size={11} className="pill-icon" />
            <span className="pill-url mono">{session?.targetUrl ?? targetUrl}</span>
            <span className="pill-divider">|</span>
            <span className="pill-state">
              {presetType === 'buggycart' ? 'BuggyCart Benchmark' : 'Custom Target'}
            </span>
          </div>
        </div>

        {/* Right Action Icons */}
        <div className="topbar-actions">
          {/* Notifications Popover Toggle with Icon */}
          <div className="topbar-icon-wrap">
            <button
              className={`btn-topbar-icon ${showNotifications ? 'active' : ''}`}
              title="Notifications & System Events"
              onClick={() => setShowNotifications(!showNotifications)}
            >
              <Bell size={14} />
              {notifications.length > 0 && <span className="icon-badge-dot" />}
            </button>

            {showNotifications && (
              <div className="notifications-popover">
                <div className="popover-header">
                  <span className="popover-title">Activity & Notifications</span>
                  <button className="popover-close" onClick={() => setShowNotifications(false)}>
                    <X size={12} />
                  </button>
                </div>
                <div className="notifications-list">
                  {notifications.length === 0 ? (
                    <div className="empty-panel-state-mini">
                      <Bell size={16} className="text-muted" />
                      <span>No notifications yet</span>
                    </div>
                  ) : (
                    notifications.map(n => (
                      <div key={n.id} className="notification-row">
                        <span className={`notif-indicator ${n.type}`} />
                        <div className="notif-content">
                          <span className="notif-title">{n.title}</span>
                          <span className="notif-time mono">{n.time}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Help & Quick Guide with Icon */}
          <button
            className={`btn-topbar-icon ${showHelpModal ? 'active' : ''}`}
            title="Help & System Guide"
            onClick={() => setShowHelpModal(true)}
          >
            <HelpCircle size={14} />
          </button>
        </div>
      </header>

      {/* ── Main App Shell: Left Sidebar + Central Studio Workspace ── */}
      <div className="studio-app-shell">
        {/* ── Left Activity Bar (Vertical Icon Strip) ── */}
        <nav className="activity-bar" aria-label="Activity Bar">
          <div className="activity-bar-upper">
            <button
              className={`activity-icon-btn ${activeSidebarView === 'target' ? 'active' : ''}`}
              title="Target Application & URLs"
              onClick={() => toggleSidebarView('target')}
            >
              <Globe size={18} />
            </button>

            <button
              className={`activity-icon-btn ${activeSidebarView === 'methods' ? 'active' : ''}`}
              title="Testing Methods & Scope"
              onClick={() => toggleSidebarView('methods')}
            >
              <Sliders size={18} />
            </button>

            <button
              className={`activity-icon-btn ${activeSidebarView === 'sitemap' ? 'active' : ''}`}
              title="Discovered Pages & Sitemap"
              onClick={() => toggleSidebarView('sitemap')}
            >
              <Layers size={18} />
            </button>
          </div>

          <div className="activity-bar-lower">
            <button
              className={`activity-icon-btn ${activeSidebarView === 'search' ? 'active' : ''}`}
              title="Search Workspace"
              onClick={() => toggleSidebarView('search')}
            >
              <Search size={18} />
            </button>

            <button
              className={`activity-icon-btn ${activeSidebarView === 'help' ? 'active' : ''}`}
              title="Help & Guides"
              onClick={() => toggleSidebarView('help')}
            >
              <BookOpen size={18} />
            </button>

            <button
              className={`activity-icon-btn ${activeSidebarView === 'settings' ? 'active' : ''}`}
              title="Engine Settings"
              onClick={() => toggleSidebarView('settings')}
            >
              <Settings size={18} />
            </button>
          </div>
        </nav>

        {/* ── Expandable Primary Side Panel (Sliding Drawer) ── */}
        <aside className={`primary-side-panel ${activeSidebarView ? 'open' : 'collapsed'}`}>
          {/* Panel Body Content by active view */}
          <div className="side-panel-content">
            {activeSidebarView === 'target' && (
              <>
                {/* Target Preset Selection */}
                <div className="sidebar-group">
                  <span className="sidebar-group-title">
                    <Globe size={12} />
                    <span>Target Preset</span>
                  </span>

                  <div className="sidebar-preset-stack">
                    <button
                      className={`sidebar-preset-card ${presetType === 'custom' ? 'active' : ''}`}
                      onClick={() => {
                        setPresetType('custom')
                        setTargetUrl('https://')
                        setAppDesc('')
                      }}
                    >
                      <div className="preset-card-top">
                        <Globe size={13} className="preset-icon" />
                        <span className="preset-name">Custom URL</span>
                      </div>
                      <span className="preset-detail">Staging, preview, or production web app</span>
                    </button>

                    <button
                      className={`sidebar-preset-card ${presetType === 'buggycart' ? 'active' : ''}`}
                      onClick={() => {
                        setPresetType('buggycart')
                        setTargetUrl('http://localhost:5174')
                        setAppDesc('An e-commerce store where users can browse products, add items to a cart, apply coupon codes (SAVE20), and complete checkout with shipping and payment details.')
                      }}
                    >
                      <div className="preset-card-top">
                        <ShoppingBag size={13} className="preset-icon" />
                        <span className="preset-name">BuggyCart Store</span>
                      </div>
                      <span className="preset-detail">Local benchmark (port 5174, 6 planted bugs)</span>
                    </button>
                  </div>
                </div>

                {/* Target URL Input */}
                <div className="sidebar-group">
                  <label className="sidebar-field-label">
                    <Globe size={11} />
                    <span>Target Web Address</span>
                  </label>
                  <div className="sidebar-input-wrap">
                    <input
                      type="url"
                      className="sidebar-text-input mono"
                      value={targetUrl}
                      onChange={e => setTargetUrl(e.target.value)}
                      placeholder="http://localhost:5174 or https://..."
                    />
                  </div>
                </div>

                {/* App Description & Scenario */}
                <div className="sidebar-group">
                  <label className="sidebar-field-label">
                    <FileText size={11} />
                    <span>App Description & Journeys</span>
                  </label>
                  <textarea
                    className="sidebar-textarea"
                    rows={4}
                    value={appDesc}
                    onChange={e => setAppDesc(e.target.value)}
                    placeholder="Describe key flows to test (e.g. product catalog, cart item removal, coupon discounts, checkout inputs)..."
                  />
                </div>

                {/* Session Launch Controls */}
                <div className="sidebar-group">
                  <span className="sidebar-group-title">
                    <Play size={12} />
                    <span>Run QA Automation</span>
                  </span>

                  <div className="sidebar-session-box">
                    {!isRunning ? (
                      <button
                        id="start-qa-session"
                        className="btn btn-primary w-full"
                        onClick={startSession}
                        disabled={!targetUrl}
                      >
                        <Play size={13} />
                        <span>Start QA Session</span>
                      </button>
                    ) : (
                      <button id="stop-btn" className="btn btn-danger w-full" onClick={stopSession}>
                        <Square size={13} />
                        <span>Stop Session</span>
                      </button>
                    )}

                    <div className="sidebar-controls-subrow">
                      <button
                        className="btn btn-secondary flex-1"
                        title="Reset to default benchmark state"
                        onClick={resetStudio}
                        disabled={isRunning}
                      >
                        <RotateCcw size={12} />
                        <span>Reset</span>
                      </button>

                      <div className="connection-chip">
                        <div className={`status-indicator ${wsConnected ? 'connected' : 'offline'}`} />
                        <span>{wsConnected ? 'Connected' : 'Offline'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeSidebarView === 'methods' && (
              <>
                <div className="sidebar-group">
                  <span className="sidebar-group-title">
                    <Sliders size={12} />
                    <span>Testing Strategy</span>
                  </span>
                  <span className="sidebar-group-subtitle">
                    Select the test categories our autonomous agents should generate.
                  </span>

                  <div className="testing-methods-list">
                    <label className="method-checkbox-row">
                      <input
                        type="checkbox"
                        checked={testMethods.happyPath}
                        onChange={e => setTestMethods(m => ({ ...m, happyPath: e.target.checked }))}
                      />
                      <CheckCircle2 size={12} className="method-row-icon text-green" />
                      <div className="method-text">
                        <span className="method-name">Happy-Path Journeys</span>
                        <span className="method-desc">Core end-to-end user paths</span>
                      </div>
                    </label>

                    <label className="method-checkbox-row">
                      <input
                        type="checkbox"
                        checked={testMethods.boundary}
                        onChange={e => setTestMethods(m => ({ ...m, boundary: e.target.checked }))}
                      />
                      <Sliders size={12} className="method-row-icon text-amber" />
                      <div className="method-text">
                        <span className="method-name">Boundary & Field Limits</span>
                        <span className="method-desc">Negative numbers, empty fields</span>
                      </div>
                    </label>

                    <label className="method-checkbox-row">
                      <input
                        type="checkbox"
                        checked={testMethods.edgeCases}
                        onChange={e => setTestMethods(m => ({ ...m, edgeCases: e.target.checked }))}
                      />
                      <Zap size={12} className="method-row-icon text-purple" />
                      <div className="method-text">
                        <span className="method-name">Edge Cases & Concurrency</span>
                        <span className="method-desc">Multi-click, coupon removal math</span>
                      </div>
                    </label>

                    <label className="method-checkbox-row">
                      <input
                        type="checkbox"
                        checked={testMethods.errorStates}
                        onChange={e => setTestMethods(m => ({ ...m, errorStates: e.target.checked }))}
                      />
                      <ShieldAlert size={12} className="method-row-icon text-red" />
                      <div className="method-text">
                        <span className="method-name">Error States & Validation</span>
                        <span className="method-desc">Invalid data, server 4xx/5xx</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="sidebar-group">
                  <span className="sidebar-group-title">
                    <Clock size={12} />
                    <span>Test Suite Scope</span>
                  </span>
                  <div className="testing-scope-selector">
                    <button
                      className={`scope-pill ${testScope === 'comprehensive' ? 'active' : ''}`}
                      onClick={() => setTestScope('comprehensive')}
                    >
                      Full Suite (8-10)
                    </button>
                    <button
                      className={`scope-pill ${testScope === 'smoke' ? 'active' : ''}`}
                      onClick={() => setTestScope('smoke')}
                    >
                      Smoke Test (4)
                    </button>
                  </div>
                </div>
                <div className="sidebar-group">
                  {!isRunning ? (
                    <button
                      id="start-qa-session-methods"
                      className="btn btn-primary w-full"
                      onClick={startSession}
                      disabled={!targetUrl}
                    >
                      <Play size={13} />
                      <span>Start QA Session</span>
                    </button>
                  ) : (
                    <button className="btn btn-danger w-full" onClick={stopSession}>
                      <Square size={13} />
                      <span>Stop Session</span>
                    </button>
                  )}
                </div>
              </>
            )}

            {activeSidebarView === 'sitemap' && (
              <>
                <div className="sidebar-group">
                  <span className="sidebar-group-title">
                    <Layers size={12} />
                    <span>Discovered Routes ({stateGraph.length})</span>
                  </span>
                  <span className="sidebar-group-subtitle">
                    Cartographer crawls and maps the application state graph.
                  </span>

                  <div className="sitemap-node-list">
                    {stateGraph.length === 0 ? (
                      <div className="empty-panel-state-mini">
                        <Layers size={18} className="text-muted" />
                        <span>No pages mapped yet. Run a session to discover routes.</span>
                      </div>
                    ) : (
                      stateGraph.map(node => (
                        <div
                          key={node.id}
                          className="sitemap-panel-card"
                          onClick={() => setStudioTab('sitemap')}
                        >
                          <div className="sitemap-card-top">
                            <span className="node-badge mono">{node.id}</span>
                            <span className="node-title">{node.title}</span>
                          </div>
                          <span className="node-url mono">{node.url}</span>
                          <div className="node-components-pills">
                            {node.components.map(c => (
                              <span key={c} className="node-component-pill">{c}</span>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}

            {activeSidebarView === 'search' && (
              <>
                <div className="sidebar-group">
                  <span className="sidebar-group-title">
                    <Search size={12} />
                    <span>Search Workspace</span>
                  </span>
                  <div className="sidebar-input-wrap">
                    <input
                      type="text"
                      className="sidebar-text-input"
                      placeholder="Search tests, bugs, logs..."
                      value={sidebarSearch}
                      onChange={e => {
                        setSidebarSearch(e.target.value)
                        setLogSearchQuery(e.target.value)
                      }}
                      autoFocus
                    />
                    {sidebarSearch && (
                      <button
                        className="btn-icon-subtle"
                        onClick={() => {
                          setSidebarSearch('')
                          setLogSearchQuery('')
                        }}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="sidebar-group">
                  <span className="sidebar-group-title">Matching Items</span>
                  <div className="search-stats-grid">
                    <button
                      className="search-stat-card"
                      onClick={() => setStudioTab('tests')}
                    >
                      <span className="stat-label">Tests</span>
                      <span className="stat-val mono">
                        {testCases.filter(t => !sidebarSearch || t.title.toLowerCase().includes(sidebarSearch.toLowerCase())).length}
                      </span>
                    </button>
                    <button
                      className="search-stat-card"
                      onClick={() => setStudioTab('bugs')}
                    >
                      <span className="stat-label">Bugs</span>
                      <span className="stat-val mono">
                        {bugs.filter(b => !sidebarSearch || b.title.toLowerCase().includes(sidebarSearch.toLowerCase())).length}
                      </span>
                    </button>
                    <button
                      className="search-stat-card"
                      onClick={() => setStudioTab('logs')}
                    >
                      <span className="stat-label">Logs</span>
                      <span className="stat-val mono">
                        {filteredLogs.length}
                      </span>
                    </button>
                  </div>
                </div>
              </>
            )}

            {activeSidebarView === 'help' && (
              <>
                <div className="sidebar-group">
                  <span className="sidebar-group-title">
                    <BookOpen size={12} />
                    <span>Help & Quick Reference</span>
                  </span>
                  <div className="help-panel-card">
                    <h4 className="help-card-title">Autonomous QA Workflow</h4>
                    <p className="help-card-desc">
                      The studio uses a 5-agent pipeline: Cartographer maps pages, Planner derives strategies, Executor runs Playwright actions, Critic confirms reproducibility, and Synthesizer generates exportable test scripts.
                    </p>
                  </div>

                  <div className="help-panel-card">
                    <h4 className="help-card-title">Keyboard Shortcuts</h4>
                    <div className="shortcut-row">
                      <span className="shortcut-key mono">Ctrl + B</span>
                      <span className="shortcut-action">Toggle Side Panel</span>
                    </div>
                  </div>

                  <button
                    className="btn btn-secondary w-full"
                    onClick={() => setShowHelpModal(true)}
                  >
                    <HelpCircle size={13} />
                    <span>Open Full Help Modal</span>
                  </button>
                </div>
              </>
            )}

            {activeSidebarView === 'settings' && (
              <>
                <div className="sidebar-group">
                  <span className="sidebar-group-title">
                    <Settings size={12} />
                    <span>Engine Settings</span>
                  </span>
                  <div className="settings-preview-stack">
                    <div className="settings-preview-item">
                      <span className="settings-preview-key">Browser</span>
                      <span className="settings-preview-val mono">Chromium</span>
                    </div>
                    <div className="settings-preview-item">
                      <span className="settings-preview-key">Viewport</span>
                      <span className="settings-preview-val mono">1280x800</span>
                    </div>
                    <div className="settings-preview-item">
                      <span className="settings-preview-key">Backend Port</span>
                      <span className="settings-preview-val mono">:{AGENT_PORT}</span>
                    </div>
                    <div className="settings-preview-item">
                      <span className="settings-preview-key">Model</span>
                      <span className="settings-preview-val mono">Gemini 2.0 Flash</span>
                    </div>
                  </div>

                  <button
                    className="btn btn-secondary w-full"
                    onClick={() => setShowSettingsModal(true)}
                  >
                    <Sliders size={13} />
                    <span>Open Detailed Settings</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* ── Central Studio Workspace (Right of Sidebar) ── */}
        <div className="studio-workspace-area">
          {/* Top Pipeline Breadcrumb: 5-Agent Mission Track */}
          <div className="pipeline-track">
            {PIPELINE_STEPS.map((step, idx) => {
              const state = getStepState(step)
              return (
                <div key={step.agent} className="pipeline-item-wrapper">
                  <div className={`pipeline-step ${state}`}>
                    <div className="step-badge">
                      {state === 'done' ? (
                        <Check size={11} strokeWidth={2.5} />
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>
                    <div className="step-content">
                      <span className="step-name">{step.label}</span>
                      <span className="step-desc">
                        {state === 'active' ? 'Active Execution' : state === 'done' ? 'Completed' : step.desc}
                      </span>
                    </div>
                  </div>
                  {idx < PIPELINE_STEPS.length - 1 && <div className="pipeline-connector" />}
                </div>
              )
            })}

            {/* Global Pipeline Telemetry */}
            <div className="pipeline-metrics">
              <div className="metric-pill">
                <span className="metric-label">Tests Passed:</span>
                <span className="metric-val text-green">
                  {testCases.filter(t => t.status === 'passed').length}/{testCases.length}
                </span>
              </div>
              <div className="metric-pill">
                <span className="metric-label">Verified Bugs:</span>
                <span className={`metric-val ${bugs.length > 0 ? 'text-red' : 'text-muted'}`}>
                  {bugs.length}
                </span>
              </div>
              <div className="metric-pill">
                <span className="metric-label">Specs Generated:</span>
                <span className="metric-val text-blue">
                  {generatedTests.length}
                </span>
              </div>
            </div>
          </div>

          {/* Main Studio Split Pane */}
          <main className="studio-split-pane">
            {/* ── Left Column: Live Browser Viewport & Action HUD ── */}
            <section className="browser-canvas-section">
              <div className="canvas-header">
                <div className="window-dots">
                  <span className="dot dot-1" />
                  <span className="dot dot-2" />
                  <span className="dot dot-3" />
                </div>

                <div className="canvas-address-bar">
                  <Globe size={12} className="addr-icon" />
                  <span className="addr-text mono">{session?.targetUrl ?? targetUrl}</span>
                </div>

                <div className="canvas-header-actions">
                  <a
                    href={session?.targetUrl ?? targetUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-icon"
                    title="Open in new window"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>

              {/* Active Action HUD Bar */}
              <div className="action-hud-bar">
                <div className="hud-agent-chip">
                  <span className={`hud-indicator ${isRunning ? 'active' : ''}`} />
                  <span className="hud-agent-name">{isRunning ? currentAgent.toUpperCase() : 'STANDBY'}</span>
                </div>
                <div className="hud-message">
                  {latestLog ? (
                    <span>
                      <strong className="hud-msg-type">{latestLog.type.toUpperCase()}:</strong> {latestLog.message}
                    </span>
                  ) : (
                    <span>Standing by. Click Start QA Session to begin multi-agent execution.</span>
                  )}
                </div>
              </div>

              {/* Target Web Viewport Frame */}
              <div className="browser-frame-container">
                <iframe
                  className="browser-viewport-iframe"
                  src={session?.targetUrl ?? targetUrl}
                  title="Target App Viewport"
                  sandbox="allow-same-origin allow-scripts allow-forms"
                />
              </div>

              {/* Bottom Viewport Info Bar */}
              <div className="canvas-footer-bar">
                <span className="footer-meta">Viewport: 1280 x 800</span>
                <span className="footer-meta">Driver: Chromium Headless</span>
                <span className="footer-meta">Target: {session?.targetUrl ?? targetUrl}</span>
              </div>
            </section>

            {/* ── Right Column: Studio Tabbed Developer Panel ── */}
            <section className="studio-panel-section">
              {/* Tab Navigation Headers */}
              <nav className="studio-tabs-nav">
                <button
                  id="tab-tests"
                  className={`studio-tab ${studioTab === 'tests' ? 'active' : ''}`}
                  onClick={() => setStudioTab('tests')}
                >
                  <ListChecks size={13} />
                  <span>Tests</span>
                  <span className="tab-counter">{testCases.length}</span>
                </button>

                <button
                  id="tab-bugs"
                  className={`studio-tab ${studioTab === 'bugs' ? 'active' : ''}`}
                  onClick={() => setStudioTab('bugs')}
                >
                  <Bug size={13} />
                  <span>Verified Bugs</span>
                  {bugs.length > 0 && <span className="tab-counter alert">{bugs.length}</span>}
                </button>

                <button
                  id="tab-code"
                  className={`studio-tab ${studioTab === 'code' ? 'active' : ''}`}
                  onClick={() => setStudioTab('code')}
                >
                  <FileCode2 size={13} />
                  <span>Playwright Code</span>
                  <span className="tab-counter">{generatedTests.length}</span>
                </button>

                <button
                  id="tab-sitemap"
                  className={`studio-tab ${studioTab === 'sitemap' ? 'active' : ''}`}
                  onClick={() => setStudioTab('sitemap')}
                >
                  <Layers size={13} />
                  <span>Site Map</span>
                  <span className="tab-counter">{stateGraph.length}</span>
                </button>

                <button
                  id="tab-logs"
                  className={`studio-tab ${studioTab === 'logs' ? 'active' : ''}`}
                  onClick={() => setStudioTab('logs')}
                >
                  <Terminal size={13} />
                  <span>Logs</span>
                  <span className="tab-counter">{logs.length}</span>
                </button>
              </nav>

              {/* Tab 1: Test Cases with Accordion Step Inspector */}
              {studioTab === 'tests' && (
                <div className="tab-content-wrapper">
                  <div className="panel-toolbar">
                    <span className="toolbar-title">Generated Test Cases ({testCases.length})</span>
                    <span className="toolbar-hint">Click test to view step-by-step actions and execution timings</span>
                  </div>

                  {testCases.length === 0 ? (
                    <div className="empty-panel-state">
                      <Clock size={32} />
                      <p>No test cases queued</p>
                      <small>Start a session to generate and execute test cases</small>
                    </div>
                  ) : (
                    <div className="test-items-list">
                      {testCases.map((tc) => {
                        const isExpanded = expandedTestId === tc.id
                        return (
                          <div key={tc.id} className={`test-accordion-card ${tc.status}`}>
                            <div
                              className="test-card-header"
                              onClick={() => setExpandedTestId(isExpanded ? null : tc.id)}
                            >
                              <div className="test-header-left">
                                <span className={`status-icon-badge ${tc.status}`}>
                                  {tc.status === 'passed' && <CheckCircle2 size={13} />}
                                  {tc.status === 'failed' && <XCircle size={13} />}
                                  {tc.status === 'running' && <Clock size={13} />}
                                  {tc.status === 'pending' && <Clock size={13} />}
                                </span>
                                <span className="test-title-text">{tc.title}</span>
                              </div>

                              <div className="test-header-right">
                                <span className={`category-tag cat-${tc.category}`}>
                                  {tc.category}
                                </span>
                                <span className="priority-tag">{tc.priority.toUpperCase()}</span>
                                {tc.durationMs && (
                                  <span className="duration-tag">{formatMs(tc.durationMs)}</span>
                                )}
                                <ChevronDown size={14} className={`accordion-chevron ${isExpanded ? 'rotate-180' : ''}`} />
                              </div>
                            </div>

                            {/* Step Details Accordion */}
                            {isExpanded && tc.steps && tc.steps.length > 0 && (
                              <div className="test-steps-container">
                                <div className="steps-header">
                                  <span>Action Steps ({tc.steps.length})</span>
                                  <span>Target & Expected Outcome</span>
                                </div>
                                {tc.steps.map((step) => (
                                  <div key={step.index} className={`step-row ${step.passed === false ? 'step-failed' : 'step-passed'}`}>
                                    <div className="step-idx">
                                      {step.passed === false ? <XCircle size={12} className="text-red" /> : <Check size={12} className="text-green" />}
                                      <span>{step.index}</span>
                                    </div>
                                    <div className="step-details">
                                      <div className="step-desc-line">
                                        <span className="step-action-tag">{step.action.type.toUpperCase()}</span>
                                        <span className="step-action-desc">{step.description}</span>
                                        {step.durationMs && <span className="step-time">{step.durationMs}ms</span>}
                                      </div>
                                      <div className="step-outcomes">
                                        <div className="outcome-expected">
                                          <span className="outcome-label">Expected:</span> {step.expectedOutcome}
                                        </div>
                                        {step.actualOutcome && (
                                          <div className={`outcome-actual ${step.passed === false ? 'text-red' : ''}`}>
                                            <span className="outcome-label">Actual:</span> {step.actualOutcome}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Verified Bug Reports & Diagnostic Tickets */}
              {studioTab === 'bugs' && (
                <div className="tab-content-wrapper bugs-view-split">
                  {/* Left Column of Bugs tab: Bug list */}
                  <div className="bugs-sidebar">
                    <div className="panel-toolbar">
                      <span className="toolbar-title">Verified Bugs ({filteredBugs.length})</span>
                      <div className="severity-filter-bar">
                        {['all', 'critical', 'high', 'medium'].map(sev => (
                          <button
                            key={sev}
                            className={`filter-btn ${bugFilterSeverity === sev ? 'active' : ''}`}
                            onClick={() => setBugFilterSeverity(sev)}
                          >
                            {sev.toUpperCase()}
                          </button>
                        ))}
                      </div>
                    </div>

                    {filteredBugs.length === 0 ? (
                      <div className="empty-panel-state">
                        <CheckCircle2 size={32} />
                        <p>No bugs matching filter</p>
                        <small>The Bug Critic verifies all potential failures in a clean sandbox before filing</small>
                      </div>
                    ) : (
                      <div className="bug-cards-list">
                        {filteredBugs.map(bug => (
                          <div
                            key={bug.id}
                            className={`bug-summary-card ${selectedBug?.id === bug.id ? 'active' : ''}`}
                            onClick={() => setSelectedBug(bug)}
                          >
                            <div className="bug-card-top">
                              <span className={`severity-badge sev-${bug.severity}`}>{bug.severity.toUpperCase()}</span>
                              <span className="bug-id-tag">{bug.id}</span>
                            </div>
                            <div className="bug-title-line">{bug.title}</div>
                            <div className="bug-card-bottom">
                              <span className="bug-category-text">{bug.category}</span>
                              <span className="repro-status verified">REPRODUCED</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Right Column of Bugs tab: Full Bug Ticket Inspector */}
                  <div className="bug-inspector-detail">
                    {selectedBug ? (
                      <div className="bug-ticket-body">
                        <div className="ticket-header">
                          <div className="ticket-title-area">
                            <div className="ticket-badge-row">
                              <span className={`severity-badge sev-${selectedBug.severity}`}>
                                {selectedBug.severity.toUpperCase()} PRIORITY
                              </span>
                              <span className="ticket-meta-pill">Category: {selectedBug.category}</span>
                              <span className="ticket-meta-pill">Sandbox Verified: YES</span>
                            </div>
                            <h2 className="ticket-title">{selectedBug.title}</h2>
                          </div>
                          <button
                            className="btn btn-secondary"
                            onClick={() => copyBugMarkdown(selectedBug)}
                          >
                            {copiedBugId === selectedBug.id ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copiedBugId === selectedBug.id ? 'Copied MD' : 'Copy Ticket'}</span>
                          </button>
                        </div>

                        {/* Expected vs Actual Behavior */}
                        <div className="ticket-section">
                          <div className="behavior-comparison-grid">
                            <div className="behavior-box expected">
                              <span className="box-title">Expected Behavior</span>
                              <p>{selectedBug.expectedBehavior}</p>
                            </div>
                            <div className="behavior-box actual">
                              <span className="box-title">Observed Defect</span>
                              <p>{selectedBug.actualBehavior}</p>
                            </div>
                          </div>
                        </div>

                        {/* Reproduction Steps */}
                        <div className="ticket-section">
                          <span className="section-heading">Reproduction Steps</span>
                          <div className="reproduction-steps-list">
                            {selectedBug.reproductionSteps.map(step => (
                              <div key={step.index} className="repro-step-item">
                                <span className="repro-num">{step.index}</span>
                                <span className="repro-text">{step.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Console & Network Logs */}
                        {selectedBug.consoleErrors.length > 0 && (
                          <div className="ticket-section">
                            <span className="section-heading">Console Error Stack</span>
                            <pre className="terminal-code-block error">
                              {selectedBug.consoleErrors.join('\n')}
                            </pre>
                          </div>
                        )}

                        {selectedBug.networkErrors.length > 0 && (
                          <div className="ticket-section">
                            <span className="section-heading">Network Traces</span>
                            <div className="network-traces-list">
                              {selectedBug.networkErrors.map((net, i) => (
                                <div key={i} className="network-trace-row">
                                  <span className="net-method">{net.method}</span>
                                  <span className="net-url mono">{net.url}</span>
                                  <span className={`net-status ${net.status >= 400 ? 'status-err' : ''}`}>{net.status}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {selectedBug.screenshotPath && (
                          <div className="ticket-section">
                            <span className="section-heading">Defect Screenshot Evidence</span>
                            <div className="defect-screenshot-container">
                              <img src={selectedBug.screenshotPath} alt="Bug defect evidence" />
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="empty-panel-state">
                        <AlertTriangle size={32} />
                        <p>Select a bug ticket to inspect reproduction details</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Tab 3: Synthesized Playwright TypeScript Code */}
              {studioTab === 'code' && (
                <div className="tab-content-wrapper code-studio-layout">
                  <div className="code-file-tabs">
                    {generatedTests.map(t => (
                      <button
                        key={t.id}
                        className={`file-tab-btn ${selectedTest?.id === t.id ? 'active' : ''}`}
                        onClick={() => setSelectedTest(t)}
                      >
                        <Code2 size={12} />
                        <span>{t.filename}</span>
                      </button>
                    ))}
                  </div>

                  {selectedTest ? (
                    <div className="code-viewer-container">
                      <div className="code-viewer-toolbar">
                        <span className="code-file-title mono">{selectedTest.filename}</span>
                        <div className="code-toolbar-actions">
                          <button className="btn btn-secondary" onClick={() => copyCode(selectedTest.code)}>
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copied ? 'Copied' : 'Copy Code'}</span>
                          </button>
                          <button className="btn btn-secondary" onClick={() => downloadCode(selectedTest.filename, selectedTest.code)}>
                            <Download size={12} />
                            <span>Download .spec.ts</span>
                          </button>
                        </div>
                      </div>

                      <div className="code-content-scroller">
                        <pre className="code-pre">
                          {selectedTest.code.split('\n').map((line, i) => (
                            <div key={i} className="code-line-row">
                              <span className="line-num">{i + 1}</span>
                              <span className="line-code">{renderCodeSyntax(line)}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                    </div>
                  ) : (
                    <div className="empty-panel-state">
                      <FileCode2 size={32} />
                      <p>No Playwright test files synthesized yet</p>
                      <small>Passed test cases are automatically compiled into self-contained Playwright specs</small>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 4: Discovered Site Map Topology */}
              {studioTab === 'sitemap' && (
                <div className="tab-content-wrapper">
                  <div className="panel-toolbar">
                    <span className="toolbar-title">Explored Route Topology ({stateGraph.length} pages mapped)</span>
                    <span className="toolbar-hint">Discovered by Cartographer agent accessibility & route analysis</span>
                  </div>

                  {stateGraph.length === 0 ? (
                    <div className="empty-panel-state">
                      <Layers size={32} />
                      <p>No routes discovered yet</p>
                      <small>The Cartographer agent maps route topology once a QA session starts</small>
                    </div>
                  ) : (
                    <div className="sitemap-grid">
                      {stateGraph.map((node, i) => (
                        <div key={node.id} className="sitemap-node-card">
                          <div className="node-card-header">
                            <span className="node-step-index">{i + 1}</span>
                            <div className="node-title-group">
                              <span className="node-title">{node.title}</span>
                              <span className="node-url mono">{node.url}</span>
                            </div>
                          </div>
                          <div className="node-components-group">
                            <span className="components-label">Detected UI Components:</span>
                            <div className="component-tags-list">
                              {node.components.map((comp, idx) => (
                                <span key={idx} className="comp-tag">{comp}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 5: Real-time Multi-Agent Execution Logs */}
              {studioTab === 'logs' && (
                <div className="tab-content-wrapper logs-view-layout">
                  {/* Log filter bar */}
                  <div className="logs-control-bar">
                    <div className="search-wrap">
                      <Search size={12} className="search-icon" />
                      <input
                        type="text"
                        className="search-input"
                        placeholder="Search execution logs..."
                        value={logSearchQuery}
                        onChange={e => setLogSearchQuery(e.target.value)}
                      />
                    </div>

                    <div className="agent-filter-pills">
                      <span className="filter-label"><Filter size={11} /> Agent:</span>
                      {['all', 'cartographer', 'planner', 'executor', 'critic', 'synthesizer'].map(agent => (
                        <button
                          key={agent}
                          className={`pill-btn ${logFilterAgent === agent ? 'active' : ''}`}
                          onClick={() => setLogFilterAgent(agent)}
                        >
                          {agent.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Logs Stream List */}
                  <div className="logs-scroller">
                    {filteredLogs.length === 0 ? (
                      <div className="empty-panel-state">
                        <Terminal size={32} />
                        <p>No execution logs yet</p>
                        <small>Agent thoughts, actions, and observations will stream here in real time</small>
                      </div>
                    ) : (
                      filteredLogs.map((log, i) => (
                        <div key={i} className={`log-entry-row ${log.type}`}>
                          <span className="log-col-time">{formatTime(log.timestamp)}</span>
                          <span className={`log-col-type type-${log.type}`}>{log.type.toUpperCase()}</span>
                          <span className="log-col-agent">{log.agent.toUpperCase()}</span>
                          <span className="log-col-message">{log.message}</span>
                        </div>
                      ))
                    )}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              )}
            </section>
          </main>

          {/* ── Status Bar: Bottom Telemetry ── */}
          <footer className="mission-statusbar">
            <div className="statusbar-left">
              <div className="status-dot-wrap">
                <span className={`status-dot ${status === 'done' ? 'green' : isRunning ? 'running' : status === 'error' ? 'red' : 'idle'}`} />
                <span className="status-name">STATUS: {status.toUpperCase()}</span>
              </div>
              <span className="statusbar-divider">|</span>
              <span className="statusbar-info">Pages Mapped: {stateGraph.length}</span>
              <span className="statusbar-divider">|</span>
              <span className="statusbar-info">Tests: {testCases.filter(t => t.status === 'passed').length} Passed / {testCases.length} Total</span>
              <span className="statusbar-divider">|</span>
              <span className="statusbar-info">Bugs Verified: {bugs.length}</span>
            </div>

            <div className="statusbar-right">
              <span className="engine-info">Engine: Chromium Headless · Google Gemini 2.0 · Playwright</span>
            </div>
          </footer>
        </div>
      </div>

      {/* ── Help & Documentation Modal ── */}
      {showHelpModal && (
        <div className="modal-backdrop" onClick={() => setShowHelpModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Autonomous AI QA Engineer Guide</span>
              <button className="modal-close-btn" onClick={() => setShowHelpModal(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div className="help-section">
                <h4>5-Agent Autonomous Pipeline:</h4>
                <p>1. <strong>Cartographer:</strong> Explores the target web app and constructs a state topology of routes, inputs, and components.</p>
                <p>2. <strong>Planner:</strong> Generates structured, categorized test cases (happy path, boundary, edge cases, error recovery).</p>
                <p>3. <strong>Executor:</strong> Runs real Playwright browser sessions in headless Chromium, recording network and console errors.</p>
                <p>4. <strong>Critic:</strong> Re-runs failures in an isolated sandbox browser to confirm reproducibility and eliminate false positives.</p>
                <p>5. <strong>Synthesizer:</strong> Compiles verified tests into idiomatic Playwright TypeScript <code>.spec.ts</code> test scripts.</p>
              </div>
              <div className="help-section">
                <h4>Testing Target:</h4>
                <p>Use the left sidebar to select <strong>BuggyCart Store</strong> (local benchmark app on port 5174 with 6 planted bugs) or enter any external web URL.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Engine Settings Modal ── */}
      {showSettingsModal && (
        <div className="modal-backdrop" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Engine Configuration & Settings</span>
              <button className="modal-close-btn" onClick={() => setShowSettingsModal(false)}>
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div className="settings-field">
                <label className="settings-label">Playwright Browser Engine</label>
                <input className="settings-input mono" readOnly value="Chromium (Headless)" />
              </div>
              <div className="settings-field">
                <label className="settings-label">Viewport Dimensions</label>
                <input className="settings-input mono" readOnly value="1280 x 800 (Desktop)" />
              </div>
              <div className="settings-field">
                <label className="settings-label">Backend WebSocket Address</label>
                <input className="settings-input mono" readOnly value={`ws://localhost:${AGENT_PORT}`} />
              </div>
              <div className="settings-field">
                <label className="settings-label">Intelligence LLM Engine</label>
                <input className="settings-input mono" readOnly value="Google Gemini 2.0 Flash" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Clean Code Syntax Renderer ─────────────────────────────────────────────

function renderCodeSyntax(line: string) {
  const keywords = /\b(import|from|export|const|let|async|await|return|test|expect|describe|if|else|function)\b/g
  const strings = /('.*?'|".*?"|`.*?`)/g
  const comments = /(\/\/.*$)/

  if (comments.test(line)) {
    return <span className="syntax-comment">{line}</span>
  }

  return (
    <span
      dangerouslySetInnerHTML={{
        __html: line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(keywords, '<span class="syntax-keyword">$1</span>')
          .replace(strings, '<span class="syntax-string">$1</span>')
      }}
    />
  )
}
