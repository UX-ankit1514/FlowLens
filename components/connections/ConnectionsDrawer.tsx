"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import styled from "styled-components";
import {
  Badge,
  Box,
  Button,
  CheckIcon,
  CopyIcon,
  Divider,
  Drawer,
  DrawerBody,
  DrawerHeader,
  ExternalLinkIcon,
  Heading,
  Link,
  PasswordInput,
  Text,
} from "@razorpay/blade/components";
import type { Theme } from "@razorpay/blade/components";
import type { AppConfigView, ConnectionView } from "@/types";

type Provider = "tinyfish" | "claude";

const PROVIDERS: Record<
  Provider,
  { name: string; required: boolean; purpose: string; keyUrl: string; keyLabel: string; placeholder: string }
> = {
  tinyfish: {
    name: "TinyFish",
    required: true,
    purpose: "Runs the browser agent that attempts each journey. Tests use your TinyFish balance.",
    keyUrl: "https://agent.tinyfish.ai/api-keys",
    keyLabel: "TinyFish API key",
    placeholder: "Paste your TinyFish API key",
  },
  claude: {
    name: "Claude",
    required: false,
    purpose:
      "Adds reasoning-model analysis to reports: journey patterns, criteria checked against screenshots and sharper findings. Without it, reports use rule-based analysis.",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyLabel: "Claude API key",
    placeholder: "Paste your Claude API key",
  },
};

export function ConnectionsDrawer({
  isOpen,
  onClose,
  config,
  onChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  config?: AppConfigView;
  onChange: (config: AppConfigView) => void;
}) {
  return (
    <Drawer isOpen={isOpen} onDismiss={onClose} accessibilityLabel="Connections">
      <DrawerHeader title="Connections" subtitle="Connect your keys, and run FlowLens from Claude Code or Codex." />
      <DrawerBody>
        <Box display="flex" flexDirection="column" gap="spacing.7" paddingBottom="spacing.8">
          <KeySection provider="tinyfish" connection={config?.tinyfish} onChange={onChange} />
          <Divider />
          <KeySection provider="claude" connection={config?.claude} onChange={onChange} />
          <Text size="small" color="surface.text.gray.muted">
            Keys are checked with the provider, then kept in a secure cookie in this browser only. FlowLens never
            shows them again and doesn&apos;t save them with your tests.
          </Text>
          <Divider />
          <AgentSetup />
        </Box>
      </DrawerBody>
    </Drawer>
  );
}

function statusLine(connection?: ConnectionView): string {
  if (!connection?.connected) return "Not connected";
  if (connection.source === "server") return "Connected with the key set on the server";
  return `Connected · key ending ${connection.hint ?? "····"}`;
}

