export const colors = {
  surface: "#080812",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#10101E",
  onSurfaceSecondary: "#E8E7F1",
  surfaceTertiary: "#18172A",
  onSurfaceTertiary: "#A8A5BA",
  brand: "#7C3AED",
  brandSecondary: "#A855F7",
  brandTertiary: "#25143F",
  onBrandTertiary: "#E9D5FF",
  success: "#34D399",
  warning: "#C084FC",
  error: "#FB7185",
  border: "#25233A",
  borderStrong: "#3B3560",
  divider: "#1B192A",
};

export const tvColors = {
  canvas: "#070711",
  canvasRaised: "#0B0B18",
  panel: "#10101E",
  panelRaised: "#151427",
  panelSoft: "#19172D",
  purple: "#7C3AED",
  purpleBright: "#A855F7",
  purpleSoft: "#C084FC",
  purpleDeep: "#3B1768",
  focus: "#B76CFF",
  text: "#FFFFFF",
  textMuted: "#AAA7BB",
  line: "rgba(255,255,255,0.10)",
  lineStrong: "rgba(192,132,252,0.42)",
  scrim: "rgba(4,3,10,0.78)",
};

/**
 * Neon-glass look shared by every TV page (same values the Settings and VOD
 * redesign uses). Plain colors only: no blur, no extra views, so a page costs
 * the same to draw as before the facelift.
 */
const tvGlass = {
  // Clear: the crown background drawn by the shell shows through every page.
  page: "transparent",
  rail: "#1A0B33",
  drawer: "#1E0C3C",
  panel: "rgba(122,62,214,0.13)",
  panelStrong: "rgba(122,62,214,0.22)",
  edge: "rgba(216,178,255,0.30)",
  edgeSoft: "rgba(216,178,255,0.16)",
  button: "rgba(150,90,235,0.18)",
  buttonEdge: "rgba(226,190,255,0.40)",
  selected: "rgba(124,58,237,0.34)",
  selectedEdge: "rgba(200,150,255,0.55)",
  focus: "rgba(178,70,255,0.62)",
  focusEdge: "#FFFFFF",
  glow: "#E04DFF",
  pink: "#E879F9",
  live: "#E11D48",
  liveEdge: "#FF6B8B",
  kicker: "#C4A6F0",
};

/**
 * A touch phone reads this after tvRuntime has decided TV or phone (it is the
 * first import of the root layout), so the TV values above are never touched.
 */
function isTouchPhone(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native");
    return Platform.OS === "android" && !Platform.isTV;
  } catch {
    return false;
  }
}

/** Phone neon glass: the page is clear so the crown shows; panels, buttons and drawers are about 65% see-through. */
const phoneGlassTokens: typeof tvGlass = {
  ...tvGlass,
  page: "transparent",
  rail: "#1A0B33",
  drawer: "#2A1360",
  panel: "rgba(130,72,212,0.30)",
  panelStrong: "rgba(130,72,212,0.38)",
  edge: "rgba(235,205,255,0.55)",
  edgeSoft: "rgba(235,205,255,0.32)",
  button: "rgba(150,90,235,0.35)",
  buttonEdge: "rgba(235,205,255,0.62)",
  selected: "rgba(170,85,245,0.52)",
  selectedEdge: "rgba(255,255,255,0.92)",
};

/** True on a touch phone (never on a TV); screens use it for phone-only layout changes. */
export const phoneUi: boolean = isTouchPhone();

export const glass: typeof tvGlass = phoneUi ? phoneGlassTokens : tvGlass;

/**
 * The TV sizes are drawn for a 10-foot screen; on a phone held at arm's length text and
 * tap targets are scaled up 30%. On a TV this returns the size unchanged.
 */
export const ph = (n: number): number => (phoneUi ? Math.round(n * 1.3 * 2) / 2 : n);

/**
 * Phone neon-glass look (approved mock-ups). Alpha = 1 - transparency: drawers,
 * buttons and bars are 65% see-through (alpha 0.35); selected pills 48%.
 */
export const phoneGlass = {
  pageTop: ["#220A4A", "#0B0420"] as [string, string],
  fill: ["rgba(175,105,255,0.35)", "rgba(85,40,170,0.35)"] as [string, string],
  /** Drawers and sheets are solid, not see-through. */
  solid: ["#3B1C7E", "#26114F"] as [string, string],
  selectedFill: ["rgba(215,115,255,0.55)", "rgba(125,55,235,0.5)"] as [string, string],
  edge: "rgba(235,205,255,0.62)",
  glow: "#E04DFF",
  scrim: "rgba(6,2,18,0.14)",
};

/** Focus that matches Settings: bright violet fill, white edge, soft glow. */
export const glassFocus = {
  backgroundColor: glass.focus,
  borderColor: glass.focusEdge,
  borderWidth: 2,
  shadowColor: glass.glow,
  elevation: 14,
} as const;

export const fonts = {
  display: "Fraunces",
  regular: "Geist",
  medium: "Geist-Medium",
  semibold: "Geist-SemiBold",
  bold: "Geist-Bold",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };
