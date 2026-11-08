import { z } from "zod";

// These observations are client-controlled, never proof of humanity.
export const browserSignalsSchema = z.object({
  screen: z.object({
    width: z.number().int().min(0).max(40000),
    height: z.number().int().min(0).max(40000),
    availableWidth: z.number().int().min(0).max(40000),
    availableHeight: z.number().int().min(0).max(40000),
    pixelRatio: z.number().min(0).max(20),
  }).strict(),
  viewport: z.object({
    width: z.number().int().min(0).max(40000),
    height: z.number().int().min(0).max(40000),
  }).strict(),
  timezone: z.string().max(100),
  timezoneOffset: z.number().int().min(-900).max(900),
  language: z.string().max(100),
  languages: z.array(z.string().max(100)).max(16),
  webdriver: z.boolean(),
  cookiesEnabled: z.boolean(),
  visible: z.boolean(),
  touchPoints: z.number().int().min(0).max(100),
  elapsedMs: z.number().min(0).max(86400000),
  interacted: z.boolean(),
}).strict();

export type BrowserSignals = z.infer<typeof browserSignalsSchema>;

export const verificationSchema = z.object({
  nonce: z.string().regex(/^[a-f0-9]{48}$/),
  counter: z.number().int().min(0).max(1048575),
  website: z.string().max(1000),
  signals: browserSignalsSchema,
}).strict();

export type Contact = {
  id: string;
  label: string;
  detail: string;
  iconEmoji?: string;
  href: string;
  kind: "email" | "instagram" | "subscription";
};

export type PrivateProfile = { contacts: Contact[]; bio: string | null };

export type AccessStart = {
  nonce: string;
  difficulty: number;
};
