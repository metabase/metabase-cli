export class SessionCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionCommandError";
  }
}
