import "server-only";
import type { BrowserSignals } from "@/lib/contracts";
import type { NetworkContext } from "./request";
import { isKnownCrawler } from "./request";

type ScoreInput = {
  signals: BrowserSignals;
  headers: Headers;
  network: NetworkContext;
  challengePassed: boolean;
  returningVisitor: boolean;
  serverElapsedMs: number;
  honeypot: string;
};

// A heuristic score out of 100, NOT a calibrated probability of being human.
// No amount of forgeable device information can replace challenge validation.
export function scoreVisitor(input: ScoreInput) {
  const { signals: s, headers, network } = input;
  const reasons: string[] = [];
  const deny = (reason: string) => ({ score: 0, denied: true, reasons: [reason] });
  if (isKnownCrawler(headers.get("user-agent") ?? "")) return deny("crawler");
  if (!input.challengePassed) return deny("challenge");
  if (input.honeypot) return deny("honeypot");
  if (s.webdriver) return deny("automation");
  if (network.verifiedBot || (network.botScore !== null && network.botScore < 30)) return deny("network-bot");
  if (!s.cookiesEnabled) return deny("cookies");

  let score = 60;
  const add = (points: number, reason: string) => { score += points; reasons.push(reason); };
  const screenPlausible = s.screen.width >= 240 && s.screen.height >= 240 &&
    s.screen.pixelRatio >= 0.5 && s.screen.pixelRatio <= 8 &&
    s.viewport.width >= 200 && s.viewport.height >= 160 &&
    s.screen.availableWidth > 0 && s.screen.availableHeight > 0;
  if (screenPlausible) add(6, "screen");
  // No narrow device whitelist: split-screen, zoom, privacy browsers and assistive devices are legitimate.
  if (s.visible) add(2, "visible");
  if (input.serverElapsedMs >= 900 && s.elapsedMs >= 900) add(3, "elapsed");
  if (s.interacted) add(2, "interaction");
  if (headers.get("accept-language")) add(3, "language-header");
  if (headers.get("sec-fetch-site") === "same-origin") add(3, "same-origin");
  if (headers.get("sec-fetch-mode") === "cors" || headers.get("sec-fetch-mode") === "same-origin") add(2, "fetch-mode");
  const acceptedLanguage = headers.get("accept-language")?.split(",")[0]?.split(";")[0]?.trim().toLowerCase();
  if (s.language && s.languages.includes(s.language) && acceptedLanguage?.split("-")[0] === s.language.toLowerCase().split("-")[0]) add(2, "locale-consistency");
  try {
    if (s.timezone && new Intl.DateTimeFormat("en", { timeZone: s.timezone }).resolvedOptions().timeZone) add(2, "timezone");
  } catch { /* Unknown timezones receive no bonus; they are not a hard rejection. */ }
  if (network.trusted && network.ip) add(4, "trusted-ip");
  if (network.country) add(1, "coarse-location");
  if (network.timezone === s.timezone) add(1, "timezone-consistency");
  if (network.botScore !== null && network.botScore >= 70) add(5, "edge-confidence");
  if (input.returningVisitor) add(4, "signed-previous-visit");
  return { score: Math.min(100, score), denied: false, reasons };
}
