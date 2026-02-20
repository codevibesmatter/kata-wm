/**
 * Mock Session State Manager
 *
 * Creates isolated test sessions with controlled state for testing
 * hooks, workflow transitions, and session management.
 */

import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { SessionState } from '../state/schema'

export interface MockSessionOptions {
  /** Base directory for test sessions (defaults to /tmp/claude-test-sessions) */
  baseDir?: string
  /** Session ID (auto-generated if not provided) */
  sessionId?: string
  /** Initial session state */
  initialState?: Partial<SessionState>
}

export interface MockSession {
  /** Session ID */
  sessionId: string
  /** Full path to session directory */
  sessionDir: string
  /** Full path to state.json */
  statePath: string
  /** Read current state */
  getState(): Promise<SessionState>
  /** Update state */
  setState(state: Partial<SessionState>): Promise<void>
  /** Create a mock bead file for testing */
  createMockBead(beadId: string, status: 'open' | 'closed'): Promise<void>
  /** Cleanup - remove all test files */
  cleanup(): Promise<void>
}

const DEFAULT_STATE: Partial<SessionState> = {
  sessionType: 'default',
  currentMode: undefined,
  previousMode: undefined,
  modeHistory: [],
  modeState: {},
  workflowId: undefined,
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  todosWritten: false,
  completedPhases: [],
}

/**
 * Create a mock session for testing
 */
export async function createMockSession(options: MockSessionOptions = {}): Promise<MockSession> {
  const baseDir = options.baseDir ?? '/tmp/claude-test-sessions'
  const sessionId = options.sessionId ?? generateSessionId()
  const sessionDir = join(baseDir, sessionId)
  const statePath = join(sessionDir, 'state.json')

  // Create session directory
  await mkdir(sessionDir, { recursive: true })

  // Create initial state
  const initialState = {
    ...DEFAULT_STATE,
    sessionId,
    ...options.initialState,
  } as SessionState

  await writeFile(statePath, JSON.stringify(initialState, null, 2))

  // Create mock .claude directories if needed
  const claudeDir = join(baseDir, '.claude')
  const sessionsDir = join(claudeDir, 'sessions', sessionId)
  await mkdir(sessionsDir, { recursive: true })
  await writeFile(join(sessionsDir, 'state.json'), JSON.stringify(initialState, null, 2))

  // Create registry.jsonl with session_started event (modern lookup)
  const registryPath = join(claudeDir, 'sessions', 'registry.jsonl')
  const registryEntry = JSON.stringify({
    event: 'session_started',
    sessionId,
    timestamp: new Date().toISOString(),
  })
  await writeFile(registryPath, `${registryEntry}\n`)

  // Helper to read current state
  const getState = async (): Promise<SessionState> => {
    const content = await readFile(statePath, 'utf-8')
    return JSON.parse(content)
  }

  return {
    sessionId,
    sessionDir,
    statePath,

    getState,

    async setState(partial: Partial<SessionState>): Promise<void> {
      const current = await getState()
      const updated = { ...current, ...partial, updatedAt: new Date().toISOString() }
      await writeFile(statePath, JSON.stringify(updated, null, 2))
      // Also update in .claude/sessions
      await writeFile(join(sessionsDir, 'state.json'), JSON.stringify(updated, null, 2))
    },

    async createMockBead(beadId: string, status: 'open' | 'closed'): Promise<void> {
      const beadsDir = join(baseDir, '.beads', 'issues')
      await mkdir(beadsDir, { recursive: true })
      const beadFile = join(beadsDir, `${beadId}.md`)
      const beadContent = `---
id: ${beadId}
title: "Test Bead ${beadId}"
status: ${status}
labels: [test, phase]
---

Test bead content
`
      await writeFile(beadFile, beadContent)
    },

    async cleanup(): Promise<void> {
      await rm(baseDir, { recursive: true, force: true })
    },
  }
}

/**
 * Generate a random session ID
 */
function generateSessionId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Pre-built session state configurations for common test scenarios
 */
export const SessionFixtures: {
  fresh(): Partial<SessionState>
  planningMode(): Partial<SessionState>
  implementationMode(): Partial<SessionState>
  linkedToIssue(issueNumber: number): Partial<SessionState>
  withTodosWritten(): Partial<SessionState>
  completedWorkflow(): Partial<SessionState>
} = {
  /** Fresh session with no mode active */
  fresh(): Partial<SessionState> {
    return {
      sessionType: 'default',
      currentMode: undefined,
      modeHistory: [],
    }
  },

  /** Session in planning mode */
  planningMode(): Partial<SessionState> {
    return {
      sessionType: 'planning',
      currentMode: 'planning',
      modeHistory: [{ mode: 'planning', enteredAt: new Date().toISOString() }],
      modeState: {
        planning: { status: 'active', currentPhase: 'p0' },
      },
      workflowId: 'PL-test-0115',
    }
  },

  /** Session in implementation mode */
  implementationMode(): Partial<SessionState> {
    return {
      sessionType: 'implementation',
      currentMode: 'implementation',
      modeHistory: [{ mode: 'implementation', enteredAt: new Date().toISOString() }],
      modeState: {
        implementation: { status: 'active', currentPhase: 'p0' },
      },
      workflowId: 'IM-test-0115',
    }
  },

  /** Session linked to a GitHub issue */
  linkedToIssue(issueNumber: number): Partial<SessionState> {
    return {
      sessionType: 'planning',
      currentMode: 'planning',
      issueNumber,
      issueTitle: `Test Issue #${issueNumber}`,
      issueType: 'feature',
      workflowId: `GH#${issueNumber}`,
    }
  },

  /** Session with todos written */
  withTodosWritten(): Partial<SessionState> {
    return {
      todosWritten: true,
    }
  },

  /** Session in QA mode after completing a workflow */
  completedWorkflow(): Partial<SessionState> {
    return {
      sessionType: 'qa',
      currentMode: 'qa',
      previousMode: 'implementation',
      modeHistory: [
        { mode: 'implementation', enteredAt: new Date(Date.now() - 3600000).toISOString() },
        { mode: 'qa', enteredAt: new Date().toISOString() },
      ],
      modeState: {
        implementation: { status: 'completed', exitedAt: new Date().toISOString() },
        qa: { status: 'active' },
      },
    }
  },
}
