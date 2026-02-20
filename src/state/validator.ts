import { type SessionState, SessionStateSchema } from './schema.js'

/**
 * Validate session state against schema
 * @param state - State to validate
 * @returns Validation result with success flag and errors
 */
export function validateState(state: unknown): {
  success: boolean
  errors?: string[]
  data?: SessionState
} {
  const result = SessionStateSchema.safeParse(state)

  if (result.success) {
    return {
      success: true,
      data: result.data,
    }
  }

  return {
    success: false,
    errors: result.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`),
  }
}

/**
 * Check if state has required fields for a given mode
 * @param state - Session state
 * @param mode - Mode name to check
 * @returns true if state is valid for mode
 */
export function isValidForMode(state: SessionState, mode: string): boolean {
  // Basic checks
  if (state.currentMode !== mode) {
    return false
  }

  if (!state.workflowId) {
    return false
  }

  if (!state.sessionType) {
    return false
  }

  return true
}

/**
 * Check if a phase is completed
 * @param state - Session state
 * @param phase - Phase ID to check
 * @returns true if phase is in completedPhases
 */
export function isPhaseCompleted(state: SessionState, phase: string): boolean {
  return state.completedPhases.includes(phase)
}

/**
 * Check if all phases are completed for current mode
 * @param state - Session state
 * @returns true if all phases completed
 */
export function areAllPhasesCompleted(state: SessionState): boolean {
  if (!state.phases || state.phases.length === 0) {
    return false
  }

  return state.phases.every((phase) => state.completedPhases.includes(phase))
}
