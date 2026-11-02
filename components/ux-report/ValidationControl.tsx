"use client";

import { useState } from "react";
import { announce, Box, Link, SegmentedControl, SegmentedControlItem, Text, TextInput } from "@razorpay/blade/components";
import { VALIDATION_VIEW } from "@/lib/presentation/labels";
import type { HumanValidation, HumanValidationStatus } from "@/types";

/**
 * "Did real people hit this too?" — recorded by the designer per issue.
 * Same saving behaviour as before; it now sits on each issue card.
 */
export function ValidationControl({
  sessionId,
  findingId,
  findingTitle,
  saved,
  onChanged,
}: {
  sessionId: string;
  findingId: string;
  findingTitle: string;
  saved?: HumanValidation;
  onChanged: () => void;
}) {
  const status: HumanValidationStatus = saved?.status ?? "NOT_TESTED";
  const [note, setNote] = useState(saved?.note ?? "");
  const [noteOpen, setNoteOpen] = useState(Boolean(saved?.note));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();

  async function save(next: HumanValidationStatus) {
    setSaving(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/validation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, status: next, note: note || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMessage(res.ok ? "Saved" : (body.error ?? "Couldn't save."));
      if (res.ok) {
        announce(`${findingTitle}: ${VALIDATION_VIEW[next].label}`);
        onChanged();
      }
    } catch {
      setMessage("Couldn't save. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box display="flex" flexDirection="column" gap="spacing.3" minWidth="0px">
      <Box display="flex" alignItems="center" gap="spacing.4" flexWrap="wrap">
        <Text size="small" weight="semibold">
          Seen with real users?
        </Text>
        <SegmentedControl
          accessibilityLabel={`Was “${findingTitle}” seen with real users?`}
          size="small"
          value={status}
          onChange={({ value }) => void save(value as HumanValidationStatus)}
          isDisabled={saving}
        >
          <SegmentedControlItem value="NOT_TESTED">Not tested yet</SegmentedControlItem>
          <SegmentedControlItem value="OBSERVED">Yes, seen</SegmentedControlItem>
          <SegmentedControlItem value="NOT_OBSERVED">No, not seen</SegmentedControlItem>
        </SegmentedControl>
        {!noteOpen ? (
          <Link variant="button" size="small" onClick={() => setNoteOpen(true)}>
            Add participant evidence
          </Link>
        ) : null}
      </Box>
      {noteOpen ? (
        <Box maxWidth="480px">
          <TextInput
            label="Participant evidence (optional)"
            labelPosition="top"
            size="medium"
            placeholder="e.g. 3 of 5 participants missed the fare"
            value={note}
            onChange={({ value }) => setNote(value ?? "")}
            onBlur={() => {
              if (note !== (saved?.note ?? "")) void save(status);
            }}
            maxCharacters={500}
          />
        </Box>
      ) : null}
      <Text size="xsmall" color="surface.text.gray.muted">
        {message ?? "Recorded by you after testing with participants. FlowLens can't know this on its own."}
      </Text>
    </Box>
  );
}
