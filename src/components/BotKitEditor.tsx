import { useState } from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { MAUS_COLORS, type MausColor } from "@/lib/mascot";
import { KIT_ACCESSORY_IDS, KIT_BODY_IDS, KIT_FACE_IDS, MAX_KIT_ACCESSORIES, type KitAccessory, type KitAccessoryId, type MascotAppearance } from "../../shared/mascot-kit";
import { BotKitAvatar } from "./BotKitAvatar";

export function BotKitEditor({ appearance, color, disabled, onChange }: {
  appearance: MascotAppearance;
  color: MausColor;
  disabled: boolean;
  onChange: (value: MascotAppearance) => void;
}) {
  const [selected, setSelected] = useState<KitAccessoryId | null>(null);
  const active = appearance.accessories.find(item => item.id === selected) ?? appearance.accessories.at(-1);
  const buttonClass = (pressed: boolean) => cn("flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-ink-secondary hover:bg-control disabled:opacity-40", pressed ? "border-accent bg-accent/10 text-ink" : "border-hairline/40 bg-inset");
  const preview = (value: MascotAppearance) => <BotKitAvatar appearance={value} color={MAUS_COLORS[color] ?? MAUS_COLORS.green} size={44} state="idle" animated={false} />;
  const labelClass = "mb-2 mt-4 text-[12px] font-medium uppercase tracking-[0.08em] text-ink-secondary";
  const updateAccessory = (patch: Partial<KitAccessory>) => {
    if (!active) return;
    onChange({ ...appearance, accessories: appearance.accessories.map(item => item.id === active.id ? { ...item, ...patch } : item) });
  };
  return <div data-bot-kit-editor>
    <div className={labelClass}>{t("botKit.bodies")}</div>
    <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t("botKit.bodies")}>
      {KIT_BODY_IDS.map(id => <button key={id} type="button" disabled={disabled}
        aria-label={t("botKit.chooseBody", { name: t(`botKit.body.${id}`) })} aria-pressed={appearance.body === id}
        onClick={() => onChange({ ...appearance, body: id })} className={buttonClass(appearance.body === id)}>
        {preview({ ...appearance, body: id, accessories: [] })}
        <span className="w-full truncate text-center text-[10px]">{t(`botKit.body.${id}`)}</span>
      </button>)}
    </div>
    <div className={labelClass}>{t("botKit.faces")}</div>
    <button type="button" disabled={disabled} aria-pressed={appearance.face === "auto"}
      onClick={() => onChange({ ...appearance, face: "auto" })}
      className={cn("mb-2 w-full rounded-lg border px-3 py-2 text-left text-[12px] disabled:opacity-40", appearance.face === "auto" ? "border-accent bg-accent/10" : "border-hairline/40 hover:bg-control")}>
      {t("botKit.autoFace")}
    </button>
    <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t("botKit.faces")}>
      {KIT_FACE_IDS.map(id => <button key={id} type="button" disabled={disabled}
        aria-label={t("botKit.chooseFace", { name: t(`botKit.face.${id}`) })} aria-pressed={appearance.face === id}
        onClick={() => onChange({ ...appearance, face: id })} className={buttonClass(appearance.face === id)}>
        {preview({ ...appearance, face: id, accessories: [] })}
        <span className="w-full truncate text-center text-[10px]">{t(`botKit.face.${id}`)}</span>
      </button>)}
    </div>
    <div className={labelClass}>{t("botKit.accessories")}</div>
    <p className="mb-2 text-[12px] text-ink-secondary">{t("botKit.accessoryHint", { count: MAX_KIT_ACCESSORIES })}</p>
    <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={t("botKit.accessories")}>
      {KIT_ACCESSORY_IDS.map(id => {
        const item = appearance.accessories.find(item => item.id === id);
        return <button key={id} type="button" disabled={disabled || (!item && appearance.accessories.length >= MAX_KIT_ACCESSORIES)}
          aria-label={t("botKit.toggleAccessory", { name: t(`botKit.accessory.${id}`) })} aria-pressed={Boolean(item)}
          onClick={() => {
            setSelected(id);
            onChange({ ...appearance, accessories: item ? appearance.accessories.filter(entry => entry.id !== id)
              : [...appearance.accessories, { id, x: 0, y: 0, scale: 1, rotation: 0 }] });
          }} className={buttonClass(Boolean(item))}>
          {preview({ ...appearance, accessories: [item ?? { id, x: 0, y: 0, scale: 1, rotation: 0 }] })}
          <span className="w-full truncate text-center text-[10px]">{t(`botKit.accessory.${id}`)}</span>
        </button>;
      })}
    </div>
    {active && <div className="mt-4 rounded-lg border border-hairline/40 p-3">
      <label className="mb-3 block text-[12px] font-medium">
        {t("botKit.adjustAccessory")}
        <select className="mt-1 w-full rounded-lg border border-hairline/40 bg-control p-2 text-ink" value={active.id} disabled={disabled}
          onChange={event => setSelected(event.target.value as KitAccessoryId)} aria-label={t("botKit.adjustAccessory")}>
          {appearance.accessories.map(item => <option key={item.id} value={item.id}>{t(`botKit.accessory.${item.id}`)}</option>)}
        </select>
      </label>
      {([
        ["x", -64, 64, 1, "horizontal"], ["y", -64, 64, 1, "vertical"],
        ["scale", 0.4, 2, 0.05, "size"], ["rotation", -180, 180, 5, "rotation"],
      ] as const).map(([field, min, max, step, label]) => <label key={field} className="mb-2 block text-[12px] text-ink-secondary">
        <span className="flex justify-between gap-2"><span>{t(`botKit.${label}`)}</span><output>{field === "scale" ? `${Math.round(active[field] * 100)}%` : field === "rotation" ? `${active[field]}°` : active[field]}</output></span>
        <input type="range" min={min} max={max} step={step} value={active[field]} disabled={disabled}
          aria-label={t(`botKit.${label}`)} className="mt-1 w-full accent-accent"
          onChange={event => updateAccessory({ [field]: Number(event.target.value) })} />
      </label>)}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={disabled} className="rounded-md bg-control px-2 py-1.5 text-[12px] disabled:opacity-40"
          onClick={() => updateAccessory({ x: 0, y: 0, scale: 1, rotation: 0 })}>{t("botKit.resetPosition")}</button>
        <button type="button" disabled={disabled || appearance.accessories.at(-1)?.id === active.id}
          className="rounded-md bg-control px-2 py-1.5 text-[12px] disabled:opacity-40"
          onClick={() => onChange({ ...appearance, accessories: [...appearance.accessories.filter(item => item.id !== active.id), active] })}>{t("botKit.bringFront")}</button>
        <button type="button" disabled={disabled} className="rounded-md px-2 py-1.5 text-[12px] text-danger disabled:opacity-40"
          onClick={() => onChange({ ...appearance, accessories: [] })}>{t("botKit.removeAccessories")}</button>
      </div>
    </div>}
  </div>;
}
