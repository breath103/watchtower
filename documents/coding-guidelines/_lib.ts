import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * List every rule directory under the coding-guidelines root.
 * `root` is the guidelines dir; pass a `group` to scope to one group, or null
 * for all groups. Returns absolute paths to each `<group>/<slug>` folder.
 */
export function ruleDirs(root: string, group: string | null): string[] {
  const groups = group
    ? [group]
    : readdirSync(root, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);
  return groups.flatMap(g => {
    const dir = join(root, g);
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(dir, d.name));
  });
}
