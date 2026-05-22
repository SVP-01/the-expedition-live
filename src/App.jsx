import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildIssueStats,
  buildState,
  formatDate,
  formatIssueLabel,
  makeId,
  nowIso,
  todayIso,
  weekStartIso,
  LOCAL_KEYS,
  REACTION_TAGS,
  RESOURCE_TYPES,
  ROLE_INFO,
  SECTIONS,
  splitList,
  visibleReactionLabel
} from "./zineState";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let supabaseClient = null;

async function getSupabase() {
  if (!hasSupabase) return null;
  if (!supabaseClient) {
    const { createClient } = await import("@supabase/supabase-js");
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeProfileRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role || "",
    displayName: row.display_name || row.displayName || "",
    avatarUrl: row.avatar_url || row.avatarUrl || "",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || ""
  };
}

function normalizeSupplyDropRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    mentorId: row.mentor_id || row.mentorId || "",
    menteeId: row.mentee_id || row.menteeId || "",
    title: row.title || "",
    url: row.url || "",
    priorityLevel: row.priority_level || row.priorityLevel || "medium",
    note: row.note || "",
    status: row.status || "pending",
    discardReason: row.discard_reason || row.discardReason || "",
    packedAt: row.packed_at || row.packedAt || null,
    discardedAt: row.discarded_at || row.discardedAt || null,
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || ""
  };
}

function normalizeTrailItemRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    menteeId: row.mentee_id || row.menteeId || "",
    sourceSupplyDropId: row.source_supply_drop_id || row.sourceSupplyDropId || "",
    title: row.title || "",
    url: row.url || "",
    priorityLevel: row.priority_level || row.priorityLevel || "medium",
    note: row.note || "",
    scheduledFor: row.scheduled_for || row.scheduledFor || todayIso(),
    status: row.status || "active",
    completedAt: row.completed_at || row.completedAt || null,
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || ""
  };
}

function normalizeFieldNoteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    menteeId: row.mentee_id || row.menteeId || "",
    trailItemId: row.trail_item_id || row.trailItemId || "",
    noteDate: row.note_date || row.noteDate || todayIso(),
    coreIdea: row.core_idea || row.coreIdea || "",
    energyScore: Number(row.energy_score ?? row.energyScore ?? 0),
    wantsDeeper: Boolean(row.wants_deeper ?? row.wantsDeeper ?? false),
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || ""
  };
}

function normalizeTransmissionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    mentorId: row.mentor_id || row.mentorId || "",
    fieldNoteId: row.field_note_id || row.fieldNoteId || "",
    body: row.body || "",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || ""
  };
}

function useSupabaseList(client, enabled, table, options = {}) {
  const {
    orderBy = "created_at",
    ascending = false,
    normalizer = (row) => row
  } = options;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let alive = true;
    let channel = null;

    if (!client || !enabled) {
      setRows([]);
      setLoading(false);
      setError("");
      return undefined;
    }

    const sync = async () => {
      const { data, error: queryError } = await client
        .from(table)
        .select("*")
        .order(orderBy, { ascending });

      if (!alive) return;

      if (queryError) {
        setRows([]);
        setError(queryError.message);
      } else {
        setRows(asArray(data).map(normalizer).filter(Boolean));
        setError("");
      }

      setLoading(false);
    };

    setLoading(true);
    sync();

    channel = client
      .channel(`${table}-expedition`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          sync();
        }
      )
      .subscribe();

    return () => {
      alive = false;
      if (channel) {
        client.removeChannel(channel);
      }
    };
  }, [client, enabled, table, orderBy, ascending, normalizer, revision]);

  return {
    rows,
    loading,
    error,
    refresh: () => setRevision((value) => value + 1)
  };
}

function computeRadarStats(fieldNotes, trailItems) {
  const notes = asArray(fieldNotes);
  const items = asArray(trailItems);
  const total = notes.length;
  const energized = notes.filter((note) => Number(note.energyScore) > 15).length;
  const drained = notes.filter((note) => Number(note.energyScore) < -15).length;
  const deeper = notes.filter((note) => note.wantsDeeper).length;
  const completed = items.filter((item) => item.status === "completed").length;
  const averageEnergy = total
    ? Math.round(notes.reduce((sum, note) => sum + Number(note.energyScore || 0), 0) / total)
    : 0;

  return {
    total,
    energized,
    drained,
    deeper,
    completed,
    averageEnergy
  };
}

