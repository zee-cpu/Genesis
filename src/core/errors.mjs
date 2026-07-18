export class GenesisError extends Error {
  constructor(code, message, {
    path,
    correction,
    escalation,
    cause,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GenesisError";
    this.code = code;
    this.path = path;
    this.correction = correction;
    this.escalation = escalation;
  }
}

export function formatError(error) {
  const lines = [`${error.code ?? "UNEXPECTED_ERROR"}: ${error.message ?? String(error)}`];

  if (error.path) lines.push(`Path: ${error.path}`);
  if (error.correction) lines.push(`Correction: ${error.correction}`);
  if (error.escalation) lines.push(`Escalation: ${error.escalation}`);

  return lines.join("\n");
}
