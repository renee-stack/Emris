export class BillingError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /UNIQUE/i.test(error.message);
}
