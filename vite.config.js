import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "fs";

// Read version from package.json
const packageJson = JSON.parse(readFileSync("./package.json", "utf-8"));
const version = packageJson.version;

export default defineConfig({
  plugins: [viteSingleFile()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
});
