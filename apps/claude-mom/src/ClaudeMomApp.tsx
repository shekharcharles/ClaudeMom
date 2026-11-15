import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, Download, Eye, EyeOff, Loader2, Play, Plus, RefreshCw, ShieldCheck, Square, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  IMPORT_SOURCES,
  SOURCE_LABELS,
  WINDOW_PRESETS,
  claudeState,
  emptyProfile,
  formatWindow,
  hostOf,
  isOk,
  modelLabel,
  normalizeModels,
  profileProblem,
  setupSteps,
  type ClaudeConfig,
  type ClaudeStatus,
  type CommandResult,
  type UpstreamBook,
  type UpstreamModel,
  type UpstreamProfile,
} from "./model";
import { checkForUpdate, currentVersion, installUpdate, type UpdateState } from "./updates";

type Tab = "upstream" | "claude";
type Notice = { text: string; tone: "ok" | "error" } | null;
type ClaudeAction = "launch" | "stop" | "trust" | "untrust" | "prepare" | "sync_sessions";

const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function ClaudeMomApp() {
  const [book, setBook] = useState<UpstreamBook>({ profiles: [], activeId: null });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UpstreamProfile | null>(null);
  const [status, setStatus] = useState<ClaudeStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [tab, setTab] = useState<Tab>("upstream");
  const pending = useRef(false);

  const say = (text: string, tone: "ok" | "error" = "ok") => setNotice(text ? { text, tone } : null);
  // English localization maintenance note.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.tone === "error" ? 12000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<UpdateState>({ phase: "idle" });

  // English localization maintenance note.
  useEffect(() => {
    void currentVersion().then(setVersion);
    const timer = setTimeout(() => {
      void checkForUpdate().then((result) => {
        if (result.phase === "available") setUpdate(result);
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const runUpdateCheck = async () => {
    setUpdate({ phase: "checking" });
    const result = await checkForUpdate();
    setUpdate(result);
    if (result.phase === "failed") say(`Update check failed: ${result.message}`, "error");
  };

  const runInstall = async () => {
    if (update.phase !== "available") return;
    const { update: pending, version: target } = update;
    setUpdate({ phase: "downloading", version: target, percent: null });
    try {
      await installUpdate(pending, (percent) => setUpdate({ phase: "downloading", version: target, percent }));
    } catch (cause) {
      setUpdate({ phase: "failed", message: errorText(cause) });
      say(`Update failed: ${errorText(cause)}`, "error");
    }
  };

  const acceptBook = useCallback((result: CommandResult<UpstreamBook>, keepSelection?: string | null) => {
    const next = { profiles: result.profiles ?? [], activeId: result.activeId ?? null };
    setBook(next);
    const wanted = keepSelection ?? null;
    const target = next.profiles.find((profile) => profile.id === wanted) ?? next.profiles.find((profile) => profile.id === next.activeId) ?? next.profiles[0] ?? null;
    setSelectedId(target?.id ?? null);
    setDraft(target ? { ...target } : null);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const result = await invoke<CommandResult<ClaudeStatus>>("claude_local_status");
      if (isOk(result)) setStatus(result);
      else say(result.message, "error");
    } catch (cause) {
      say(errorText(cause), "error");
    }
  }, []);

  // English localization maintenance note.
  useEffect(() => {
    void (async () => {
      try {
        const result = await invoke<CommandResult<UpstreamBook>>("claude_mom_load");
        acceptBook(result);
        if (!isOk(result)) say(result.message, "error");
      } catch (cause) {
        say(errorText(cause), "error");
      }
      await refreshStatus();
    })();
  }, [acceptBook, refreshStatus]);

  // Claude English localization maintenance note.
  useEffect(() => {
    if ((!status?.running && !status?.claudeRunning) || busy) return;
    const timer = setInterval(() => void refreshStatus(), 3000);
    return () => clearInterval(timer);
  }, [status?.running, status?.claudeRunning, busy, refreshStatus]);

  /** English localization maintenance note. */
  const run = async <T,>(label: string, task: () => Promise<T>): Promise<T | undefined> => {
    if (pending.current) return undefined;
    pending.current = true;
    setBusy(label);
    try {
      return await task();
    } catch (cause) {
      say(errorText(cause), "error");
      return undefined;
    } finally {
      pending.current = false;
      setBusy(null);
    }
  };

  const claudeAction = (action: ClaudeAction) =>
    run(action, async () => {
      const result = await invoke<CommandResult<ClaudeStatus>>("claude_local_action", { action });
      if (isOk(result)) setStatus(result);
      say(result.message, isOk(result) ? "ok" : "error");
    });

  const configure = (patch: Partial<ClaudeConfig>) =>
    run("configure", async () => {
      if (!status) return;
      const config = { ...status.config, ...patch, enabled: true };
      const result = await invoke<CommandResult<ClaudeStatus>>("claude_local_configure", { config });
      if (isOk(result)) setStatus(result);
      else say(result.message, "error");
    });

  // English localization maintenance note.
  const setVoice = (enabled: boolean) =>
    run("voice", async () => {
      const result = await invoke<CommandResult<ClaudeStatus>>("claude_mom_set_voice", { enabled });
      if (isOk(result)) setStatus(result);
      say(result.message, isOk(result) ? "ok" : "error");
    });

  const bookCall = (label: string, command: string, args: Record<string, unknown>, keep?: string | null) =>
    run(label, async () => {
      const result = await invoke<CommandResult<UpstreamBook>>(command, args);
      acceptBook(result, keep);
      say(result.message, isOk(result) ? "ok" : "error");
      await refreshStatus();
      return result;
    });

  const active = book.profiles.find((profile) => profile.id === book.activeId) ?? null;
  const dirty = useMemo(() => {
    if (!draft) return false;
    const saved = book.profiles.find((profile) => profile.id === draft.id);
    return !saved || JSON.stringify(saved) !== JSON.stringify(draft);
  }, [book, draft]);

  const select = (id: string) => {
    const profile = book.profiles.find((item) => item.id === id);
    if (!profile) return;
    setSelectedId(id);
    setDraft({ ...profile });
    setTab("upstream");
  };

  const addProfile = () => {
    setSelectedId(null);
    setDraft(emptyProfile());
    setTab("upstream");
  };

  const saveDraft = async (activate: boolean) => {
    if (!draft) return;
    const problem = profileProblem(draft);
    if (problem) return say(problem, "error");
    const profile = { ...draft, models: normalizeModels(draft.models, draft.model) };
    const result = await bookCall("save", "claude_mom_save_profile", { profile, activate }, draft.id || undefined);
    // English localization maintenance note.
    if (result && isOk(result) && !draft.id) {
      const created = [...(result.profiles ?? [])].reverse().find((item) => item.baseUrl === profile.baseUrl.trim().replace(/\/+$/, ""));
      if (created) {
        setSelectedId(created.id);
        setDraft({ ...created });
      }
    }
  };

  const fetchModels = () =>
    run("models", async () => {
      if (!draft) return;
      const result = await invoke<CommandResult<{ models: UpstreamModel[] }>>("claude_mom_fetch_models", { baseUrl: draft.baseUrl, apiKey: draft.apiKey });
      if (!isOk(result)) return say(result.message, "error");
      const ids = result.models.map((model) => model.id);
      setDraft((current) => {
        if (!current) return current;
        const model = current.model || ids[0] || "";
        const window = result.models.find((item) => item.id === model)?.contextWindow ?? current.contextWindow;
        const names = Object.fromEntries(result.models.filter((item) => item.displayName).map((item) => [item.id, item.displayName as string]));
        return { ...current, models: normalizeModels(ids, model), model, contextWindow: window ?? null, modelNames: { ...current.modelNames, ...names } };
      });
      say(result.message);
    });

  const state = claudeState(status, busy === "launch" || busy === "stop" ? busy : null);
  const steps = setupSteps(status, active);
  const canLaunch = Boolean(status?.supported && status.nodeAvailable && status.caTrusted && active && !profileProblem(active));
  const showStop = Boolean(status?.running || status?.localProcess);

  return (
    <div className="cm-shell">
      <aside className="cm-side">
        <div className="cm-side-head" data-tauri-drag-region>
          <span className="cm-brand">ClaudeMom</span>
        </div>
        <div className="cm-side-label">Provider</div>
        <nav className="cm-list" aria-label="Provider">
          {book.profiles.map((profile) => (
            <button
              aria-current={profile.id === selectedId ? "true" : undefined}
              className="cm-item"
              key={profile.id}
              onClick={() => select(profile.id)}
              onDoubleClick={() => void bookCall("activate", "claude_mom_set_active", { id: profile.id }, profile.id)}
              title="Double-click to activate"
              type="button"
            >
              <span className="cm-radio" data-on={profile.id === book.activeId || undefined} />
              <span className="cm-item-text">
                <span className="cm-item-name">{profile.name || hostOf(profile.baseUrl)}</span>
                <span className="cm-item-sub">{profile.model ? modelLabel(profile, profile.model) : hostOf(profile.baseUrl)}</span>
              </span>
              {profile.source !== "manual" ? <span className="cm-tag">{SOURCE_LABELS[profile.source] ?? profile.source}</span> : null}
            </button>
          ))}
          {draft && !draft.id ? (
            <div className="cm-item" aria-current="true">
              <span className="cm-radio" />
              <span className="cm-item-text"><span className="cm-item-name">New provider</span><span className="cm-item-sub">Unsaved</span></span>
            </div>
          ) : null}
          {!book.profiles.length && !draft ? <p className="cm-empty">No providers yet. Add one manually or import from cc-switch / Magpie / Codex++.</p> : null}
        </nav>
        <div className="cm-side-foot">
          <button className="cm-btn cm-btn-quiet" onClick={addProfile} type="button"><Plus />Add</button>
          <ImportMenu disabled={busy !== null} onPick={(source) => void bookCall("import", "claude_mom_import", { source }, selectedId)} />
        </div>
      </aside>

      <main className="cm-main">
        <header className="cm-toolbar" data-tauri-drag-region>
          <span className="cm-dot" data-tone={state.tone} />
          <div className="cm-toolbar-text" data-tauri-drag-region>
            <strong>{state.text}</strong>
            <span>
              {!status?.supported && status ? "Install the official Claude Desktop first" : active ? `${active.name} · ${active.model ? modelLabel(active, active.model) : "No model selected"}` : "No provider configured"}
            </span>
          </div>
          <div className="cm-toolbar-actions">
            <button aria-label="Check again" className="cm-icon" disabled={busy !== null} onClick={() => void run("detect", refreshStatus)} title="Check again" type="button">
              <RefreshCw className={busy === "detect" ? "cm-spin" : undefined} />
            </button>
            {showStop ? (
              <button className="cm-btn" disabled={busy !== null} onClick={() => void claudeAction("stop")} type="button"><Square />Stop</button>
            ) : null}
            <button className="cm-btn cm-btn-primary" disabled={busy !== null || !canLaunch || Boolean(status?.claudeRunning)} onClick={() => void claudeAction("launch")} title={status?.claudeRunning ? "Quit Claude completely before launching" : undefined} type="button">
              {busy === "launch" ? <Loader2 className="cm-spin" /> : <Play />}Launch Claude
            </button>
          </div>
        </header>

        {steps.length || status?.needsRestart || status?.warning ? (
          <div className="cm-banners">
            {steps.map((step) => (
              <div className="cm-banner" key={step.id}>
                <span>{step.text}</span>
                {step.id === "trust" ? (
                  <button className="cm-btn cm-btn-small" disabled={busy !== null} onClick={() => void claudeAction("trust")} type="button"><ShieldCheck />Trust certificate</button>
                ) : step.id === "upstream" && !draft ? (
                  <button className="cm-btn cm-btn-small" onClick={addProfile} type="button"><Plus />Add provider</button>
                ) : null}
              </div>
            ))}
            {status?.needsRestart ? <div className="cm-banner" data-tone="info"><span>Settings changed. Quit Claude completely and relaunch to apply.</span></div> : null}
            {status?.warning && !steps.length ? <div className="cm-banner"><span>{status.warning}</span></div> : null}
          </div>
        ) : null}

        <div className="cm-tabs" role="tablist">
          <button aria-selected={tab === "upstream"} onClick={() => setTab("upstream")} role="tab" type="button">Provider</button>
          <button aria-selected={tab === "claude"} onClick={() => setTab("claude")} role="tab" type="button">Claude settings</button>
        </div>

        <section className="cm-body">
          {tab === "upstream" ? (
            draft ? (
              <UpstreamEditor
                active={draft.id !== "" && draft.id === book.activeId}
                busy={busy}
                dirty={dirty}
                draft={draft}
                onActivate={() => void bookCall("activate", "claude_mom_set_active", { id: draft.id }, draft.id)}
                onChange={setDraft}
                onDelete={() => void bookCall("delete", "claude_mom_delete_profile", { id: draft.id })}
                onDiscard={() => {
                  const saved = book.profiles.find((profile) => profile.id === draft.id);
                  if (saved) setDraft({ ...saved });
                  else acceptBook({ ...book, status: "ok", message: "" });
                }}
                onFetchModels={() => void fetchModels()}
                onSave={(activate) => void saveDraft(activate)}
              />
            ) : (
              <div className="cm-placeholder">
                <p>Select a provider or create a new one.</p>
                <button className="cm-btn" onClick={addProfile} type="button"><Plus />Add provider</button>
              </div>
            )
          ) : (
            <ClaudeSettings
              busy={busy}
              onAction={(action) => void claudeAction(action)}
              onConfigure={(patch) => void configure(patch)}
              onVoice={(enabled) => void setVoice(enabled)}
              status={status}
              update={update}
              version={version}
              onCheckUpdate={() => void runUpdateCheck()}
              onInstallUpdate={() => void runInstall()}
            />
          )}
        </section>

        <footer className="cm-status">
          <span>{status?.port ? `Local service · Port ${status.port}` : "Local service not running"}</span>
          {update.phase === "available" ? (
            <button className="cm-update-chip" onClick={() => void runInstall()} type="button">New version {update.version}, click to update</button>
          ) : update.phase === "downloading" ? (
            <span className="cm-update-chip">Updating to {update.version}{update.percent != null ? ` · ${update.percent}%` : "…"}</span>
          ) : null}
          {notice ? (
            <span className="cm-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
              {notice.text}
              <button aria-label="Dismiss notification" onClick={() => setNotice(null)} type="button"><X /></button>
            </span>
          ) : null}
        </footer>
      </main>
    </div>
  );
}

function ImportMenu({ disabled, onPick }: { disabled: boolean; onPick: (source: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="cm-menu-anchor" ref={ref}>
      <button aria-expanded={open} className="cm-btn cm-btn-quiet" disabled={disabled} onClick={() => setOpen((value) => !value)} type="button">
        <Download />Import<ChevronDown className="cm-chevron" />
      </button>
      {open ? (
        <div className="cm-menu" role="menu">
          {IMPORT_SOURCES.map((source) => (
            <button key={source.id} onClick={() => { setOpen(false); onPick(source.id); }} role="menuitem" type="button">
              <strong>{source.label}</strong>
              <span>{source.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="cm-field">
      <span className="cm-field-label">{label}</span>
      <span className="cm-field-control">{children}</span>
      {hint ? <span className="cm-field-hint">{hint}</span> : null}
    </label>
  );
}

function UpstreamEditor({ draft, active, dirty, busy, onChange, onSave, onActivate, onDelete, onDiscard, onFetchModels }: {
  draft: UpstreamProfile;
  active: boolean;
  dirty: boolean;
  busy: string | null;
  onChange: (next: UpstreamProfile) => void;
  onSave: (activate: boolean) => void;
  onActivate: () => void;
  onDelete: () => void;
  onDiscard: () => void;
  onFetchModels: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [newModel, setNewModel] = useState("");
  // English localization maintenance note.
  const [editConnection, setEditConnection] = useState(!draft.id || !draft.baseUrl);
  useEffect(() => setEditConnection(!draft.id || !draft.baseUrl), [draft.id]);
  const set = (patch: Partial<UpstreamProfile>) => onChange({ ...draft, ...patch });
  const preset = WINDOW_PRESETS.find((item) => item.value === draft.contextWindow);
  const options = draft.model && !draft.models.includes(draft.model) ? [draft.model, ...draft.models] : draft.models;
  const addModel = () => {
    const model = newModel.trim();
    if (!model) return;
    set({ models: normalizeModels([...draft.models, model]), model: draft.model || model });
    setNewModel("");
  };
  return (
    <div className="cm-editor">
      <div className="cm-editor-head">
        <input aria-label="Name" className="cm-title-input" onChange={(event) => set({ name: event.currentTarget.value })} placeholder={hostOf(draft.baseUrl) || "New provider"} value={draft.name} />
        {active ? <span className="cm-tag" data-tone="ok"><Check />Active</span> : null}
      </div>

      <section className="cm-card">
        <div className="cm-card-label">Connection</div>
        {editConnection ? (
          <div className="cm-form">
            <Field label="Base URL">
              <input autoComplete="off" onChange={(event) => set({ baseUrl: event.currentTarget.value })} placeholder="https://api.example.com" spellCheck={false} value={draft.baseUrl} />
            </Field>
            <Field label="Key">
              <input autoComplete="off" onChange={(event) => set({ apiKey: event.currentTarget.value })} placeholder="sk-…" spellCheck={false} type={showKey ? "text" : "password"} value={draft.apiKey} />
              <button aria-label={showKey ? "Hide API key" : "Show API key"} className="cm-icon" onClick={() => setShowKey((value) => !value)} type="button">{showKey ? <EyeOff /> : <Eye />}</button>
            </Field>
          </div>
        ) : (
          <div className="cm-card-line">
            <span className="cm-mono cm-ellipsis" title={draft.baseUrl}>{draft.baseUrl}</span>
            {draft.source !== "manual" ? <span className="cm-tag">Imported from {SOURCE_LABELS[draft.source] ?? draft.source}</span> : null}
            <button className="cm-link" onClick={() => setEditConnection(true)} type="button">Edit</button>
          </div>
        )}
      </section>

      <section className="cm-card">
        <div className="cm-card-label">Model</div>
        <div className="cm-card-line">
          {options.length ? (
            <select aria-label="Default model" className="cm-grow" onChange={(event) => set({ model: event.currentTarget.value })} value={draft.model}>
              {!draft.model ? <option value="">Choose a default model</option> : null}
              {options.map((model) => <option key={model} value={model}>{modelLabel(draft, model)}</option>)}
            </select>
          ) : (
            <input aria-label="Default model" className="cm-grow" onChange={(event) => set({ model: event.currentTarget.value })} placeholder="Fetch models or enter a model ID" spellCheck={false} value={draft.model} />
          )}
          <button aria-label="Fetch models" className="cm-icon" disabled={busy !== null || !draft.baseUrl.trim()} onClick={onFetchModels} title="Fetch models from provider" type="button">
            {busy === "models" ? <Loader2 className="cm-spin" /> : <RefreshCw />}
          </button>
        </div>
        {draft.models.length > 1 ? <p className="cm-field-hint">Claude can also switch between {draft.models.length - 1} other models.</p> : null}
      </section>

      <details className="cm-more">
        <summary>Advanced</summary>
        <div className="cm-form">
          <Field hint="For small tasks such as title generation; leave blank to use the default model" label="Fast model">
            <select onChange={(event) => set({ smallModel: event.currentTarget.value })} value={draft.smallModel}>
              <option value="">Same as default model</option>
              {options.map((model) => <option key={model} value={model}>{modelLabel(draft, model)}</option>)}
            </select>
          </Field>
          <Field label="Context window">
            <select onChange={(event) => set({ contextWindow: event.currentTarget.value === "" ? null : Number(event.currentTarget.value) })} value={draft.contextWindow == null ? "" : String(draft.contextWindow)}>
              {WINDOW_PRESETS.map((item) => <option key={item.label} value={item.value == null ? "" : String(item.value)}>{item.label}</option>)}
              {!preset && draft.contextWindow ? <option value={String(draft.contextWindow)}>{formatWindow(draft.contextWindow)}</option> : null}
            </select>
          </Field>
          <div className="cm-field">
            <span className="cm-field-label">Available models</span>
            <div className="cm-chips">
              {draft.models.map((model) => (
                <span className="cm-chip" data-primary={model === draft.model || undefined} key={model}>
                  <button onClick={() => set({ model })} title={`${model} (click to set default)`} type="button">{modelLabel(draft, model)}</button>
                  <button aria-label={`Remove ${model}`} onClick={() => set({ models: draft.models.filter((item) => item !== model), model: draft.model === model ? "" : draft.model })} type="button"><X /></button>
                </span>
              ))}
              <input
                aria-label="AddModel"
                className="cm-chip-input"
                onChange={(event) => setNewModel(event.currentTarget.value)}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addModel(); } }}
                placeholder="Add a model and press Enter"
                spellCheck={false}
                value={newModel}
              />
            </div>
          </div>
          {draft.id ? (
            <div className="cm-row-actions">
              <button className="cm-btn cm-btn-small cm-btn-danger" disabled={busy !== null} onClick={onDelete} type="button"><Trash2 />Delete provider</button>
            </div>
          ) : null}
        </div>
      </details>

      {dirty || (draft.id && !active) ? (
        <div className="cm-editor-foot">
          <span className="cm-spacer" />
          {dirty ? <button className="cm-btn cm-btn-quiet" disabled={busy !== null} onClick={onDiscard} type="button">Discard changes</button> : null}
          {!dirty && draft.id && !active ? <button className="cm-btn cm-btn-primary" disabled={busy !== null} onClick={onActivate} type="button">Use this provider</button> : null}
          {dirty ? <button className="cm-btn" disabled={busy !== null} onClick={() => onSave(false)} type="button">Save</button> : null}
          {dirty ? <button className="cm-btn cm-btn-primary" disabled={busy !== null} onClick={() => onSave(true)} type="button">Save and activate</button> : null}
        </div>
      ) : null}
    </div>
  );
}

function Toggle({ label, detail, hint, checked, disabled, onChange }: { label: string; detail?: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="cm-toggle-row" title={detail}>
      <span className="cm-toggle-text">
        <span>{label}</span>
        {hint ? <span className="cm-field-hint">{hint}</span> : null}
      </span>
      <input checked={checked} disabled={disabled} onChange={(event) => onChange(event.currentTarget.checked)} type="checkbox" />
      <span aria-hidden="true" className="cm-switch" />
    </label>
  );
}

type ModelState = { modelReady: boolean; phase?: string; completedBytes?: number; totalBytes?: number; message?: string };

/** English localization maintenance note. */
function VoiceModel({ onReady }: { onReady: () => void }) {
  const [state, setState] = useState<ModelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { setState(await invoke<ModelState>("dictation_local_model_status")); } catch (cause) { setError(errorText(cause)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const downloading = state?.phase === "downloading";
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [downloading, refresh]);
  const download = async () => {
    setError(null);
    setState((current) => ({ ...(current ?? { modelReady: false }), phase: "downloading", completedBytes: 0 }));
    try {
      const result = await invoke<CommandResult<ModelState>>("download_dictation_local_model");
      if (!isOk(result)) setError(result.message);
      else onReady();
    } catch (cause) {
      setError(errorText(cause));
    }
    await refresh();
  };
  if (!state) return null;
  const percent = state.totalBytes ? Math.min(100, Math.round(((state.completedBytes ?? 0) / state.totalBytes) * 100)) : 0;
  return (
    <div className="cm-row-actions cm-voice-model">
      <span className="cm-field-hint">
        {state.modelReady ? "Local voice model (SenseVoice) is ready." : downloading ? `Downloading local voice model… ${percent}%` : "Download the local voice model first (SenseVoice, about 230 MB)."}
        {error ? ` ${error}` : ""}
      </span>
      {!state.modelReady && !downloading ? <button className="cm-btn cm-btn-small" onClick={() => void download()} type="button"><Download />Download model</button> : null}
      {downloading ? <Loader2 className="cm-spin" /> : null}
    </div>
  );
}

function ClaudeSettings({ status, busy, onConfigure, onAction, onVoice, update, version, onCheckUpdate, onInstallUpdate }: {
  status: ClaudeStatus | null;
  busy: string | null;
  onConfigure: (patch: Partial<ClaudeConfig>) => void;
  onAction: (action: ClaudeAction) => void;
  onVoice: (enabled: boolean) => void;
  update: UpdateState;
  version: string;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
}) {
  if (!status) return <div className="cm-placeholder"><Loader2 className="cm-spin" /></div>;
  const config = status.config;
  const disabled = busy !== null || !status.supported;
  const text = (key: "displayName" | "email", placeholder: string, label: string, type = "text") => (
    <Field label={label}>
      <input
        defaultValue={config[key] ?? ""}
        disabled={disabled}
        key={config[key] ?? ""}
        onBlur={(event) => { if (event.currentTarget.value !== (config[key] ?? "")) onConfigure({ [key]: event.currentTarget.value }); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        placeholder={placeholder}
        type={type}
      />
    </Field>
  );
  return (
    <div className="cm-settings">
      <section className="cm-card">
        <Toggle checked={config.localization} disabled={disabled} label="Chinese interface translation" onChange={(next) => onConfigure({ localization: next })} />
        <Toggle
          checked={config.voiceInput}
          detail="Claude microphone uses local SenseVoice transcription; audio remains on this computer. Relaunch Claude to apply."
          disabled={disabled}
          label="Voice input"
          onChange={onVoice}
        />
        {config.voiceInput && !status.dictationReady ? <VoiceModel onReady={() => onAction("prepare")} /> : null}
        <Toggle
          checked={config.importCliSessions ?? true}
          detail="Before launching Claude, import CLI sessions from terminals and BaoCode into the sidebar without duplicating existing or removed sessions."
          disabled={disabled}
          label="Show CLI sessions"
          onChange={(next) => onConfigure({ importCliSessions: next })}
        />
      </section>

      <details className="cm-more">
        <summary>Sessions</summary>
        <Toggle
          checked={config.codeShareHome ?? true}
          detail="On: Code and CLI share ~/.claude (sessions, MCP and plugins; settings.json endpoints take precedence). Off: use a separate profile routed through the selected provider."
          disabled={disabled}
          label="Share ~/.claude with CLI"
          onChange={(next) => onConfigure({ codeShareHome: next })}
        />
        <Toggle checked={config.sessionSync === true} detail="Sync Code sessions between API-key and full-feature modes before launch" disabled={disabled} label="Sync API-key mode sessions" onChange={(next) => onConfigure({ sessionSync: next })} />
        <div className="cm-row-actions">
          <button className="cm-btn cm-btn-small" disabled={disabled || status.claudeRunning} onClick={() => onAction("sync_sessions")} type="button">Sync now</button>
        </div>
      </details>

      <details className="cm-more">
        <summary>Account display</summary>
        <p className="cm-field-hint">Changes only the details shown in Claude; takes effect at next launch.</p>
        {text("displayName", "Local User", "User name")}
        {text("email", "local@claude.local", "Email", "email")}
        <Field label="Plan">
          <select disabled={disabled} onChange={(event) => onConfigure({ plan: event.currentTarget.value })} value={config.plan || "ultra"}>
            {["free", "pro", "max", "ultra"].map((plan) => <option key={plan} value={plan}>{plan[0].toUpperCase() + plan.slice(1)}</option>)}
          </select>
        </Field>
      </details>

      <details className="cm-more">
        <summary>Advanced</summary>
        <Toggle checked={config.cowork ?? true} detail="When disabled, Claude controls availability; newer versions usually show only Chat / Code. Claude still checks Windows Store installation and virtualization requirements." disabled={disabled} label="Cowork" onChange={(next) => onConfigure({ cowork: next })} />
        <Toggle checked={config.hideUnroutedModels ?? true} detail="Built-in Opus and Sonnet options are routed to the default model" disabled={disabled} label="Show only provider models" onChange={(next) => onConfigure({ hideUnroutedModels: next })} />
        <Toggle checked={config.computerUse} detail="Requires working system Spotlight; otherwise Claude may hang" disabled={disabled} label="Computer use" onChange={(next) => onConfigure({ computerUse: next })} />
        <Toggle checked={config.backgroundMode} disabled={disabled} label="Background mode" onChange={(next) => onConfigure(next ? { backgroundMode: true } : { backgroundMode: false, forceBackgroundMode: false })} />
        <Toggle checked={config.forceBackgroundMode ?? false} detail="Newer macOS versions may report background mode unsupported. This overrides the OS-version check and may be unstable." disabled={disabled} label="Enable background mode on newer systems" onChange={(next) => onConfigure({ forceBackgroundMode: next })} />
        <div className="cm-row-actions" title="The local service uses this certificate to handle Claude requests; it only applies on this computer.">
          <span className="cm-field-hint cm-grow">Local certificate: {status.caTrusted ? "Trusted" : status.caReady ? "Not trusted" : "Not prepared"}</span>
          {!status.caReady ? <button className="cm-btn cm-btn-small" disabled={busy !== null} onClick={() => onAction("prepare")} type="button">Prepare</button> : null}
          {status.caTrusted
            ? <button className="cm-btn cm-btn-small" disabled={busy !== null} onClick={() => onAction("untrust")} type="button">Remove trust</button>
            : <button className="cm-btn cm-btn-small" disabled={busy !== null} onClick={() => onAction("trust")} type="button"><ShieldCheck />Trust</button>}
        </div>
      </details>

      <div className="cm-about">
        <span>ClaudeMom {version || ""}{status.version ? ` · Claude ${status.version}` : ""}</span>
        {update.phase === "available" ? (
          <button className="cm-link" onClick={onInstallUpdate} type="button">Update to {update.version}</button>
        ) : (
          <button className="cm-link" disabled={update.phase === "checking" || update.phase === "downloading"} onClick={onCheckUpdate} type="button">
            {update.phase === "checking" ? "Checking…" : update.phase === "latest" ? "Up to date" : "Check for updates"}
          </button>
        )}
      </div>
    </div>
  );
}
