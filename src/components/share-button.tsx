"use client";

import { useEffect, useRef, useState } from "react";
import { IconCheck, IconShare2 } from "@tabler/icons-react";

export function ShareButton({ name }: { name: string }) {
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const share = async () => {
    try {
      // Strip query strings and fragments; never share a private API response or token.
      const url = `${location.origin}${location.pathname}`;
      if (navigator.share) await navigator.share({ title: name, url });
      else {
        await navigator.clipboard.writeText(url);
        setStatus("Link copied");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setStatus("Copy the address from your browser");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), 3500);
  };

  return <div className="share-wrapper">
    <button className="share-button" onClick={() => { void share(); }} aria-label="Share this page" title="Share this page">
      {status === "Link copied" ? <IconCheck size={19} stroke={1.7} /> : <IconShare2 size={19} stroke={1.7} />}
    </button>
    <span className="share-status" role="status">{status}</span>
  </div>;
}
