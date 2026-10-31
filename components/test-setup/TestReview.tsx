"use client";

import { Alert, Box, Button, Card, CardBody, Divider, Heading, Text } from "@razorpay/blade/components";
import { displayUrl } from "@/lib/presentation/labels";
import type { AppConfigView } from "@/types";

type Props = {
  website?: string;
  persona: string;
  goal: string;
  criteria: string[];
  isValid: boolean;
  missing: string[];
  submitting: boolean;
  submitError?: string;
  config?: AppConfigView;
  onRun: () => void;
};

/** Concise review shown beside the form; the Run button lives here. */
export function TestReview({ website, persona, goal, criteria, isValid, missing, submitting, submitError, config, onRun }: Props) {
  return (
    <Box position={{ base: "static", l: "sticky" }} top="88px">
      <Card elevation="lowRaised" padding="spacing.7">
        <CardBody>
          <Box display="flex" flexDirection="column" gap="spacing.6">
            <Heading as="h2" size="medium">
              Review
            </Heading>

            <ReviewRow label="Website" value={website ? displayUrl(website) : undefined} />
            <ReviewRow label="Persona" value={persona} lines={3} />
            <ReviewRow label="Goal" value={goal} lines={3} />
            <Box display="flex" flexDirection="column" gap="spacing.2">
              <Text size="small" color="surface.text.gray.muted">
                Success criteria
              </Text>
              {criteria.length === 0 ? (
                <Text size="medium" color="surface.text.gray.disabled">
                  Not added yet
                </Text>
              ) : (
                <Box as="span" display="flex" flexDirection="column" gap="spacing.2">
                  {criteria.map((c, i) => (
                    <Box key={i} display="flex" gap="spacing.3">
                      <Box width="18px" flexShrink={0}>
                        <Text size="medium" color="surface.text.gray.muted" as="span">
                          {i + 1}.
                        </Text>
                      </Box>
                      <Text size="medium" as="span" truncateAfterLines={2}>
                        {c}
                      </Text>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

            <Divider />

            {submitError ? <Alert color="negative" isFullWidth isDismissible={false} description={submitError} /> : null}

            <Button
              isFullWidth
              size="large"
              onClick={onRun}
              isDisabled={!isValid || config?.tinyfishConfigured === false}
              isLoading={submitting}
              accessibilityLabel="Run usability test"
            >
              Run usability test
            </Button>

            <Box display="flex" flexDirection="column" gap="spacing.2">
              {!isValid && missing.length > 0 ? (
                <Text size="small" color="surface.text.gray.muted">
                  Still needed: {missing.join(", ")}.
                </Text>
              ) : null}
              <Text size="small" color="surface.text.gray.muted">
                Starts a real browser session with TinyFish. Most tests take 1–5 minutes and use your TinyFish
                balance.
              </Text>
              {config ? (
                <Text size="small" color="surface.text.gray.muted">
                  Report:{" "}
                  {config.aiInterpretationEnabled
                    ? "reasoning-model analysis with evidence checks."
                    : "rule-based analysis. Connect Claude for reasoning-model analysis."}
                </Text>
              ) : null}
            </Box>
          </Box>
        </CardBody>
      </Card>
    </Box>
  );
}

function ReviewRow({ label, value, lines = 2 }: { label: string; value?: string; lines?: number }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.2">
      <Text size="small" color="surface.text.gray.muted">
        {label}
      </Text>
      {value ? (
        <Text size="medium" truncateAfterLines={lines} wordBreak="break-word">
          {value}
        </Text>
      ) : (
        <Text size="medium" color="surface.text.gray.disabled">
          Not added yet
        </Text>
      )}
    </Box>
  );
}
