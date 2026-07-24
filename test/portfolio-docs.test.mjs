import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const portfolioDocs = [
  "README.md",
  "ASSET_LICENSES.md",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
  "CloudServer/hakkei-score-server/README.md",
  "docs/README.md",
  "docs/CONTRIBUTIONS.md",
  "docs/architecture/electron-security.md",
  "docs/technical-notes/mocopi-ble-signal-validation.md",
  "docs/verification_checklist_v2_ble.md",
  "docs/archive/README.md",
  "docs/archive/internal-guidance/README.md",
];

test("ポートフォリオ入口文書のローカルリンク切れがない", () => {
  for (const relativeDocumentPath of portfolioDocs) {
    const documentPath = join(root, relativeDocumentPath);
    const markdown = readFileSync(documentPath, "utf8");
    const links = [...markdown.matchAll(/\[[^\]]*]\(([^)]+)\)/g)].map((match) => match[1]);

    for (const link of links) {
      if (/^(?:https?:|mailto:|#)/i.test(link)) {
        continue;
      }
      const pathWithoutAnchor = decodeURIComponent(link.split("#", 1)[0]);
      const resolvedPath = join(dirname(documentPath), pathWithoutAnchor);
      assert.equal(existsSync(resolvedPath), true, `${relativeDocumentPath} -> ${link}`);
    }
  }
});
