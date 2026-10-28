"use client";

import { useActionState, useState } from "react";
import { startRun } from "@/lib/actions";
import { LoadingOverlay } from "./loading-overlay";
import { Spinner } from "./submit-button";

export function StartRunForm() {
  const [error, action, pending] = useActionState(startRun, undefined);
  const [mode, setMode] = useState<"dry" | "live">("dry");
  return (
    <form action={action} className="mt-3 flex flex-wrap items-center gap-2">
      <select name="mode" value={mode} onChange={(e) => setMode(e.target.value as "dry" | "live")} className="input">
        <option value="dry">Dry run (sends nothing)</option>
        <option value="live">Live run (sends emails)</option>
      </select>
      <select name="runMode" defaultValue="economy" className="input" title="Economy uses far less Claude usage">
        <option value="economy">Economy (Sonnet for bulk work, 5 at once)</option>
        <option value="max">Max (all Opus, 16 at once, uses much more)</option>
      </select>
      <select name="hours" defaultValue={mode === "dry" ? "2" : "8"} key={mode} className="input">
        {["1", "2", "4", "6", "8", "10"].map((h) => (
          <option key={h} value={h}>{h} hours</option>
        ))}
      </select>
      {mode === "live" && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="confirm" value="yes" /> I understand this sends real emails from Tamanna&apos;s Gmail
        </label>
      )}
      <button className="btn" disabled={pending}>
        {pending && <Spinner />}
        {pending ? "Starting the agent…" : mode === "dry" ? "▶ Start dry run" : "▶ Start live run"}
      </button>
      {error && <p className="w-full text-sm text-critical">{error}</p>}
      {pending && <LoadingOverlay label="Starting the agent…" />}
    </form>
  );
}
