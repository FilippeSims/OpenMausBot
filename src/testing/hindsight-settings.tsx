import { createRoot } from "react-dom/client";
import { StoreProvider, useStore } from "../state/store";
import { SettingsModal } from "../components/SettingsModal";
import { applySkin } from "../lib/skins";
import "../styles.css";
function Fixture() {
  const { dispatch } = useStore();
  return <main className="min-h-screen bg-panel p-6 text-ink">
    <button onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "memory" })}>Abrir configurações de memória</button>
    <SettingsModal />
  </main>;
}
applySkin("midnight");
const root = createRoot(document.getElementById("root")!);
root.render(<StoreProvider><Fixture /></StoreProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
