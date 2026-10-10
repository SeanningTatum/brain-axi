[brain-verify reference — section 3: recommended Playwright script pattern]

-------------------------------------------------------------------------------
3. RECOMMENDED SCRIPT PATTERN (Playwright, condensed)
-------------------------------------------------------------------------------

brain-axi deliberately ships ZERO browser automation — the driver is a
throwaway Playwright script YOU scaffold, run, and delete. Scaffolding:

- Prefer the project's own pinned Playwright (node_modules/.bin/playwright)
  when the repo has one — a globally cached copy can want a different browser
  revision. No project install? Use npx: "npx -y playwright install chromium"
  once, then run your script with node.
- Write the script to a PROJECT-INTERNAL temp path (e.g. tmp/verify-<slug>.mjs
  at the repo root, gitignored) — never /tmp: Node resolves bare imports
  upward from the script's directory, and /tmp has no node_modules. Never name
  it *.spec.* and never put it in the e2e/tests dir, so the CI suite can't
  pick it up.
- Screenshot each asserted step straight into .brain/shots/<slug>/NN-name.png
  (gitignored). In a git worktree, save into the MAIN checkout's
  .brain/shots/<slug>/ instead (absolute path; every worktree shares that one
  brain, and a worktree's own .brain/shots/ is refused — the CLI error prints
  the right dir). Then attach each file to the verdict with
  `brain verifications add ... --shot <path>::<caption>`. Capture on PASS as
  well as FAIL — passing evidence is the point.
- Delete the script when done. The screenshots and the recorded verdict are the
  durable evidence; the driver is disposable.

Write a throwaway script (not a committed test file — this is not the CI
regression suite) that:

    // launch clean and extension-free: a real dry run of this playbook once
    // surfaced a phantom hydration warning that turned out to be a password-
    // manager browser extension injecting DOM, not an app bug. Bundled
    // chromium + --disable-extensions + a fresh profile avoids that class of
    // false positive.
    const browser = await chromium.launch({ args: ["--disable-extensions"] });
    const context = await browser.newContext(); // fresh profile, no channel:"chrome"
    const page = await context.newPage();

    const jsErrors = [];
    const networkErrors = [];
    page.on("pageerror", (e) => jsErrors.push(String(e)));
    page.on("console", (msg) => { if (msg.type() === "error") jsErrors.push(msg.text()); });
    page.on("response", (res) => {
      if (res.status() >= 400) networkErrors.push(`${res.status()}@${currentStepLabel}`);
    });

    // golden path: drive it, assert the expected state, screenshot each step
    await page.goto(baseUrl + "/sign-up");
    await page.screenshot({ path: ".brain/shots/<slug>/01-signup.png" });
    // ... fill fields, submit, assert redirect/visible state ...
    await page.screenshot({ path: ".brain/shots/<slug>/02-dashboard.png" });

    // error path: FRESH CONTEXT if the golden path left the session
    // authenticated and the error path needs to be unauthenticated (or vice
    // versa) — many apps redirect an authenticated session away from
    // login/signup routes in a loader/guard, so reusing the same context can
    // make the error-path step silently unreachable instead of failing loud.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    // ... drive the failure, assert the inline error / rejection surfaces ...
    await freshPage.screenshot({ path: "E1-bad-login.png" });

    await browser.close();

Two gotchas worth restating because they bite often:
- **Fresh browser context for the error path** whenever the golden path
  authenticates and the error path needs an unauthenticated (or differently-
  authenticated) view — don't assume the same page/context can just navigate
  there.
- **Clean, extension-free browser** — launch bundled chromium with
  --disable-extensions and a throwaway profile, never a channel:"chrome"
  pointed at a real user profile. Extensions injecting DOM (password
  managers, ad blockers) produce console noise that looks exactly like an
  app bug.

