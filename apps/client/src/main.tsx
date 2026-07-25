import { createRoot } from "react-dom/client";
import App from "./App.js";
import { LangProvider } from "./i18n.js";

createRoot(document.getElementById("root")!).render(
  <LangProvider>
    <App />
  </LangProvider>,
);
