"use client";

import { Box, Collapsible, CollapsibleBody, CollapsibleLink, Text } from "@razorpay/blade/components";
import type { TestDefinition } from "@/types";

/**
 * Goal always visible; persona and success criteria (exactly as the designer
 * supplied them) one click away, so the activity feed stays above the fold.
 */
export function PersonaSummary({ definition }: { definition: TestDefinition }) {
  return (
    <Box display="flex" flexDirection="column" gap="spacing.4">
      <Box display="flex" flexDirection="column" gap="spacing.2">
        <Text size="small" color="surface.text.gray.muted">
          Goal
        </Text>
        <Text size="medium" wordBreak="break-word">
          {definition.goal}
        </Text>
      </Box>
      <Collapsible>
        <CollapsibleLink>Persona and success criteria</CollapsibleLink>
        <CollapsibleBody>
          <Box display="flex" flexDirection="column" gap="spacing.5" paddingTop="spacing.4">
            <Box display="flex" flexDirection="column" gap="spacing.2">
              <Text size="small" color="surface.text.gray.muted">
                Persona
              </Text>
              <Box whiteSpace="pre-line">
                <Text size="medium" wordBreak="break-word">
                  {definition.persona.description}
                </Text>
              </Box>
            </Box>
            <Box display="flex" flexDirection="column" gap="spacing.2">
              <Text size="small" color="surface.text.gray.muted">
                Success criteria
              </Text>
              {definition.successCriteria.map((c, i) => (
                <Box key={i} display="flex" gap="spacing.3">
                  <Box width="18px" flexShrink={0}>
                    <Text size="medium" color="surface.text.gray.muted" as="span">
                      {i + 1}.
                    </Text>
                  </Box>
                  <Text size="medium" as="span" wordBreak="break-word">
                    {c}
                  </Text>
                </Box>
              ))}
            </Box>
          </Box>
        </CollapsibleBody>
      </Collapsible>
    </Box>
  );
}
