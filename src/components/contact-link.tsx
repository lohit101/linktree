"use client";

import { IconArrowUpRight, IconBrandInstagram, IconMail, IconSparkle } from "@tabler/icons-react";
import type { Contact } from "@/lib/contracts";

const icons = { instagram: IconBrandInstagram, email: IconMail, subscription: IconSparkle };

export function ContactLink({ contact }: { contact: Contact }) {
  const Icon = icons[contact.kind];
  const external = contact.href.startsWith("https://");
  const report = () => {
    // The topic, credentials, User-Agent reporting window and provider request stay on the server.
    void fetch("/api/events/link", {
      method: "POST", credentials: "same-origin", keepalive: true, cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: contact.kind }),
    }).catch(() => {});
  };
  return <a className="contact-link" data-kind={contact.kind} href={contact.href}
    target={external ? "_blank" : undefined} rel="noopener noreferrer nofollow" referrerPolicy="no-referrer"
    onClick={report} onAuxClick={event => { if (event.button === 1) report(); }}>
    {contact.kind === "subscription" && <span className="subscription-effects" aria-hidden="true">
      {[1, 2, 3, 4].map(number => <IconSparkle key={number} className={`subscription-sparkle sparkle-${number}`} size={12} stroke={1.3} />)}
    </span>}
    <span className="contact-icon">{contact.iconEmoji ? <span className="contact-emoji" aria-hidden="true">{contact.iconEmoji}</span> : <Icon size={21} stroke={1.6} aria-hidden="true" />}</span>
    <span className="contact-copy"><span className="contact-label">{contact.label}</span><span className="contact-detail">{contact.detail}</span></span>
    <IconArrowUpRight className="contact-arrow" size={19} stroke={1.5} aria-hidden="true" />
  </a>;
}
