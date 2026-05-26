import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listLibraryDesignSystems,
  parseDesignSystemMarkdown,
} from "../lib/designSystemStore.ts";

const root = process.cwd();
const bundledOpenDesignRoot = join(root, "open-design");

function readSource(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("project design systems", () => {
  it("parses open-design DESIGN.md metadata and swatches", () => {
    const parsed = parseDesignSystemMarkdown(`# Design System Inspired by Example
> Category: Starter
> Short product system.

## Color Palette & Roles
- **Background:** \`#FAFAFA\`
- **Foreground:** \`#111111\`
- **Accent:** \`#2F6FEB\`
- **Border:** \`#E5E5E5\`
`);
    assert.equal(parsed.title, "Example");
    assert.equal(parsed.category, "Starter");
    assert.match(parsed.summary, /Short product system/);
    assert.deepEqual(parsed.swatches, ["#fafafa", "#e5e5e5", "#111111", "#2f6feb"]);
  });

  it("can list open-design presets from an explicit root", async () => {
    const systems = await listLibraryDesignSystems(bundledOpenDesignRoot);
    assert.ok(systems.some((system) => system.id === "default"));
    assert.ok(systems.some((system) => system.id === "linear-app"));
  });

  it("uses bundled open-design presets when env is not configured", async () => {
    const systems = await listLibraryDesignSystems();
    assert.ok(systems.length >= 50);
    assert.ok(systems.some((system) => system.id === "default"));
  });

  it("registers project design-system API routes", () => {
    const routes = readSource("routes/designSystems.ts");
    const index = readSource("routes/index.ts");
    assert.match(routes, /\/api\/design-systems\/library/);
    assert.match(routes, /\/api\/projects\/:id\/design-systems/);
    assert.match(routes, /setActiveProjectDesignSystem/);
    assert.match(index, /registerDesignSystemRoutes/);
  });

  it("applies active project design systems in generation routes", () => {
    for (const path of ["routes/generate.ts", "routes/edit.ts", "routes/multimode.ts", "routes/nodes.ts"]) {
      const source = readSource(path);
      assert.match(source, /applyProjectDesignSystem/);
      assert.match(source, /designSystem\.meta/);
    }
    assert.match(readSource("routes/nodes.ts"), /designSystemEnabled/);
    assert.match(readSource("lib/designSystemPrompt.ts"), /node-disabled/);
  });

  it("keeps the node UI opt-out defaulted on and persisted", () => {
    const store = readSource("ui/src/store/useAppStore.ts");
    const node = readSource("ui/src/components/ImageNode.tsx");
    const api = readSource("ui/src/lib/nodeApi.ts");
    assert.match(store, /designSystemEnabled\?: boolean/);
    assert.match(store, /designSystemEnabled: d\.designSystemEnabled !== false/);
    assert.match(store, /setNodeDesignSystemEnabled/);
    assert.match(api, /designSystemEnabled\?: boolean/);
    assert.match(node, /node\.designSystemToggle/);
  });
});
