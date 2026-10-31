"use client";

import { useState } from "react";
import { Box, Button, Text, TextArea } from "@razorpay/blade/components";
import { formatElapsed } from "@/lib/presentation/labels";
import type { DesignerNote } from "@/types";

type Props = {
  sessionId: string;
  notes: DesignerNote[];
  originTime?: string;
  onAdded: () => void;
};

/** Designer-authored observations, saved with the session and labelled as human notes. */
export function ObservationNotes({ sessionId, notes, originTime, onAdded }: Props) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function save() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The note couldn't be saved.");
      } else {
        setText("");
        onAdded();
      }
    } catch {
      setError("The note couldn't be saved. Check your connection.");
    } finally {
      setSaving(false);
    }
  }

  const origin = originTime ? Date.parse(originTime) : undefined;

  return (
    <Box display="flex" flexDirection="column" gap="spacing.4">
      {notes.length > 0 ? (
        <Box as="span" display="flex" flexDirection="column" gap="spacing.3">
          {notes.map((note) => (
            <Box
              key={note.id}
              padding="spacing.4"
              borderRadius="medium"
              backgroundColor="surface.background.gray.moderate"
            >
              <Text size="small" color="surface.text.gray.muted">
                {note.ref} · Your note{origin ? ` · ${formatElapsed(Date.parse(note.createdAt) - origin)}` : ""}
              </Text>
              <Text size="medium" wordBreak="break-word">
                {note.text}
              </Text>
            </Box>
          ))}
        </Box>
      ) : null}
      <TextArea
        label="Add an observation"
        name="note"
        value={text}
        onChange={({ value }) => setText(value ?? "")}
        numberOfLines={2}
        maxCharacters={1000}
        placeholder="What did you notice?"
        validationState={error ? "error" : "none"}
        errorText={error}
        helpText="Saved with this session and labelled as your note, separate from the agent's evidence."
      />
      <Box>
        <Button variant="secondary" size="small" onClick={save} isLoading={saving} isDisabled={!text.trim()}>
          Add note
        </Button>
      </Box>
    </Box>
  );
}
