"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconChevronRight, IconRefresh } from "@tabler/icons-react";
import { ContactLink } from "./contact-link";
import type { AccessStart, BrowserSignals, PrivateProfile } from "@/lib/contracts";

type Turnstile = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global { interface Window { turnstile?: Turnstile } }

let scriptPromise: Promise<Turnstile> | null = null;

function loadTurnstile(nonce: string): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.nonce = nonce;
    const fail = () => { script.remove(); scriptPromise = null; reject(new Error("Couldn’t finish the connection. Please try again.")); };
    const timeout = window.setTimeout(fail, 15000);
    script.onload = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile); else fail();
    };
    script.onerror = () => { window.clearTimeout(timeout); fail(); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

function collectSignals(started: number, interacted: boolean): BrowserSignals {
  return {
    screen: {
      width: screen.width, height: screen.height,
      availableWidth: screen.availWidth, availableHeight: screen.availHeight,
      pixelRatio: window.devicePixelRatio || 1,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    timezoneOffset: new Date().getTimezoneOffset(),
    language: navigator.language,
    languages: Array.from(navigator.languages).slice(0, 16),
    webdriver: navigator.webdriver === true,
    cookiesEnabled: navigator.cookieEnabled,
    visible: document.visibilityState === "visible",
    touchPoints: navigator.maxTouchPoints ?? 0,
    elapsedMs: Math.min(performance.now() - started, 86400000),
    interacted,
  };
}

async function getJson<T>(url: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin", cache: "no-store", signal,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Couldn’t open these links. Please try again.") as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data;
}

export function ContactAccess({ nonce }: { nonce: string }) {
  const [phase, setPhase] = useState<"checking" | "ready" | "error" | "hidden">("checking");
  const [content, setContent] = useState<PrivateProfile | null>(null);
  const contacts = content?.contacts ?? [];
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const widget = useRef<HTMLDivElement>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const interacted = useRef(false);
  const started = useRef(0);
  const expiration = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    started.current = performance.now();
    const record = () => { interacted.current = true; };
    const hide = () => { setContent(null); setPhase("hidden"); };
    const visibility = () => { if (document.hidden) hide(); };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) hide(); };
    window.addEventListener("pointerdown", record, { passive: true });
    window.addEventListener("keydown", record);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", pageShow);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pointerdown", record);
      window.removeEventListener("keydown", record);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", pageShow);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let widgetId: string | undefined;
    let turnstile: Turnstile | undefined;
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    let widgetTimer: ReturnType<typeof setTimeout> | undefined;

    const ready = (data: PrivateProfile) => {
      if (disposed || document.hidden) return;
      setContent(data);
      setPhase("ready");
      // Never leave private data in the DOM indefinitely or in a restored background tab.
      expiration.current = setTimeout(() => { setContent(null); setPhase("hidden"); }, 5 * 60 * 1000);
    };

    const run = async () => {
      setPhase("checking");
      setMessage("");
      try {
        try {
          const existing = await getJson<PrivateProfile>("/api/contacts", controller.signal);
          ready(existing);
          return;
        } catch (error) {
          if ((error as { status?: number }).status !== 401) throw error;
        }
        const challenge = await getJson<AccessStart>("/api/access/start", controller.signal, {});
        const wait = new Promise<void>(resolve => { waitTimer = setTimeout(resolve, 1100); });
        let token = "";
        if (!challenge.localDemo) {
          turnstile = await loadTurnstile(nonce);
          if (disposed || !widget.current) return;
          token = await new Promise<string>((resolve, reject) => {
            widgetTimer = setTimeout(() => reject(new Error("The connection timed out. Please try again.")), 120000);
            widgetId = turnstile!.render(widget.current!, {
              sitekey: challenge.siteKey, action: "contact_access", cData: challenge.nonce,
              theme: "dark", size: "flexible", appearance: "interaction-only", retry: "never",
              callback: (value: string) => { clearTimeout(widgetTimer); resolve(value); },
              "error-callback": () => { clearTimeout(widgetTimer); reject(new Error("Couldn’t finish the connection. Please try again.")); },
              "expired-callback": () => { clearTimeout(widgetTimer); reject(new Error("The connection expired. Please try again.")); },
              "timeout-callback": () => { clearTimeout(widgetTimer); reject(new Error("The connection timed out. Please try again.")); },
            });
          });
        }
        await wait;
        if (disposed) return;
        await getJson("/api/access/verify", controller.signal, {
          nonce: challenge.nonce, token, website: honeypot.current?.value ?? "",
          signals: collectSignals(started.current, interacted.current),
        });
        const data = await getJson<PrivateProfile>("/api/contacts", controller.signal);
        ready(data);
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        setContent(null);
        setMessage(error instanceof Error ? error.message : "Couldn’t open these links. Please try again.");
        setPhase("error");
      } finally {
        if (widgetId) turnstile?.remove(widgetId);
      }
    };

    // A short delay avoids unnecessary checks for visitors who immediately leave.
    const initialTimer = setTimeout(() => { void run(); }, attempt === 0 ? 600 : 0);
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(initialTimer);
      clearTimeout(waitTimer);
      clearTimeout(widgetTimer);
      if (expiration.current) clearTimeout(expiration.current);
      if (widgetId) turnstile?.remove(widgetId);
    };
  }, [attempt, nonce]);

  const hide = async () => {
    setContent(null);
    setPhase("hidden");
    try { await fetch("/api/access/end", { method: "POST", credentials: "same-origin" }); } catch { /* Already hidden locally. */ }
  };

  return (
    <section className="contact-section" aria-labelledby="connect-heading">
      {phase === "ready" && content?.bio && <p className="private-bio" aria-live="polite">{content.bio}</p>}
      <div className="section-heading">
        <h2 id="connect-heading">A little more from me</h2>
        {phase === "ready" && contacts.length > 0 && <span className="connection-note"><IconCheck size={14} stroke={1.7} aria-hidden="true" /> You’re in</span>}
      </div>
      <div className="honey-field" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input ref={honeypot} id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>
      <div ref={widget} className="challenge-container" />
      <div aria-live="polite" aria-atomic="true">
        {phase === "checking" && <div className="connection-loading" role="status">
          <span className="loading-line" /><span className="loading-line short" />
          <span className="loading-caption">Opening my links…</span>
        </div>}
        {phase === "error" && <div className="connection-error">
          <p>{message}</p>
          <button className="retry-button" onClick={() => setAttempt(value => value + 1)}><IconRefresh size={17} stroke={1.7} aria-hidden="true" /> Try again</button>
        </div>}
        {phase === "hidden" && <button className="reveal-button" onClick={() => setAttempt(value => value + 1)}>
          <span>View my links</span><IconChevronRight size={20} stroke={1.7} aria-hidden="true" />
        </button>}
        {phase === "ready" && contacts.length === 0 && <p className="empty-message">More ways to connect are coming soon.</p>}
      </div>
      {phase === "ready" && contacts.length > 0 && <div className="contact-list">
        {contacts.map(contact => <ContactLink key={contact.id} contact={contact} />)}
        <button className="hide-links" onClick={() => { void hide(); }}>Hide links</button>
      </div>}
    </section>
  );
}
