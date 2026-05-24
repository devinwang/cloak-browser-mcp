import type { ServerConfig } from "../config.js";
import { cloakBinaryTools } from "./cloakBinary.js";
import { cloakDetectionTools } from "./cloakDetection.js";
import { cloakHumanizeTools } from "./cloakHumanize.js";
import { cloakProfileTools } from "./cloakProfile.js";
import { cloakStealthTools } from "./cloakStealth.js";
import { configTools } from "./config.js";
import { devtoolsTools } from "./devtools.js";
import { interactionTools } from "./interaction.js";
import { navigationTools } from "./navigation.js";
import { networkTools } from "./network.js";
import { pageStateTools } from "./pageState.js";
import { pdfTools } from "./pdf.js";
import { storageTools } from "./storage.js";
import { testingTools } from "./testing.js";
import type { ToolHandler } from "./types.js";
import { visionTools } from "./vision.js";

export function collectTools(cfg: ServerConfig): ToolHandler[] {
  const all: ToolHandler[] = [
    ...navigationTools,
    ...interactionTools,
    ...pageStateTools,
    ...networkTools,
    ...storageTools,
    ...visionTools,
    ...pdfTools,
    ...testingTools,
    ...devtoolsTools,
    ...configTools,
    // Cloak-exclusive: always on (these are the differentiator)
    ...cloakStealthTools,
    ...cloakDetectionTools,
    ...cloakProfileTools,
    ...cloakBinaryTools,
    // Cap-gated cloak tool
    ...cloakHumanizeTools,
  ];
  return all.filter((t) => !t.capability || cfg.caps.has(t.capability));
}

export type { ToolHandler };
