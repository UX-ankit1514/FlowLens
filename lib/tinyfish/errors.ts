import {
  APIConnectionError,
  APIStatusError,
  APITimeoutError,
  AuthenticationError,
  BadRequestError,
  PaymentRequiredError,
  PermissionDeniedError,
  RateLimitError,
  type RunError,
} from "@tiny-fish/sdk";
import type { SessionError } from "@/types";

/** Removes anything that looks like a TinyFish key before text is stored. */
export function redactSecrets(text: string): string {
  return text.replace(/sk-tinyfish-[A-Za-z0-9_-]+/g, "[redacted]").replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]");
}

/** Maps an exception thrown by the SDK (before or during streaming). */
export function mapThrownError(error: unknown): SessionError {
  const providerMessage = error instanceof Error ? redactSecrets(error.message) : undefined;

  if (error instanceof AuthenticationError) {
    return {
      kind: "INVALID_API_KEY",
      message: "TinyFish rejected the API key. Check TINYFISH_API_KEY in .env.local, then restart FlowLens.",
      providerMessage,
    };
  }
  if (error instanceof PaymentRequiredError) {
    return {
      kind: "INSUFFICIENT_CREDITS",
      message: "Your TinyFish account doesn't have enough balance to start a run. Add funds, then try again.",
      providerMessage,
      helpUrl: "https://agent.tinyfish.ai/wallet",
    };
  }
  if (error instanceof RateLimitError) {
    return {
      kind: "RATE_LIMITED",
      message:
        "TinyFish is limiting how many runs can start right now (your plan allows a small number at once). Wait a moment and try again.",
      providerMessage,
    };
  }
  if (error instanceof PermissionDeniedError) {
    return {
      kind: "INVALID_API_KEY",
      message: "This TinyFish API key isn't allowed to start browser runs.",
      providerMessage,
    };
  }
  if (error instanceof BadRequestError) {
    return {
      kind: "INVALID_REQUEST",
      message: "TinyFish couldn't accept this test configuration.",
      providerMessage,
    };
  }
  if (error instanceof APITimeoutError) {
    return { kind: "TIMEOUT", message: "The connection to TinyFish timed out.", providerMessage };
  }
  if (error instanceof APIConnectionError) {
    return {
      kind: "NETWORK",
      message: "FlowLens couldn't reach TinyFish. Check your internet connection and try again.",
      providerMessage,
    };
  }
  if (error instanceof APIStatusError) {
    return {
      kind: "PROVIDER_ERROR",
      message: `TinyFish returned an error (HTTP ${error.statusCode}).`,
      providerMessage,
      providerCode: error.code,
    };
  }
  return {
    kind: "UNKNOWN",
    message: "Something unexpected went wrong while running the test.",
    providerMessage,
  };
}

/** Maps the structured error on a FAILED run (COMPLETE event or GET /runs). */
export function mapRunError(error: RunError | null | undefined): SessionError {
  if (!error) {
    return { kind: "PROVIDER_ERROR", message: "TinyFish reported that the run failed but gave no reason." };
  }
  const base = {
    providerMessage: redactSecrets(error.message),
    providerCode: error.code,
    retryAfterSeconds: error.retry_after,
    helpUrl: error.help_url,
  };
  switch (error.category) {
    case "BILLING_FAILURE":
      return {
        ...base,
        kind: "INSUFFICIENT_CREDITS",
        message: "The run was rejected at TinyFish's billing check. Add funds to your TinyFish wallet and try again.",
        helpUrl: "https://agent.tinyfish.ai/wallet",
      };
    case "AGENT_FAILURE":
      if (/usage polic/i.test(error.message)) {
        return {
          ...base,
          kind: "AGENT_FAILURE",
          message:
            "TinyFish's safety filter declined this test before the browser started. Try rephrasing the goal, persona or success criteria. This is not a usability finding.",
        };
      }
      return {
        ...base,
        kind: "AGENT_FAILURE",
        message:
          "The browser agent couldn't carry out this run. This is a technical failure, not a usability finding — the website may be unreachable, or the task may need rephrasing.",
      };
    case "SYSTEM_FAILURE":
      return {
        ...base,
        kind: "PROVIDER_ERROR",
        message: "TinyFish had an infrastructure problem during this run. It's safe to try again.",
      };
    default:
      return { ...base, kind: "UNKNOWN", message: "TinyFish reported that the run failed." };
  }
}
