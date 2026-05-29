export class PluginError extends Error {
  constructor(message: string, hint?: string) {
    super([message, hint].filter(Boolean).join(' '));
    this.name = new.target.name;
  }
}

export class ArgumentError extends PluginError {}

export class EmptyResultError extends PluginError {
  constructor(command: string, hint?: string) {
    super([`No results found for ${command}.`, hint].filter(Boolean).join(' '));
  }
}

export class CommandExecutionError extends PluginError {}

export class UpstreamServiceError extends PluginError {
  constructor(service: string, status: number | string, hint?: string) {
    super(`Upstream service ${service} returned status ${status}.`, hint);
  }
}
