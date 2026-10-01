export class DraftRepositoryError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = 'DraftRepositoryError';
  }
}
