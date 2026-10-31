"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useConnections } from "@/components/connections/ConnectionsContext";
import { useRouter } from "next/navigation";
import {
  Alert,
  Box,
  Collapsible,
  CollapsibleBody,
  CollapsibleLink,
  Heading,
  Text,
  TextArea,
  TextInput,
} from "@razorpay/blade/components";
import {
  collectFieldErrors,
  splitCriteria,
  suggestSessionName,
  testInputSchema,
  type FieldErrors,
} from "@/lib/schemas/test-input";
import { normalizeWebsiteUrl } from "@/lib/security/url";
import type { TestSession } from "@/types";
import { TestReview } from "./TestReview";

type FormState = {
  websiteUrl: string;
  persona: string;
  goal: string;
  successCriteria: string;
  sessionName: string;
  featureName: string;
  featureDescription: string;
  featureBenefit: string;
  featureOutcome: string;
};

const EMPTY: FormState = {
  websiteUrl: "",
  persona: "",
  goal: "",
  successCriteria: "",
  sessionName: "",
  featureName: "",
  featureDescription: "",
  featureBenefit: "",
  featureOutcome: "",
};

type RequiredField = keyof FieldErrors;

function toPayload(form: FormState) {
  return {
    websiteUrl: form.websiteUrl,
    persona: form.persona,
    goal: form.goal,
    successCriteria: splitCriteria(form.successCriteria),
    sessionName: form.sessionName,
    featureContext: {
      name: form.featureName,
      description: form.featureDescription,
      intendedBenefit: form.featureBenefit,
      expectedOutcome: form.featureOutcome,
    },
  };
}

