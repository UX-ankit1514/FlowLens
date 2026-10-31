import { createTheme, type ThemeTokens } from "@razorpay/blade/tokens";

/**
 * FlowLens theme, built with Blade's white-labelling API.
 *
 * - Brand: a restrained deep blue (#2142B5). Blade derives the full
 *   interactive palette (hover, focus, disabled, faded) from it.
 * - Type: Inter for both text and headings, per the FlowLens spec.
 *   (Blade's default heading face is TASA Orbiter.)
 * Everything else — spacing (4px base), radii, elevation, feedback colours —
 * comes from Blade's semantic tokens unchanged.
 */
export const FLOWLENS_BRAND_COLOR = "#2142B5";

const INTER_STACK = `"Inter", "Inter Fallback Arial", -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;

const { theme: brandTheme } = createTheme({ brandColor: FLOWLENS_BRAND_COLOR });

function withInter(typography: ThemeTokens["typography"]["onDesktop"]) {
  return {
    ...typography,
    fonts: {
      ...typography.fonts,
      family: { ...typography.fonts.family, text: INTER_STACK, heading: INTER_STACK },
    },
  };
}

export const flowlensTheme: ThemeTokens = {
  ...brandTheme,
  name: "flowlens",
  typography: {
    onDesktop: withInter(brandTheme.typography.onDesktop),
    onMobile: withInter(brandTheme.typography.onMobile),
  },
};
