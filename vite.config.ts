import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");

          if (!normalizedId.includes("/node_modules/")) {
            return undefined;
          }

          if (normalizedId.includes("/zrender/")) {
            return "vendor-zrender";
          }

          if (normalizedId.includes("/echarts/")) {
            return "vendor-echarts";
          }

          if (normalizedId.includes("/react-router-dom/") || normalizedId.includes("/react-router/")) {
            return "vendor-router";
          }

          if (normalizedId.includes("/@tauri-apps/")) {
            return "vendor-tauri";
          }

          if (normalizedId.includes("/@heroicons/")) {
            return "vendor-icons";
          }

          if (
            normalizedId.includes("/react/") ||
            normalizedId.includes("/react-dom/") ||
            normalizedId.includes("/scheduler/")
          ) {
            return "vendor-react";
          }

          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "next/link": path.resolve(__dirname, "src/compat/next-link.tsx"),
      "next/dynamic": path.resolve(__dirname, "src/compat/next-dynamic.tsx"),
      "next/image": path.resolve(__dirname, "src/compat/next-image.tsx"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/dist/**", "**/src-tauri/target/**"],
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  clearScreen: false,
});