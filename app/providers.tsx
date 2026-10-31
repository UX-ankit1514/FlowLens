"use client";

import { useState, type ReactNode } from "react";
import { useServerInsertedHTML } from "next/navigation";
import { ServerStyleSheet, StyleSheetManager } from "styled-components";
import { BladeProvider } from "@razorpay/blade/components";
import { flowlensTheme } from "@/lib/design/theme";

/** Collects styled-components CSS during SSR so Blade renders styled on first paint. */
function StyledComponentsRegistry({ children }: { children: ReactNode }) {
  const [sheet] = useState(() => new ServerStyleSheet());

  useServerInsertedHTML(() => {
    const styles = sheet.getStyleElement();
    sheet.instance.clearTag();
    return <>{styles}</>;
  });

  if (typeof window !== "undefined") return <>{children}</>;
  return <StyleSheetManager sheet={sheet.instance}>{children}</StyleSheetManager>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <StyledComponentsRegistry>
      <BladeProvider themeTokens={flowlensTheme} colorScheme="light">
        {children}
      </BladeProvider>
    </StyledComponentsRegistry>
  );
}
