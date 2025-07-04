// TDD Phase 1: Error Response Utility Implementation
// Author: PB and Claude
// GREEN phase: Minimum implementation to pass tests

export interface MCPErrorResponse {
  isError: true;
  content: Array<{
    type: 'text';
    text: string;
  }>;
  [key: string]: unknown; // Allow additional properties for MCP SDK compatibility
}

/**
 * Creates a standardized MCP error response from any error type
 * 
 * @param error - The error to format (Error object, string, or unknown type)
 * @param context - Context string to help identify where the error occurred
 * @returns Standardized MCP error response object
 */
export function createErrorResponse(
  error: unknown, 
  context: string
): MCPErrorResponse {
  // Extract error message using the same pattern we're replacing
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  return {
    isError: true,
    content: [{
      type: 'text',
      text: `Error in ${context}: ${errorMessage}`
    }]
  };
}