function KeySection({
  provider,
  connection,
  onChange,
}: {
  provider: Provider;
  connection?: ConnectionView;
  onChange: (config: AppConfigView) => void;
}) {
  const info = PROVIDERS[provider];
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const connected = Boolean(connection?.connected);
  const showForm = !connected || editing;

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey: value }),
      });
      const body = (await res.json().catch(() => ({}))) as AppConfigView & { error?: string };
      if (!res.ok) {
        setError(body.error ?? "The key couldn't be saved. Try again.");
        return;
      }
      onChange(body);
      setValue("");
      setEditing(false);
      setSaved(true);
    } catch {
      setError("FlowLens couldn't reach its server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/connections?provider=${provider}`, { method: "DELETE" });
      if (res.ok) onChange((await res.json()) as AppConfigView);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box display="flex" flexDirection="column" gap="spacing.4">
      <Box display="flex" alignItems="center" justifyContent="space-between" gap="spacing.3" flexWrap="wrap">
        <Box display="flex" alignItems="center" gap="spacing.3">
          <Heading as="h3" size="small">
            {info.name}
          </Heading>
          <Badge size="small" color={info.required ? "primary" : "neutral"}>
            {info.required ? "Required" : "Optional"}
          </Badge>
        </Box>
        <Box display="flex" alignItems="center" gap="spacing.2">
          <StatusDot $on={connected} aria-hidden />
          <Text size="small" color={connected ? "feedback.text.positive.intense" : "surface.text.gray.muted"}>
            {saved ? "Connected" : statusLine(connection)}
          </Text>
        </Box>
      </Box>
      <Text size="small" color="surface.text.gray.subtle">
        {info.purpose}
      </Text>

      {showForm ? (
        <form onSubmit={save} aria-label={`Connect ${info.name}`}>
          <Box display="flex" flexDirection="column" gap="spacing.3">
            <PasswordInput
              label={info.keyLabel}
              placeholder={info.placeholder}
              value={value}
              onChange={({ value: next }) => {
                setValue(next ?? "");
                setError(undefined);
              }}
              autoCompleteSuggestionType="none"
              validationState={error ? "error" : "none"}
              errorText={error}
            />
            <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
              <Button type="submit" size="small" isLoading={busy} isDisabled={!value.trim()}>
                {connected ? "Replace key" : `Connect ${info.name}`}
              </Button>
              {editing ? (
                <Button variant="tertiary" size="small" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              ) : null}
              <Link href={info.keyUrl} target="_blank" rel="noopener noreferrer" size="small" icon={ExternalLinkIcon} iconPosition="right">
                Get a {info.name} key
              </Link>
            </Box>
          </Box>
        </form>
      ) : (
        <Box display="flex" gap="spacing.3" flexWrap="wrap">
          <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
            Use a different key
          </Button>
          {connection?.source === "browser" ? (
            <Button variant="secondary" size="small" color="negative" isLoading={busy} onClick={remove}>
              Disconnect
            </Button>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

const noopSubscribe = () => () => {};

function AgentSetup() {
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "https://your-flowlens-address",
  );
  const url = `${origin}/api/mcp`;

  const claudeCommand = `claude mcp add --transport http --scope user flowlens ${url} --header "X-TinyFish-Api-Key: YOUR_TINYFISH_API_KEY"`;
  const codexConfig = `[mcp_servers.flowlens]
url = "${url}"
http_headers = { "X-TinyFish-Api-Key" = "YOUR_TINYFISH_API_KEY" }
tool_timeout_sec = 120`;

  return (
    <Box display="flex" flexDirection="column" gap="spacing.5">
      <Box display="flex" flexDirection="column" gap="spacing.2">
        <Heading as="h3" size="small">
          Use FlowLens from Claude Code or Codex
        </Heading>
        <Text size="small" color="surface.text.gray.subtle">
          Connect once, then ask your coding agent to run a usability test and read the report. Tests run on your own
          TinyFish key; replace YOUR_TINYFISH_API_KEY with it.
        </Text>
      </Box>

      <CodeBlock label="FlowLens MCP address" code={url} />

      <Box display="flex" flexDirection="column" gap="spacing.3">
        <Text weight="semibold">Claude Code</Text>
        <Text size="small" color="surface.text.gray.subtle">
          Run this once in your terminal:
        </Text>
        <CodeBlock label="Claude Code command" code={claudeCommand} />
      </Box>

      <Box display="flex" flexDirection="column" gap="spacing.3">
        <Text weight="semibold">Codex</Text>
        <Text size="small" color="surface.text.gray.subtle">
          Add this to ~/.codex/config.toml, or in the Codex app open Settings → MCP servers → Add server, choose
          Streamable HTTP and use the address above with the same header.
        </Text>
        <CodeBlock label="Codex configuration" code={codexConfig} />
      </Box>

      <Box backgroundColor="surface.background.gray.moderate" borderRadius="medium" padding="spacing.4">
        <Text size="small" color="surface.text.gray.subtle">
          Then ask, for example: “Use FlowLens to test whether a first-time visitor can find the pricing for the
          team plan on https://example.com.” Your agent can start the test, follow it and read the full report. To
          include the Claude analysis, also send your Claude key in an X-Anthropic-Api-Key header.
        </Text>
      </Box>
    </Box>
  );
}

const Pre = styled.pre(
  ({ theme }: { theme: Theme }) => `
  margin: 0;
  padding: ${theme.spacing[4]}px ${theme.spacing[4]}px;
  background: ${theme.colors.surface.background.gray.moderate};
  border: 1px solid ${theme.colors.surface.border.gray.muted};
  border-radius: ${theme.border.radius.medium}px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  color: ${theme.colors.surface.text.gray.normal};
  white-space: pre-wrap;
  word-break: break-all;
  user-select: all;
`,
);

const StatusDot = styled.span<{ $on: boolean }>(
  ({ theme, $on }: { theme: Theme; $on: boolean }) => `
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${$on ? theme.colors.feedback.background.positive.intense : theme.colors.surface.border.gray.normal};
`,
);

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      /* clipboard blocked; the text is still selectable */
    }
  }

  return (
    <Box display="flex" flexDirection="column" gap="spacing.2">
      <Pre aria-label={label}>{code}</Pre>
      <Box display="flex" justifyContent="flex-end">
        <Button variant="tertiary" size="xsmall" icon={copied ? CheckIcon : CopyIcon} onClick={copy} accessibilityLabel={`Copy ${label}`}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </Box>
    </Box>
  );
}
