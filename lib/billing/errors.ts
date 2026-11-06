export class BillingError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function jsonError(status: number, error: string, code: string): Response {
  return Response.json({ error, code }, { status });
}

export function billingResponse(error: unknown): Response {
  if (error instanceof BillingError) return jsonError(error.status, error.message, error.code);
  console.error(error);
  return jsonError(500, "Something went wrong.", "internal");
}
