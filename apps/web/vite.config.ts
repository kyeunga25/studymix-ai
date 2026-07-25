import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { studymixMockApiPlugin } from "./dev/mock-api-plugin";

export default defineConfig(({ command }) => {
  const localMockEnabled = command === "serve";
  return {
    plugins: [react(), ...(localMockEnabled ? [studymixMockApiPlugin()] : [])],
    server: {
      port: 5173,
    },
    preview: {
      port: 4173,
    },
  };
});
