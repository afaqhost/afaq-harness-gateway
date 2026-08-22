export interface IsolationPolicy {
  readonly exposeHostDockerSocket: boolean;
  readonly mountHostFilesystem: boolean;
}

export const DEFAULT_ISOLATION_POLICY: IsolationPolicy = {
  exposeHostDockerSocket: false,
  mountHostFilesystem: false,
};

export class IsolationViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IsolationViolationError";
  }
}

export function assertIsolationPolicy(policy: IsolationPolicy): void {
  if (policy.exposeHostDockerSocket) {
    throw new IsolationViolationError(
      "Isolation violation: exposing the host Docker socket is not permitted",
    );
  }
  if (policy.mountHostFilesystem) {
    throw new IsolationViolationError(
      "Isolation violation: mounting the host filesystem is not permitted",
    );
  }
}