function formatEnergyLabel(score) {
  if (score > 15) return "Energize";
  if (score < -15) return "Drain";
  return "Neutral";
}

function bandForScore(score) {
  if (score > 60) return "heat";
  if (score > 15) return "warm";
  if (score < -60) return "cold";
  if (score < -15) return "cool";
  return "neutral";
}

function resolveDisplayName(profile, role) {
  if (profile?.displayName) return profile.displayName;
  return ROLE_INFO[role]?.displayName || "";
}

function LoginScreen({
  onSignIn,
  authLoading,
  authError,
  hasSupabase: supabaseConfigured
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <main className="auth-shell expedition-backdrop">
      <section className="auth-card panel">
        <div className="eyebrow">The Expedition</div>
        <h1>Private mentorship, split into Trail and Basecamp.</h1>
        <p className="lede">
          Sign in to the role assigned to you in Supabase. Mentees go mobile-first on the Trail.
          Mentors get the desktop Basecamp dashboard.
        </p>

        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            onSignIn(email, password);
          }}
        >
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </label>

          <button className="button button-primary" type="submit" disabled={authLoading || !supabaseConfigured}>
            {authLoading ? "Signing in..." : "Enter the Expedition"}
          </button>

          {!supabaseConfigured ? (
            <p className="notice notice-warning">
              Supabase env vars are missing. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
              to `.env` to enable login.
            </p>
          ) : null}

          {authError ? <p className="notice notice-error">{authError}</p> : null}
        </form>
      </section>
    </main>
  );
}

