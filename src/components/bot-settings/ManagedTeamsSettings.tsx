import { t as uiText } from "@/lib/i18n";
import { useState } from "react";

export function ManagedTeamsSettings({
  name, ownTeam, teams, allowed, onSave,
}: {
  name: string;
  ownTeam: string;
  teams: string[];
  allowed: string[];
  onSave: (teams: string[]) => void;
}) {
  const [selected, setSelected] = useState(allowed);
  const choices = [...new Set([...teams, ...allowed])].filter(team => team !== ownTeam).sort();
  const changed = JSON.stringify([...selected].sort()) !== JSON.stringify([...allowed].sort());
  return (
    <details className="mt-3 border-t border-hairline/40 pt-3">
      <summary className="cursor-pointer text-[13px] font-medium text-ink">{uiText("ui.ManagedTeamsSettings.a9c969eacb")}</summary>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{uiText("ui.ManagedTeamsSettings.e947a3d4f4")} {name} {uiText("ui.ManagedTeamsSettings.d27177bb2b")}</p>
      <fieldset className="mt-3 flex max-h-52 flex-col gap-2 overflow-y-auto">
        <legend className="sr-only">{uiText("ui.ManagedTeamsSettings.1e1a1c078a")} {name} {uiText("ui.ManagedTeamsSettings.23ce60dee6")}</legend>
        {choices.map(team => (
          <label key={team} className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" className="accent-accent" checked={selected.includes(team)}
              onChange={event => setSelected(current => event.target.checked
                ? [...current, team] : current.filter(value => value !== team))} />
            {team || uiText("settings.section.general")}
          </label>
        ))}
        {!choices.length && <p className="text-[13px] text-ink-secondary">{uiText("ui.ManagedTeamsSettings.d9e5dc5d34")}</p>}
      </fieldset>
      <button type="button" disabled={!changed} onClick={() => onSave(selected)}
        className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-40">{uiText("ui.ManagedTeamsSettings.38bc505412")}</button>
    </details>
  );
}
