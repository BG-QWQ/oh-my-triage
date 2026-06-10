/** Base error class for FindingBridge with actionable messages */
export class FindingBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly nextSteps?: string[],
    public readonly retryable: boolean = false
  ) {
    super(message)
    this.name = 'FindingBridgeError'
  }
}

/** Error for invalid user input or configuration */
export class ValidationError extends FindingBridgeError {
  constructor(message: string, nextSteps?: string[]) {
    super(message, 'VALIDATION_ERROR', nextSteps, true)
    this.name = 'ValidationError'
  }
}

/** Error for adapter/ingestion failures */
export class AdapterError extends FindingBridgeError {
  constructor(
    message: string,
    public readonly source: string,
    nextSteps?: string[]
  ) {
    super(message, 'ADAPTER_ERROR', nextSteps, true)
    this.name = 'AdapterError'
  }
}

/** Error for database operations */
export class DatabaseError extends FindingBridgeError {
  constructor(message: string, nextSteps?: string[]) {
    super(message, 'DATABASE_ERROR', nextSteps, false)
    this.name = 'DatabaseError'
  }
}

/** Error for MCP tool execution failures */
export class ToolError extends FindingBridgeError {
  constructor(
    message: string,
    public readonly toolName: string,
    nextSteps?: string[]
  ) {
    super(message, 'TOOL_ERROR', nextSteps, true)
    this.name = 'ToolError'
  }
}
