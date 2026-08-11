import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./base.css";

const rootElement = document.querySelector("#root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error("StudyMix AI root element was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
