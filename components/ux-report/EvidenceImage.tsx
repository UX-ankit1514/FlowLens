"use client";

import { useState } from "react";
import { Text } from "@razorpay/blade/components";
import { Thumb } from "./Thumb";

/**
 * A step screenshot captured by TinyFish. If TinyFish can't serve it (it
 * sometimes lists a screenshot that isn't in storage), say so plainly rather
 * than showing a broken image or substituting anything.
 */
export function EvidenceImage({ src, refLabel, action }: { src: string; refLabel: string; action: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <Thumb as="div" role="img" aria-label={`Screenshot ${refLabel} is not available`}>
        <span className="thumb-message">
          <Text size="small" color="surface.text.gray.muted">
            Screenshot not available from TinyFish
          </Text>
        </span>
      </Thumb>
    );
  }

  return (
    <Thumb href={src} target="_blank" rel="noopener noreferrer" aria-label={`Open screenshot ${refLabel} in a new tab`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- proxied evidence image, sized by CSS */}
      <img src={src} alt={`Screenshot ${refLabel} captured by TinyFish: ${action}`} loading="lazy" onError={() => setFailed(true)} />
    </Thumb>
  );
}
