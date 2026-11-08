"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconChevronRight, IconRefresh } from "@tabler/icons-react";
import { solveBrowserWork, WORK_DIFFICULTY } from "@/lib/work";
import { ContactLink } from "./contact-link";
import type { AccessStart, BrowserSignals, PrivateProfile } from "@/lib/contracts";

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

export function ContactAccess() {
  const [phase, setPhase] = useState<"checking" | "ready" | "error" | "hidden">("checking");
  const [content, setContent] = useState<PrivateProfile | null>(null);
  const contacts = content?.contacts ?? [];
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
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
    let waitTimer: ReturnType<typeof setTimeout> | undefined;

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
        if (challenge.difficulty !== WORK_DIFFICULTY) throw new Error("Please refresh the page and try again.");
        const [, counter] = await Promise.all([
          new Promise<void>(resolve => { waitTimer = setTimeout(resolve, 1100); }),
          solveBrowserWork(challenge.nonce, controller.signal),
        ]);
        if (disposed) return;
        await getJson("/api/access/verify", controller.signal, {
          nonce: challenge.nonce, counter, website: honeypot.current?.value ?? "",
          signals: collectSignals(started.current, interacted.current),
        });
        const data = await getJson<PrivateProfile>("/api/contacts", controller.signal);
        ready(data);
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        setContent(null);
        setMessage(error instanceof Error ? error.message : "Couldn’t open these links. Please try again.");
        setPhase("error");
      }
    };

    // A short delay avoids unnecessary checks for visitors who immediately leave.
    const initialTimer = setTimeout(() => { void run(); }, attempt === 0 ? 600 : 0);
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(initialTimer);
      clearTimeout(waitTimer);
      if (expiration.current) clearTimeout(expiration.current);
    };
  }, [attempt]);

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