export function TestSetup({ fromSessionId }: { fromSessionId?: string }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<RequiredField, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const { config, openConnections } = useConnections();
  const [featureOpen, setFeatureOpen] = useState(false);
  const [prefillNote, setPrefillNote] = useState<string>();

  // "Run another test": start from a previous session's definition.
  useEffect(() => {
    if (!fromSessionId) return;
    fetch(`/api/sessions/${fromSessionId}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<TestSession>) : Promise.reject()))
      .then(({ definition: d }) => {
        setForm({
          websiteUrl: d.websiteUrl,
          persona: d.persona.description,
          goal: d.goal,
          successCriteria: d.successCriteria.join("\n"),
          sessionName: "",
          featureName: d.featureContext?.name ?? "",
          featureDescription: d.featureContext?.description ?? "",
          featureBenefit: d.featureContext?.intendedBenefit ?? "",
          featureOutcome: d.featureContext?.expectedOutcome ?? "",
        });
        if (d.featureContext) setFeatureOpen(true);
        setPrefillNote("Loaded from your previous test. Edit anything before running again.");
      })
      .catch(() => setPrefillNote("The previous test couldn't be loaded (it may have been cleared on restart)."));
  }, [fromSessionId]);

  const validation = useMemo(() => testInputSchema.safeParse(toPayload(form)), [form]);
  const clientErrors: FieldErrors = validation.success ? {} : collectFieldErrors(validation.error);
  const isValid = validation.success;

  const errorFor = (field: RequiredField) => serverErrors[field] ?? (touched[field] ? clientErrors[field] : undefined);

  const update = (field: keyof FormState) => ({ value }: { value?: string }) => {
    setForm((f) => ({ ...f, [field]: value ?? "" }));
    if (field in serverErrors) setServerErrors((e) => ({ ...e, [field]: undefined }));
  };
  const touch = (field: RequiredField) => () => setTouched((t) => ({ ...t, [field]: true }));

  const missing = (
    [
      ["websiteUrl", "a valid website"],
      ["persona", "a persona"],
      ["goal", "a user goal"],
      ["successCriteria", "success criteria"],
    ] as const
  )
    .filter(([field]) => clientErrors[field])
    .map(([, label]) => label);

  const normalized = normalizeWebsiteUrl(form.websiteUrl);
  const criteria = splitCriteria(form.successCriteria);
  const nameSuggestion = form.goal.trim() ? suggestSessionName(form.goal) : "";

  async function handleSubmit(event?: FormEvent) {
    event?.preventDefault();
    setTouched({ websiteUrl: true, persona: true, goal: true, successCriteria: true });
    if (!isValid || submitting) return;
    setSubmitting(true);
    setSubmitError(undefined);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(form)),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string; fieldErrors?: FieldErrors };
      if (!res.ok || !body.id) {
        setServerErrors(body.fieldErrors ?? {});
        setSubmitError(body.fieldErrors ? undefined : (body.error ?? "The test couldn't be started. Try again."));
        setSubmitting(false);
        return;
      }
      router.push(`/sessions/${body.id}`);
    } catch {
      setSubmitError("FlowLens couldn't reach its server. Check that it's still running, then try again.");
      setSubmitting(false);
    }
  }

  return (
    <Box>
      <Box marginBottom="spacing.8" maxWidth="720px">
        <Heading as="h1" size="xlarge">
          Test a user journey on any website.
        </Heading>
        <Box marginTop="spacing.3">
          <Text size="large" color="surface.text.gray.subtle">
            Provide your persona, define a task, and observe an AI agent attempt the journey.
          </Text>
        </Box>
      </Box>

      {config && !config.tinyfishConfigured ? (
        <Box marginBottom="spacing.7">
          <Alert
            color="notice"
            isDismissible={false}
            isFullWidth
            title="Connect TinyFish to run tests"
            description="FlowLens runs a real browser agent on your own TinyFish account. Add your API key once; it's kept securely in this browser."
            actions={{ primary: { text: "Connect TinyFish", onClick: openConnections } }}
          />
        </Box>
      ) : null}

      {prefillNote ? (
        <Box marginBottom="spacing.7">
          <Alert color="information" isFullWidth onDismiss={() => setPrefillNote(undefined)} description={prefillNote} />
        </Box>
      ) : null}

      <Box
        display="grid"
        gridTemplateColumns={{ base: "minmax(0, 1fr)", l: "minmax(0, 1fr) 360px" }}
        gap={{ base: "spacing.8", l: "spacing.10" }}
        alignItems="start"
      >
        <form onSubmit={handleSubmit} noValidate aria-label="Usability test setup">
          <Box display="flex" flexDirection="column" gap="spacing.8">
            <FormSection title="Website" step={1}>
              <TextInput
                label="Website to test"
                name="websiteUrl"
                type="url"
                placeholder="https://example.com"
                value={form.websiteUrl}
                onChange={update("websiteUrl")}
                onBlur={touch("websiteUrl")}
                necessityIndicator="required"
                isRequired
                autoCompleteSuggestionType="none"
                validationState={errorFor("websiteUrl") ? "error" : "none"}
                errorText={errorFor("websiteUrl")}
                helpText="Any publicly reachable page, including a live site, a new feature or a staging deployment."
              />
            </FormSection>

            <FormSection title="Persona" step={2}>
              <TextArea
                label="Who are we testing for?"
                name="persona"
                placeholder="Arjun is a 27-year-old software engineer in Bengaluru. He travels occasionally, prefers affordable flight options, and is familiar with online booking websites."
                value={form.persona}
                onChange={update("persona")}
                onBlur={touch("persona")}
                numberOfLines={5}
                necessityIndicator="required"
                isRequired
                validationState={errorFor("persona") ? "error" : "none"}
                errorText={errorFor("persona")}
                helpText="Paste your existing persona. FlowLens uses it exactly as written. Include role, digital familiarity, needs, constraints or device preference if they matter."
              />
            </FormSection>

            <FormSection title="Task" step={3}>
              <Box display="flex" flexDirection="column" gap="spacing.7">
                <TextArea
                  label="What does this user want to accomplish?"
                  name="goal"
                  placeholder="Find an affordable round-trip flight for a short beach vacation departing from Bengaluru."
                  value={form.goal}
                  onChange={update("goal")}
                  onBlur={touch("goal")}
                  numberOfLines={3}
                  necessityIndicator="required"
                  isRequired
                  validationState={errorFor("goal") ? "error" : "none"}
                  errorText={errorFor("goal")}
                  helpText="Describe an outcome, not a sequence of clicks. The agent finds its own route."
                />
                <TextArea
                  label="What counts as success?"
                  name="successCriteria"
                  placeholder={"Find at least one suitable flight option\nVerify its price, destination and dates"}
                  value={form.successCriteria}
                  onChange={update("successCriteria")}
                  onBlur={touch("successCriteria")}
                  numberOfLines={4}
                  necessityIndicator="required"
                  isRequired
                  validationState={errorFor("successCriteria") ? "error" : "none"}
                  errorText={errorFor("successCriteria")}
                  helpText="One criterion per line. Each becomes a checkpoint in the report."
                />
              </Box>
            </FormSection>

            <FormSection title="Optional" step={4}>
              <Box display="flex" flexDirection="column" gap="spacing.7">
                <Collapsible isExpanded={featureOpen} onExpandChange={({ isExpanded }) => setFeatureOpen(isExpanded)}>
                  <CollapsibleLink>Testing a specific feature?</CollapsibleLink>
                  <CollapsibleBody>
                    <Box display="flex" flexDirection="column" gap="spacing.6" paddingTop="spacing.4">
                      <Text size="small" color="surface.text.gray.muted">
                        Used only when analysing the results. The agent isn&apos;t told where the feature is, so
                        discovery stays independent.
                      </Text>
                      <TextInput
                        label="Feature name"
                        name="featureName"
                        value={form.featureName}
                        onChange={update("featureName")}
                        placeholder="Flexible-date fare explorer"
                      />
                      <TextArea
                        label="Feature description"
                        name="featureDescription"
                        value={form.featureDescription}
                        onChange={update("featureDescription")}
                        numberOfLines={3}
                      />
                      <TextArea
                        label="Intended user benefit"
                        name="featureBenefit"
                        value={form.featureBenefit}
                        onChange={update("featureBenefit")}
                        numberOfLines={2}
                      />
                      <TextArea
                        label="Expected outcome"
                        name="featureOutcome"
                        value={form.featureOutcome}
                        onChange={update("featureOutcome")}
                        numberOfLines={2}
                      />
                    </Box>
                  </CollapsibleBody>
                </Collapsible>

                <TextInput
                  label="Session name"
                  name="sessionName"
                  value={form.sessionName}
                  onChange={update("sessionName")}
                  placeholder={nameSuggestion || "Suggested from the goal"}
                  necessityIndicator="optional"
                  helpText={nameSuggestion ? "Leave empty to use the suggestion." : undefined}
                />
              </Box>
            </FormSection>
          </Box>
        </form>

        <TestReview
          website={normalized.ok ? normalized.url : undefined}
          persona={form.persona.trim()}
          goal={form.goal.trim()}
          criteria={criteria}
          isValid={isValid}
          missing={missing}
          submitting={submitting}
          submitError={submitError}
          config={config}
          onRun={() => void handleSubmit()}
        />
      </Box>
    </Box>
  );
}

function FormSection({ title, step, children }: { title: string; step: number; children: React.ReactNode }) {
  return (
    <Box
      as="section"
      display="grid"
      gridTemplateColumns={{ base: "minmax(0, 1fr)", m: "120px minmax(0, 1fr)" }}
      gap={{ base: "spacing.4", m: "spacing.7" }}
      paddingTop="spacing.7"
      borderTopWidth="thin"
      borderTopColor="surface.border.gray.muted"
    >
      <Box display="flex" gap="spacing.3" alignItems="baseline">
        <Text size="small" color="surface.text.gray.muted" as="span">
          {String(step).padStart(2, "0")}
        </Text>
        <Text size="medium" weight="semibold" as="span">
          {title}
        </Text>
      </Box>
      <Box>{children}</Box>
    </Box>
  );
}
