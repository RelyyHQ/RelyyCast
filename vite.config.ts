import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handleDesktopApiRequest } from "./lib/server/desktop-api";

function desktopApiPlugin(): Plugin {
  const middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    void handleDesktopApiRequest(
      request,
      response,
    )
      .then((handled) => {
        if (!handled) {
          next();
        }
      })
      .catch((error) => {
        console.error("[vite:desktop-api] unhandled error:", error);
        if (!response.headersSent) {
          response.statusCode = 500;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        response.end(JSON.stringify({ error: "Internal server error" }));
      });
  };

  return {
    name: "desktop-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), desktopApiPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  build: {
    outDir: "build",
  },
});
