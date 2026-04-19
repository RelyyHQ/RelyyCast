import { ConfigField } from "./ConfigField";

interface SettingsTabProps {
  serverConfig: ServerConfig;
  settingsStatus: string;
  settingsError: string | null;
  isSavingSettings: boolean;
  onSettingsFieldChange: (field: keyof ServerConfig, value: string | boolean) => void;
  onSaveSettings: () => void;
}

export function SettingsTab({
  serverConfig,
  settingsStatus,
  settingsError,
  isSavingSettings,
  onSettingsFieldChange,
  onSaveSettings,
}: Readonly<SettingsTabProps>) {
  return (
    <div className="flex h-full flex-col gap-2 rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))] p-2">
      <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[hsl(var(--theme-muted))]">
        Configuration
      </p>

      <div className="grid grid-cols-3 gap-1.5">
        {/* MP3 toggle */}
        <div className="col-span-3 flex items-center justify-between rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2 py-1.5">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-[hsl(var(--theme-muted))]">
              MP3 Output
            </p>
            <p className="text-[9px] text-[hsl(var(--theme-muted))]">
              Enable after install, save settings, then restart the app.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { onSettingsFieldChange("mp3Enabled", !serverConfig.mp3Enabled); }}
            className={[
              "h-7 rounded-sm border px-2 text-[9px] font-semibold",
              serverConfig.mp3Enabled
                ? "border-[hsl(var(--theme-primary))] bg-[hsl(var(--theme-primary))] text-white"
                : "border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface))]",
            ].join(" ")}
          >
            {serverConfig.mp3Enabled ? "Enabled" : "Disabled"}
          </button>
        </div>

        <ConfigField
          label="Input URL"
          value={serverConfig.inputUrl}
          onChange={(v) => { onSettingsFieldChange("inputUrl", v); }}
        />
        <ConfigField
          label="Station Name"
          value={serverConfig.stationName}
          onChange={(v) => { onSettingsFieldChange("stationName", v); }}
        />
        <ConfigField
          label="Bitrate"
          value={serverConfig.bitrate}
          onChange={(v) => { onSettingsFieldChange("bitrate", v); }}
        />
        <ConfigField
          label="Relay Path"
          value={serverConfig.relayPath}
          onChange={(v) => { onSettingsFieldChange("relayPath", v); }}
        />
        <ConfigField
          label="Genre"
          value={serverConfig.genre}
          onChange={(v) => { onSettingsFieldChange("genre", v); }}
        />
        <ConfigField
          label="Description"
          value={serverConfig.description}
          onChange={(v) => { onSettingsFieldChange("description", v); }}
        />

        {/*
          FFmpeg/MediaMTX paths are hidden until the auto-detect flow is wired up.
          The values are still persisted and sent to the runtime — just not editable here.
        */}
        <div className="hidden">
          <ConfigField
            label="FFmpeg Path"
            value={serverConfig.ffmpegPath}
            onChange={(v) => { onSettingsFieldChange("ffmpegPath", v); }}
          />
          <ConfigField
            label="MediaMTX Path"
            value={serverConfig.mediamtxPath}
            onChange={(v) => { onSettingsFieldChange("mediamtxPath", v); }}
          />
          <ConfigField
            label="MediaMTX Config"
            value={serverConfig.mediamtxConfigPath}
            onChange={(v) => { onSettingsFieldChange("mediamtxConfigPath", v); }}
          />
        </div>
      </div>

      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-1">
        <button
          type="button"
          onClick={onSaveSettings}
          disabled={isSavingSettings}
          className="h-7 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[9px] font-semibold disabled:opacity-60"
        >
          {isSavingSettings ? "Saving…" : "Save Settings"}
        </button>
        <div className="truncate rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-1.5 py-1 text-[9px] text-[hsl(var(--theme-muted))]">
          {settingsError ? `Error: ${settingsError}` : settingsStatus}
        </div>
      </div>
    </div>
  );
}
