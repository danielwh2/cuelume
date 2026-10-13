import { useEffect } from "react";
import { bind, play } from "cuelume";

// One bind() for the whole app: delegated listeners keep working as
// components and routes replace descendants.
export function App() {
  useEffect(() => {
    bind();
  }, []);

  async function deploy() {
    play("loading");
    await new Promise((resolve) => setTimeout(resolve, 600));
    play("success", { emphasis: "strong" });
  }

  return (
    <main>
      <button data-cuelume-tap>Save</button>
      <button data-cuelume-tap data-cuelume-emphasis="subtle">Skip</button>
      <input data-cuelume-type placeholder="Search" />
      <button onClick={deploy}>Deploy</button>
    </main>
  );
}
