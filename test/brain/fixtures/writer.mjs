// Concurrency worker: node writer.mjs <cwd> <label> <n> — opens the brain from
// <cwd> and writes n checkpoints plus n run steps. No args: a no-op (so
// `node --test` picking this file up does nothing).
import { openBrain, progress, runs, close } from "../../../lib/brain/index.js";

const [cwd, label, n] = process.argv.slice(2);
if (cwd) {
  const { db } = openBrain(cwd);
  for (let i = 0; i < Number(n); i++) {
    progress.add(db, { summary: `${label} checkpoint ${i}`, branch: label, root: cwd });
    runs.append(db, "race", { run: label, step: `step ${i}`, observed: `${label} ${i}` });
  }
  close(db);
}
