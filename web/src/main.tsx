import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { LangProvider } from "./i18n";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}

createRoot(root).render(
  <StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </StrictMode>,
);