function StatTile({ label, value, accent = "slate" }) {
  return (
    <div className={`stat-tile accent-${accent}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function SectionPanel({ eyebrow, title, description, children, className = "" }) {
  return (
    <section className={`panel section-panel ${className}`.trim()}>
      <header className="section-header">
        <div className="eyebrow">{eyebrow}</div>
        <div>
          <h2>{title}</h2>
          {description ? <p className="section-description">{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function SupplyDropCard({ drop, onAccept, onDiscard, showActions = true }) {
  return (
    <article className="resource-card">
      <div className="resource-topline">
        <span className={`pill priority-${drop.priorityLevel}`}>{drop.priorityLevel}</span>
        <span className={`pill status-${drop.status}`}>{drop.status}</span>
      </div>
      <h3>{drop.title}</h3>
      <a href={drop.url} target="_blank" rel="noreferrer" className="resource-link">
        {drop.url}
      </a>
      {drop.note ? <p className="resource-note">{drop.note}</p> : null}
      {drop.status === "discarded" && drop.discardReason ? (
        <p className="resource-note resource-note-muted">Discarded: {drop.discardReason}</p>
      ) : null}
      {drop.status === "pending" && showActions ? (
        <div className="row-actions">
          <button type="button" className="button button-primary" onClick={() => onAccept(drop)}>
            Accept into Compass
          </button>
          <button type="button" className="button button-secondary" onClick={() => onDiscard(drop)}>
            Discard
          </button>
        </div>
      ) : null}
    </article>
  );
}

function TrailItemCard({
  item,
  note,
  onSaveFieldNote,
  profileName
}) {
  const [coreIdea, setCoreIdea] = useState(note?.coreIdea || "");
  const [energyScore, setEnergyScore] = useState(note?.energyScore ?? 0);
  const [wantsDeeper, setWantsDeeper] = useState(note?.wantsDeeper ?? false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setCoreIdea(note?.coreIdea || "");
    setEnergyScore(note?.energyScore ?? 0);
    setWantsDeeper(note?.wantsDeeper ?? false);
  }, [note?.id]);

  return (
    <article className="field-note-card">
      <div className="resource-topline">
        <span className={`pill priority-${item.priorityLevel}`}>{item.priorityLevel}</span>
        <span className={`pill status-${item.status}`}>{item.status}</span>
      </div>
      <h3>{item.title}</h3>
      {item.url ? (
        <a href={item.url} target="_blank" rel="noreferrer" className="resource-link">
          {item.url}
        </a>
      ) : null}
      {item.note ? <p className="resource-note">{item.note}</p> : null}

      {note ? (
        <div className="note-summary">
          <div className="note-row">
            <span className={`energy-chip band-${bandForScore(note.energyScore)}`}>
              {formatEnergyLabel(note.energyScore)}
            </span>
            <span className="mini-copy">{note.wantsDeeper ? "Wants to go deeper" : "No deeper flag"}</span>
          </div>
          <p>{note.coreIdea}</p>
          {profileName ? <p className="mini-copy">Saved by {profileName}</p> : null}
        </div>
      ) : (
        <form
          className="stack note-composer"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            await onSaveFieldNote(item, {
              coreIdea,
              energyScore,
              wantsDeeper
            });
            setSaving(false);
          }}
        >
          <label className="field">
            <span>What was the core idea?</span>
            <textarea
              value={coreIdea}
              onChange={(event) => setCoreIdea(event.target.value)}
              rows={4}
              placeholder="One clear takeaway."
            />
          </label>

          <label className="field">
            <span>
              Did this energize or drain me? <strong>{energyScore}</strong>
            </span>
            <input
              type="range"
              min="-100"
              max="100"
              step="1"
              value={energyScore}
              onChange={(event) => setEnergyScore(Number(event.target.value))}
            />
            <div className="range-labels">
              <span>Drain</span>
              <span>Energize</span>
            </div>
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={wantsDeeper}
              onChange={(event) => setWantsDeeper(event.target.checked)}
            />
            <span>Do I want to go deeper?</span>
          </label>

          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? "Saving..." : "Stamp Field Note"}
          </button>
        </form>
      )}
    </article>
  );
}

function TransmissionCard({ note, item, mentorName, transmissions, onSendTransmission }) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <article className="transmission-card">
      <div className="resource-topline">
        <span className={`pill status-${item.status}`}>{item.status}</span>
        <span className="pill">Field Note</span>
      </div>
      <h3>{item.title}</h3>
      <p className="resource-note">{note.coreIdea}</p>
      <div className="note-row">
        <span className={`energy-chip band-${bandForScore(note.energyScore)}`}>
          {formatEnergyLabel(note.energyScore)}
        </span>
        <span className="mini-copy">{note.wantsDeeper ? "Push deeper" : "Hold the line"}</span>
      </div>

      <div className="transmission-thread">
        {asArray(transmissions).length ? (
          asArray(transmissions).map((transmission) => (
            <div className="transmission-bubble" key={transmission.id}>
              <p>{transmission.body}</p>
              <span className="mini-copy">{mentorName} · {formatDate(transmission.createdAt)}</span>
            </div>
          ))
        ) : (
          <p className="empty-copy">No transmissions yet. Leave the first comment.</p>
        )}
      </div>

      <form
        className="stack"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!body.trim()) return;
          setSaving(true);
          await onSendTransmission(note, body.trim());
          setBody("");
          setSaving(false);
        }}
      >
        <label className="field">
          <span>Radio Transmission</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={3}
            placeholder="Comment, question, or next push..."
          />
        </label>
        <button type="submit" className="button button-secondary" disabled={saving || !body.trim()}>
          {saving ? "Sending..." : "Transmit"}
        </button>
      </form>
    </article>
  );
}

function DiscardModal({ drop, reason, setReason, onClose, onConfirm, busy }) {
  if (!drop) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal panel" role="dialog" aria-modal="true" aria-labelledby="discard-title">
        <div className="eyebrow">Mandatory note</div>
        <h3 id="discard-title">Why are you discarding this supply drop?</h3>
        <p className="section-description">
          Add one sentence before this item clears from the intake pack.
        </p>
        <label className="field">
          <span>One sentence reason</span>
          <textarea
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What made this a no-go?"
          />
        </label>
        <div className="row-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={onConfirm}
            disabled={busy || !reason.trim()}
          >
            {busy ? "Discarding..." : "Clear Intake Pack"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoginInfo({ mentorName, menteeName }) {
  return (
    <div className="name-grid">
      <div className="name-card">
        <div className="eyebrow">Mentor</div>
        <strong>{mentorName}</strong>
      </div>
      <div className="name-card">
        <div className="eyebrow">Mentee</div>
        <strong>{menteeName}</strong>
      </div>
    </div>
  );
}

function TrailView({
  client,
  session,
  currentProfile,
  mentorProfile,
  menteeProfile,
  supplyDrops,
  trailItems,
  fieldNotes,
  transmissions,
  statusText,
  onSignOut,
  onAcceptDrop,
  onDiscardDrop,
  onSaveFieldNote
}) {
  const [drawer, setDrawer] = useState("compass");
  const [discardTarget, setDiscardTarget] = useState(null);
  const [discardReason, setDiscardReason] = useState("");
  const [discardBusy, setDiscardBusy] = useState(false);

  const currentUserId = session?.user?.id || "";
  const mentorName = resolveDisplayName(mentorProfile, "mentor");
  const menteeName = resolveDisplayName(menteeProfile, "mentee");

  const intakePack = useMemo(
    () =>
      asArray(supplyDrops)
        .filter((drop) => drop.menteeId === currentUserId && drop.status === "pending")
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [supplyDrops, currentUserId]
  );

  const compassItems = useMemo(
    () =>
      asArray(trailItems)
        .filter((item) => item.menteeId === currentUserId && item.status === "active")
        .sort((a, b) => {
          if (a.scheduledFor === b.scheduledFor) {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          }
          return a.scheduledFor.localeCompare(b.scheduledFor);
        }),
    [trailItems, currentUserId]
  );

  const completedItems = useMemo(
    () =>
      asArray(trailItems)
        .filter((item) => item.menteeId === currentUserId && item.status === "completed")
        .sort((a, b) => new Date(b.completedAt || b.updatedAt || b.createdAt).getTime() - new Date(a.completedAt || a.updatedAt || a.createdAt).getTime()),
    [trailItems, currentUserId]
  );

  const noteByTrailItemId = useMemo(() => {
    const map = {};
    asArray(fieldNotes).forEach((note) => {
      map[note.trailItemId] = note;
    });
    return map;
  }, [fieldNotes]);

  const transmissionCountByFieldNoteId = useMemo(() => {
    const map = {};
    asArray(transmissions).forEach((transmission) => {
      map[transmission.fieldNoteId] = (map[transmission.fieldNoteId] || 0) + 1;
    });
    return map;
  }, [transmissions]);

  const compassTabs = [
    { id: "compass", label: "Compass" },
    { id: "pack", label: "Intake Pack" },
    { id: "notes", label: "Field Notes" }
  ];

  const trailNoteItems = useMemo(
    () =>
      [...compassItems, ...completedItems].filter((item, index, self) => {
        return self.findIndex((other) => other.id === item.id) === index;
      }),
    [compassItems, completedItems]
  );

  return (
    <main className="app-shell trail-shell expedition-backdrop">
      <header className="hero-bar trail-hero">
        <div>
          <div className="eyebrow">The Trail</div>
          <h1>Mobile-first focus for the day’s climb.</h1>
          <p className="lede">
            {resolveDisplayName(currentProfile, "mentee")} is logged in. Keep the view tight, tactile,
            and action-oriented.
          </p>
        </div>
        <div className="hero-actions">
          <div className="role-pill role-mentee">Mentee</div>
          <button type="button" className="button button-ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {statusText ? <div className="status-banner">{statusText}</div> : null}

      <div className="trail-layout">
        <section className="mobile-tabs panel">
          <div className="tab-row">
            {compassTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`tab-button ${drawer === tab.id ? "active" : ""}`}
                onClick={() => setDrawer(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {(drawer === "compass" || drawer === "pack" || drawer === "notes") && (
          <div className="trail-stack">
            {drawer === "compass" ? (
              <SectionPanel
                eyebrow="Daily Focus"
                title="The Compass"
                description="A queue of active trail items for today."
              >
                <div className="stack">
                  {compassItems.length ? (
                    compassItems.map((item) => (
                      <article className="trail-card" key={item.id}>
                        <div className="resource-topline">
                          <span className={`pill priority-${item.priorityLevel}`}>{item.priorityLevel}</span>
                          <span className="pill">Today</span>
                        </div>
                        <h3>{item.title}</h3>
                        {item.url ? (
                          <a className="resource-link" href={item.url} target="_blank" rel="noreferrer">
                            Open resource
                          </a>
                        ) : null}
                        {item.note ? <p className="resource-note">{item.note}</p> : null}
                        {noteByTrailItemId[item.id] ? (
                          <div className="note-summary compact">
                            <span className={`energy-chip band-${bandForScore(noteByTrailItemId[item.id].energyScore)}`}>
                              {formatEnergyLabel(noteByTrailItemId[item.id].energyScore)}
                            </span>
                            <span className="mini-copy">Field note saved</span>
                          </div>
                        ) : (
                          <span className="mini-copy">Waiting on a field note.</span>
                        )}
                      </article>
                    ))
                  ) : (
                    <p className="empty-copy">Nothing active for today. Add a supply drop to the pack.</p>
                  )}
                </div>
              </SectionPanel>
            ) : null}

            {drawer === "pack" ? (
              <SectionPanel
                eyebrow="Intake Pack"
                title="Incoming supply drops"
                description="Accept to move resources into the Compass or discard with a required reason."
              >
                <div className="stack">
                  {intakePack.length ? (
                    intakePack.map((drop) => (
                      <SupplyDropCard
                        key={drop.id}
                        drop={drop}
                        onAccept={onAcceptDrop}
                        onDiscard={(target) => {
                          setDiscardTarget(target);
                          setDiscardReason("");
                        }}
                      />
                    ))
                  ) : (
                    <p className="empty-copy">No items in the Intake Pack right now.</p>
                  )}
                </div>
              </SectionPanel>
            ) : null}

            {drawer === "notes" ? (
              <SectionPanel
                eyebrow="Field Notes"
                title="Capture what landed"
                description="Record the core idea, the energy signal, and whether this should go deeper."
              >
                <div className="stack">
                  {trailNoteItems.length ? (
                    trailNoteItems.map((item) => (
                      <TrailItemCard
                        key={item.id}
                        item={item}
                        note={noteByTrailItemId[item.id] || null}
                        profileName={resolveDisplayName(currentProfile, "mentee")}
                        onSaveFieldNote={onSaveFieldNote}
                      />
                    ))
                  ) : (
                    <p className="empty-copy">Pack a resource before a field note can be stamped.</p>
                  )}
                </div>
              </SectionPanel>
            ) : null}
          </div>
        )}
      </div>

      <DiscardModal
        drop={discardTarget}
        reason={discardReason}
        setReason={setDiscardReason}
        busy={discardBusy}
        onClose={() => {
          setDiscardTarget(null);
          setDiscardReason("");
        }}
        onConfirm={async () => {
          if (!discardTarget || !discardReason.trim()) return;
          setDiscardBusy(true);
          await onDiscardDrop(discardTarget, discardReason.trim());
          setDiscardBusy(false);
          setDiscardTarget(null);
          setDiscardReason("");
        }}
      />
    </main>
  );
}

function BasecampView({
  client,
  session,
  currentProfile,
  mentorProfile,
  menteeProfile,
  supplyDrops,
  trailItems,
  fieldNotes,
  transmissions,
  statusText,
  onSignOut,
  onCreateSupplyDrop,
  onSendTransmission
}) {
  const [drawer, setDrawer] = useState("radar");
  const [form, setForm] = useState({
    title: "",
    url: "",
    priorityLevel: "medium",
    note: ""
  });
  const currentUserId = session?.user?.id || "";
  const mentorName = resolveDisplayName(mentorProfile, "mentor");
  const menteeName = resolveDisplayName(menteeProfile, "mentee");

  const fieldNoteIndex = useMemo(() => {
    const map = {};
    asArray(fieldNotes).forEach((note) => {
      map[note.trailItemId] = note;
    });
    return map;
  }, [fieldNotes]);

  const transmissionIndex = useMemo(() => {
    const map = {};
    asArray(transmissions).forEach((transmission) => {
      if (!map[transmission.fieldNoteId]) {
        map[transmission.fieldNoteId] = [];
      }
      map[transmission.fieldNoteId].push(transmission);
    });
    return map;
  }, [transmissions]);

  const radarStats = useMemo(() => computeRadarStats(fieldNotes, trailItems), [fieldNotes, trailItems]);

  const radarTabs = [
    { id: "radar", label: "Radar Deck" },
    { id: "drops", label: "Supply Drops" },
    { id: "radio", label: "Radio Transmissions" }
  ];

  const supplySummary = useMemo(() => {
    const rows = asArray(supplyDrops);
    return {
      pending: rows.filter((drop) => drop.status === "pending").length,
      packed: rows.filter((drop) => drop.status === "packed").length,
      discarded: rows.filter((drop) => drop.status === "discarded").length
    };
  }, [supplyDrops]);

  return (
    <main className="app-shell basecamp-shell expedition-backdrop">
      <header className="hero-bar basecamp-hero">
        <div>
          <div className="eyebrow">Basecamp</div>
          <h1>Desktop command center for the expedition lead.</h1>
          <p className="lede">
            {resolveDisplayName(currentProfile, "mentor")} is logged in. Keep the dashboard crisp,
            analytical, and map-like.
          </p>
        </div>
        <div className="hero-actions">
          <div className="role-pill role-mentor">Mentor</div>
          <button type="button" className="button button-ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {statusText ? <div className="status-banner">{statusText}</div> : null}

      <div className="basecamp-grid">
        <div className="basecamp-column">
          <SectionPanel
            eyebrow="Radar Deck"
            title="What the field notes are saying"
            description="Energize vs drain, deeper signals, and the tempo of the mentee’s curiosity."
          >
            <div className="radar-deck">
              <div className="radar-circle" style={{ "--energy": `${Math.min(100, Math.abs(radarStats.averageEnergy))}%` }}>
                <div className="radar-circle-inner">
                  <span className="radar-number">{radarStats.averageEnergy}</span>
                  <span className="mini-copy">avg energy</span>
                </div>
              </div>
              <div className="stat-grid">
                <StatTile label="Field notes" value={radarStats.total} accent="slate" />
                <StatTile label="Energize" value={radarStats.energized} accent="forest" />
                <StatTile label="Drain" value={radarStats.drained} accent="sandstone" />
                <StatTile label="Go deeper" value={radarStats.deeper} accent="mapblue" />
                <StatTile label="Completed trail items" value={radarStats.completed} accent="lake" />
              </div>
            </div>
          </SectionPanel>

          <SectionPanel
            eyebrow="Supply Drops"
            title="Send a resource to the pack"
            description="A clean form that sends a new item to the mentee’s Intake Pack."
          >
            <form
              className="stack"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!form.title.trim() || !form.url.trim()) return;
                await onCreateSupplyDrop(form);
                setForm({
                  title: "",
                  url: "",
                  priorityLevel: "medium",
                  note: ""
                });
              }}
            >
              <label className="field">
                <span>Title</span>
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Reading on portfolio narratives"
                />
              </label>
              <label className="field">
                <span>URL</span>
                <input
                  value={form.url}
                  onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                  placeholder="https://..."
                />
              </label>
              <div className="field-grid">
                <label className="field">
                  <span>Priority</span>
                  <select
                    value={form.priorityLevel}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, priorityLevel: event.target.value }))
                    }
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label className="field">
                  <span>Why I think you should look at this</span>
                  <textarea
                    rows={4}
                    value={form.note}
                    onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                    placeholder="What I want you to notice..."
                  />
                </label>
              </div>
              <button type="submit" className="button button-primary">
                Send Supply Drop
              </button>
            </form>
          </SectionPanel>
        </div>

        <div className="basecamp-column">
          <section className="panel">
            <div className="tab-row desktop-tabs">
              {radarTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`tab-button ${drawer === tab.id ? "active" : ""}`}
                  onClick={() => setDrawer(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </section>

          {drawer === "radar" ? (
            <SectionPanel
              eyebrow="Field Intelligence"
              title="Radar Deck detail"
              description="A quick scan of what is resonating."
            >
              <div className="deck-stack">
                <div className="deck-row">
                  <span>Mentor</span>
                  <strong>{mentorName}</strong>
                </div>
                <div className="deck-row">
                  <span>Mentee</span>
                  <strong>{menteeName}</strong>
                </div>
                <div className="deck-row">
                  <span>Supply drops pending</span>
                  <strong>{supplySummary.pending}</strong>
                </div>
                <div className="deck-row">
                  <span>Packaged into trail</span>
                  <strong>{supplySummary.packed}</strong>
                </div>
                <div className="deck-row">
                  <span>Discarded with reason</span>
                  <strong>{supplySummary.discarded}</strong>
                </div>
              </div>
            </SectionPanel>
          ) : null}

          {drawer === "drops" ? (
            <SectionPanel
              eyebrow="Live Supply Drops"
              title="All resources in motion"
              description="Monitor what has been sent, packed, or discarded."
            >
              <div className="stack">
                {asArray(supplyDrops).length ? (
                  asArray(supplyDrops).map((drop) => (
                    <SupplyDropCard
                      key={drop.id}
                      drop={drop}
                      showActions={false}
                      onAccept={() => {}}
                      onDiscard={() => {}}
                    />
                  ))
                ) : (
                  <p className="empty-copy">No supply drops yet.</p>
                )}
              </div>
            </SectionPanel>
          ) : null}

          {drawer === "radio" ? (
            <SectionPanel
              eyebrow="Radio Transmissions"
              title="Leave notes on the mentee’s field notes"
              description="Inline comments, suggestions, and probing questions in a permanently archived thread."
            >
              <div className="stack">
                {asArray(trailItems)
                  .filter((item) => item.menteeId === menteeProfile?.id)
                  .map((item) => {
                    const note = fieldNoteIndex[item.id];
                    if (!note) {
                      return (
                        <article className="empty-copy panel-slim" key={item.id}>
                          No field note yet for <strong>{item.title}</strong>.
                        </article>
                      );
                    }
                    return (
                      <TransmissionCard
                        key={note.id}
                        note={note}
                        item={item}
                        mentorName={mentorName}
                        transmissions={transmissionIndex[note.id]}
                        onSendTransmission={onSendTransmission}
                      />
                    );
                  })}
              </div>
            </SectionPanel>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function SetupMissingProfile({
  roleProfiles,
  onSignOut
}) {
  return (
    <main className="auth-shell expedition-backdrop">
      <section className="auth-card panel">
        <div className="eyebrow">Profile missing</div>
        <h1>Your Supabase auth session exists, but no matching profile row was found.</h1>
        <p className="lede">
          Make sure the `profiles` table has a row for this user and that the role is set to mentor or mentee.
        </p>
        <LoginInfo
          mentorName={resolveDisplayName(roleProfiles.find((profile) => profile.role === "mentor"), "mentor")}
          menteeName={resolveDisplayName(roleProfiles.find((profile) => profile.role === "mentee"), "mentee")}
        />
        <button type="button" className="button button-secondary" onClick={onSignOut}>
          Sign out
        </button>
      </section>
    </main>
  );
}

export default function App() {
  const [client, setClient] = useState(null);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [statusText, setStatusText] = useState("");
  const statusTimerRef = useRef(null);

  useEffect(() => {
    let alive = true;
    let subscription = null;

    async function init() {
      if (!hasSupabase) {
        setAuthReady(true);
        return;
      }

      const supabase = await getSupabase();
      if (!alive || !supabase) return;

      setClient(supabase);
      const { data } = await supabase.auth.getSession();
      if (alive) {
        setSession(data.session || null);
        setAuthReady(true);
      }

      const authChange = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (alive) {
          setSession(nextSession || null);
        }
      });
      subscription = authChange.data.subscription;
    }

    init();

    return () => {
      alive = false;
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const profiles = useSupabaseList(client, Boolean(session), "profiles", {
    orderBy: "created_at",
    ascending: true,
    normalizer: normalizeProfileRow
  }).rows;

  const supplyDrops = useSupabaseList(client, Boolean(session), "supply_drops", {
    orderBy: "created_at",
    ascending: false,
    normalizer: normalizeSupplyDropRow
  }).rows;

  const trailItems = useSupabaseList(client, Boolean(session), "trail_items", {
    orderBy: "created_at",
    ascending: false,
    normalizer: normalizeTrailItemRow
  }).rows;

  const fieldNotes = useSupabaseList(client, Boolean(session), "field_notes", {
    orderBy: "created_at",
    ascending: false,
    normalizer: normalizeFieldNoteRow
  }).rows;

  const transmissions = useSupabaseList(client, Boolean(session), "transmissions", {
    orderBy: "created_at",
    ascending: false,
    normalizer: normalizeTransmissionRow
  }).rows;

  const currentUserId = session?.user?.id || "";
  const currentProfile = useMemo(
    () => asArray(profiles).find((profile) => profile.id === currentUserId) || null,
    [profiles, currentUserId]
  );
  const mentorProfile = useMemo(
    () => asArray(profiles).find((profile) => profile.role === "mentor") || null,
    [profiles]
  );
  const menteeProfile = useMemo(
    () => asArray(profiles).find((profile) => profile.role === "mentee") || null,
    [profiles]
  );
  const role = currentProfile?.role || null;

  const splashStats = useMemo(() => {
    const today = todayIso();
    const items = asArray(trailItems);
    const notes = asArray(fieldNotes);
    const drops = asArray(supplyDrops);
    return {
      todayItems: items.filter((item) => item.scheduledFor === today && item.status === "active").length,
      pendingDrops: drops.filter((drop) => drop.status === "pending").length,
      completedNotes: notes.length,
      weekLabel: formatIssueLabel(weekStartIso())
    };
  }, [trailItems, fieldNotes, supplyDrops]);

  function flashStatus(message) {
    setStatusText(message);
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = setTimeout(() => {
      setStatusText("");
    }, 3500);
  }

  async function signIn(email, password) {
    if (!client) return;
    setAuthLoading(true);
    setAuthError("");
    const { error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    setAuthLoading(false);
    if (error) {
      setAuthError(error.message);
      return;
    }
    flashStatus("Signed in.");
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
    flashStatus("Signed out.");
  }

  async function createSupplyDrop(form) {
    if (!client || !currentUserId || !menteeProfile) return;
    const payload = {
      mentor_id: currentUserId,
      mentee_id: menteeProfile.id,
      title: form.title.trim(),
      url: form.url.trim(),
      priority_level: form.priorityLevel,
      note: form.note.trim(),
      status: "pending"
    };
    const { error } = await client.from("supply_drops").insert(payload);
    if (error) {
      flashStatus(error.message);
      return;
    }
    flashStatus("Supply drop sent.");
  }

  async function acceptDrop(drop) {
    if (!client || !currentUserId) return;
    const trailItemPayload = {
      mentee_id: currentUserId,
      source_supply_drop_id: drop.id,
      title: drop.title,
      url: drop.url,
      priority_level: drop.priorityLevel,
      note: drop.note,
      scheduled_for: todayIso(),
      status: "active"
    };
    const [trailResult, dropResult] = await Promise.all([
      client.from("trail_items").upsert(trailItemPayload, { onConflict: "source_supply_drop_id" }),
      client.from("supply_drops").update({ status: "packed", discard_reason: null }).eq("id", drop.id)
    ]);
    if (trailResult.error || dropResult.error) {
      flashStatus(trailResult.error?.message || dropResult.error?.message || "Unable to accept drop.");
      return;
    }
    flashStatus("Supply drop packed into the Compass.");
  }

  async function discardDrop(drop, reason) {
    if (!client || !currentUserId) return;
    const { error } = await client
      .from("supply_drops")
      .update({ status: "discarded", discard_reason: reason })
      .eq("id", drop.id);
    if (error) {
      flashStatus(error.message);
      return;
    }
    flashStatus("Supply drop cleared.");
  }

  async function saveFieldNote(item, draft) {
    if (!client || !currentUserId) return;
    const payload = {
      mentee_id: currentUserId,
      trail_item_id: item.id,
      note_date: todayIso(),
      core_idea: draft.coreIdea.trim(),
      energy_score: Number(draft.energyScore || 0),
      wants_deeper: Boolean(draft.wantsDeeper)
    };
    const { error: noteError } = await client.from("field_notes").upsert(payload, {
      onConflict: "trail_item_id"
    });
    if (noteError) {
      flashStatus(noteError.message);
      return;
    }
    await client.from("trail_items").update({ status: "completed", completed_at: nowIso() }).eq("id", item.id);
    flashStatus("Field note stamped.");
  }

  async function sendTransmission(note, body) {
    if (!client || !currentUserId) return;
    const payload = {
      mentor_id: currentUserId,
      field_note_id: note.id,
      body: body.trim()
    };
    const { error } = await client.from("transmissions").insert(payload);
    if (error) {
      flashStatus(error.message);
      return;
    }
    flashStatus("Transmission sent.");
  }

  if (!authReady) {
    return (
      <main className="auth-shell expedition-backdrop">
        <section className="auth-card panel">
          <div className="eyebrow">The Expedition</div>
          <h1>Loading secure session...</h1>
          <p className="lede">Connecting to Supabase and reading the user profile.</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <LoginScreen
        onSignIn={signIn}
        authLoading={authLoading}
        authError={authError}
        hasSupabase={hasSupabase}
      />
    );
  }

  if (!currentProfile) {
    return (
      <SetupMissingProfile
        roleProfiles={asArray(profiles)}
        onSignOut={signOut}
      />
    );
  }

  if (role === "mentee") {
    return (
      <TrailView
        client={client}
        session={session}
        currentProfile={currentProfile}
        mentorProfile={mentorProfile}
        menteeProfile={menteeProfile}
        supplyDrops={supplyDrops}
        trailItems={trailItems}
        fieldNotes={fieldNotes}
        transmissions={transmissions}
        statusText={statusText || `${splashStats.weekLabel} · ${splashStats.todayItems} active`}
        onSignOut={signOut}
        onAcceptDrop={acceptDrop}
        onDiscardDrop={discardDrop}
        onSaveFieldNote={saveFieldNote}
      />
    );
  }

  return (
    <BasecampView
      client={client}
      session={session}
      currentProfile={currentProfile}
      mentorProfile={mentorProfile}
      menteeProfile={menteeProfile}
      supplyDrops={supplyDrops}
      trailItems={trailItems}
      fieldNotes={fieldNotes}
      transmissions={transmissions}
      statusText={statusText || `${splashStats.weekLabel} · ${splashStats.pendingDrops} pending drops`}
      onSignOut={signOut}
      onCreateSupplyDrop={createSupplyDrop}
      onSendTransmission={sendTransmission}
    />
  );
}
