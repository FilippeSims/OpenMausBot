import { forwardRef, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { KIT_FACE_IDS, type MascotAppearance } from "../../shared/mascot-kit";
import { automaticKitFace, kitLayerMarkup } from "@/lib/bot-kit-art";
import type { MausMotion, MausState } from "@/lib/mascot";
import type { CursorAvatarHandle } from "./CursorAvatar";
import "./BotKitAvatar.css";

export const BotKitAvatar = forwardRef<CursorAvatarHandle, {
  appearance: MascotAppearance;
  color: string;
  size: number;
  label?: string;
  state: MausState;
  animated: boolean;
  motion?: MausMotion;
  motionKey?: number;
  gaze?: { x?: number; y?: number };
}>(function BotKitAvatar({ appearance, color, size, label, state, animated, motion, motionKey, gaze }, ref) {
  const uid = "kit-" + useId().replace(/[^a-zA-Z0-9-]/g, "");
  const faceRef = useRef<SVGGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const [manualFace, setManualFace] = useState<KitFaceId | null>(null);
  const face = appearance.face === "auto" ? manualFace ?? automaticKitFace(state) : appearance.face;
  const bodyMarkup = useMemo(() => kitLayerMarkup("bodies", appearance.body, uid + "-body"), [appearance.body, uid]);
  const faceMarkup = useMemo(() => kitLayerMarkup("faces", face, uid + "-face"), [face, uid]);
  const canAnimate = () => animated && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  useImperativeHandle(ref, () => ({
    blink: () => { if (canAnimate()) faceRef.current?.animate([{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }], { duration: 160 }); },
    spin: (duration = 700) => { if (canAnimate()) sceneRef.current?.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration }); },
    setExpression: (index) => { if (Number.isFinite(index)) setManualFace(KIT_FACE_IDS[Math.abs(Math.trunc(index)) % KIT_FACE_IDS.length]); },
  }));
  return <svg viewBox="-8 -8 144 144" width={size} height={size} role={label ? "img" : undefined}
    aria-label={label} aria-hidden={label ? undefined : true} data-mascot-kit={appearance.body}
    data-kit-face={face} className="bot-kit-avatar" data-animated={animated} data-state={state}>
    <g ref={sceneRef} key={`${motion ?? "none"}-${motionKey ?? 0}`} className="bot-kit-scene" data-motion={motion}>
      <g className="bot-kit-movement">
        <g data-kit-layer="body" style={{ color }} dangerouslySetInnerHTML={{ __html: bodyMarkup }} />
        <g ref={faceRef} data-kit-layer="face" style={{ color: "#fff8ed" }} transform={`translate(${(gaze?.x ?? 0) * 1.2} ${(gaze?.y ?? 0) * 1.2})`}
          dangerouslySetInnerHTML={{ __html: faceMarkup }} />
        {appearance.accessories.map((item, index) => <g key={item.id} data-kit-accessory={item.id}
          transform={`translate(${item.x} ${item.y}) translate(64 64) rotate(${item.rotation}) scale(${item.scale}) translate(-64 -64)`}
          dangerouslySetInnerHTML={{ __html: kitLayerMarkup("accessories", item.id, `${uid}-acc-${index}`) }} />)}
      </g>
    </g>
  </svg>;
});

type KitFaceId = typeof KIT_FACE_IDS[number];
