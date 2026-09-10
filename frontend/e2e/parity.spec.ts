import { test, expect, type Page } from "@playwright/test";

/**
 * The EEGLAB-parity features, end to end against a real MNE process.
 *
 * These are the ones whose value is entirely in the real thing: ICLabel runs an
 * ONNX model, the channel table's numbers come from the actual signal, and the
 * epoch chain is three MNE calls deep. A mocked version of any of them proves
 * nothing.
 */

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Synthetic sample/ }).click();
  await expect(page).toHaveURL(/\/s\/[a-z0-9]+/);
  await expect(page.getByRole("button", { name: /^Raw/ })).toBeVisible();
  return page.url().split("/")[4];
}

/** Run operations through the real API, waiting out any that queue a job. */
async function run(page: Page, id: string, steps: [string, Record<string, unknown>][]) {
  await page.evaluate(async ({ id, steps }) => {
    const headers = { "Content-Type": "application/json" };
    for (const [op_id, params] of steps) {
      const r = await fetch(`/api/sessions/${id}/ops`, {
        method: "POST", headers, body: JSON.stringify({ op_id, params }) });
      const body = await r.json();
      if (!r.ok) throw new Error(`${op_id}: ${JSON.stringify(body)}`);
      if (r.status === 202) {
        for (let i = 0; i < 900; i++) {
          const s = await (await fetch(`/api/jobs/${body.job_id}`)).json();
          if (s.state === "done") break;
          if (s.state === "error") throw new Error(`${op_id}: ${s.error}`);
          await new Promise((z) => setTimeout(z, 100));
        }
      }
    }
  }, { id, steps });
}

test.describe("the channel table", () => {
  test("reports real numbers and edits the recording through the ledger", async ({ page }) => {
    const id = await openDemo(page);
    await page.goto(`/s/${id}/channels`);

    // the workspace holds two tables, so scope to the channel one
    const table = page.getByRole("table").first();
    await expect(table).toBeVisible();
    await expect(page.getByText("Fp1", { exact: true })).toBeVisible();
    // 32 channels, so 32 body rows plus the header
    await expect(table.getByRole("row")).toHaveCount(33);

    // peak to peak is a real measurement, not a placeholder
    const pp = await table.getByRole("row").nth(1).getByRole("cell").nth(3).innerText();
    expect(Number(pp)).toBeGreaterThan(0);

    await page.getByLabel("Mark Fp1 bad").click();
    await expect(page.getByRole("button", { name: /Pipeline 1/ })).toBeVisible();
    await expect(page.getByLabel("Unmark Fp1")).toBeVisible();
  });

  test("automatic bad-channel detection runs and writes a step", async ({ page }) => {
    const id = await openDemo(page);
    await page.goto(`/s/${id}/channels`);
    await expect(page.getByRole("table").first()).toBeVisible();
    await page.getByText("Detect bad").click();
    await expect(page.getByRole("button", { name: /Pipeline 1/ })).toBeVisible();
  });
});

test.describe("annotations", () => {
  test("marks an event at the cursor and draws it on the trace", async ({ page }) => {
    const id = await openDemo(page);
    await page.goto(`/s/${id}/channels`);
    await expect(page.getByRole("table").first()).toBeVisible();

    await page.getByLabel("Annotation label").fill("my_event");
    await page.getByRole("button", { name: /^\s*at \d/ }).click();

    await expect(page.getByText("my_event").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Pipeline 1/ })).toBeVisible();
  });

  test("clicking a row moves the shared cursor", async ({ page }) => {
    const id = await openDemo(page);
    await page.goto(`/s/${id}/channels`);
    // the demo ships with simulated blinks, so there is something to click
    const firstOnset = page.getByRole("button", { name: /^\s*\d+\.\d\ds\s*$/ }).first();
    await expect(firstOnset).toBeVisible();
    const seconds = Number((await firstOnset.innerText()).trim().replace("s", ""));
    await firstOnset.click();
    // the transport readout is the shared cursor, and it now reads that time.
    // "4.19s" alone matches three places, all of which correctly followed the
    // seek, so assert on the one that is unambiguously the clock.
    await expect(page.getByText(new RegExp(`${seconds.toFixed(2)}s\\s*/`))).toBeVisible();
  });
});

test.describe("ICLabel", () => {
  test("classifies every component and marks the artifacts", async ({ page }) => {
    test.slow();  // fits an ICA and runs an ONNX model
    const id = await openDemo(page);
    await run(page, id, [
      ["filter", { l_freq: 1, h_freq: 40 }],
      ["fit_ica", { n_components: 8, method: "fastica" }],
    ]);
    await page.goto(`/s/${id}/ica`);
    await expect(page.getByText(/IC 0/)).toBeVisible();

    await page.getByRole("button", { name: "Classify" }).click();
    // every card gains a class badge with a confidence
    await expect(page.getByText(/\b(brain|other|eye blink|muscle|heart|line noise|channel noise)\b \d+%/).first())
      .toBeVisible({ timeout: 60_000 });

    await expect(page.getByRole("button", { name: "Auto-mark" })).toBeVisible();
    await expect(page.getByRole("button", { name: "artifacts first" })).toBeVisible();
  });
});

/**
 * Block until the load-time derivation has filled the given containers.
 *
 * The pass runs as a background job, so asserting on the UI straight after
 * `openDemo` is a race against it: the pane legitimately shows its empty state
 * until the job lands. Poll the graph instead of picking a timeout, the same
 * way `run` polls a job.
 */
async function waitForDerived(page: Page, id: string, containers: string[]) {
  await page.evaluate(async ({ id, containers }) => {
    for (let i = 0; i < 1800; i++) {
      const g = await (await fetch(`/api/sessions/${id}/graph`)).json();
      const have = new Set((g.graph ?? []).map((n: { id: string }) => n.id));
      if (containers.every((c) => have.has(c))) return;
      await new Promise((z) => setTimeout(z, 200));
    }
    throw new Error(`derivation never produced ${containers.join(", ")}`);
  }, { id, containers });
}


test.describe("the epoched chain", () => {
  test("arrives already built, and says so", async ({ page }) => {
    test.slow();
    const id = await openDemo(page);

    // Nothing is clicked here on purpose. Every one of these workspaces used to
    // open with a form and a button, which is backwards: you look in order to
    // decide, and that made you decide in order to look.
    await waitForDerived(page, id, ["epochs", "evoked", "tfr"]);

    await page.goto(`/s/${id}/epochs`);
    await expect(page.getByText(/trials .* of Raw/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/ERP image, one row per trial/)).toBeVisible();

    // ...and a figure nobody asked for has to admit it, on the pane and in full
    // behind the triangle, or the tool is passing its defaults off as analysis.
    await expect(page.getByText(/Automatic:.*Not part of your pipeline/)).toBeVisible();
    await page.getByRole("button", { name: "Show the assumptions behind this figure" }).first().click();
    const dialog = page.getByRole("dialog", { name: "How this was generated" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("WHAT WAS RUN")).toBeVisible();
    await expect(dialog.getByText("WHAT IT ASSUMED")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();

    await page.goto(`/s/${id}/evoked`);
    await expect(page.getByText(/trials averaged, from Epochs/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/^peak /)).toBeVisible();
    await expect(page.getByAltText("evoked scalp topography")).toBeVisible({ timeout: 30_000 });

    await page.goto(`/s/${id}/tfr`);
    await expect(page.getByText(/Hz, from Epochs/)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/dB vs baseline/)).toBeVisible();

    // and none of it reached the ledger, which is the whole reason it is allowed
    // to run without being asked: `pipeline.py` still has to be a record of what
    // the user did, not of what this program guessed on their behalf.
    await page.goto(`/s/${id}/pipeline`);
    await expect(page.getByText(/No operations yet/)).toBeVisible();
    await expect(page.getByText(/^0 steps/)).toBeVisible();
  });

  test("running the operations yourself replaces the automatic ones", async ({ page }) => {
    test.slow();
    const id = await openDemo(page);
    await waitForDerived(page, id, ["epochs", "evoked", "tfr"]);
    await page.goto(`/s/${id}/epochs`);
    await expect(page.getByText(/Automatic:/)).toBeVisible({ timeout: 30_000 });

    await run(page, id, [
      ["filter", { l_freq: 1, h_freq: 40 }],
      ["make_epochs", { tmin: -0.2, tmax: 0.8, description: null, baseline: true, reject_uv: null }],
      ["average_epochs", { condition: null }],
      ["compute_tfr", { fmin: 4, fmax: 40, n_freqs: 24, decim: 3 }],
    ]);

    // Settle first: the load-time pass may still be finishing its figure half,
    // and this test is about what the server ends up believing, not about
    // winning a race with it.
    await page.evaluate(async (id) => {
      for (let i = 0; i < 600; i++) {
        const g = await (await fetch(`/api/sessions/${id}/graph`)).json();
        if (!("epochs" in (g.auto_derived ?? {}))) return;
        await new Promise((z) => setTimeout(z, 200));
      }
      const g = await (await fetch(`/api/sessions/${id}/graph`)).json();
      throw new Error("still automatic after make_epochs: "
        + JSON.stringify(Object.keys(g.auto_derived ?? {})) + " graph="
        + JSON.stringify((g.graph ?? []).map((n: { id: string }) => n.id)));
    }, id);

    // The pane no longer disowns what is on it: this is the user's work now.
    await page.reload();
    await expect(page.getByText(/trials .* of Raw/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Automatic:/)).toHaveCount(0);

    // lineage is visible in the pipeline, in order
    await page.goto(`/s/${id}/pipeline`);
    for (const step of [/Band-pass/, /epochs/i, /Evoked/, /TFR/]) {
      await expect(page.getByText(step).first()).toBeVisible();
    }
  });

  test("the epoch-relative containers do not pretend to share the recording clock", async ({ page }) => {
    const id = await openDemo(page);
    await run(page, id, [
      ["make_epochs", { tmin: 0, tmax: 1, description: null, baseline: false, reject_uv: null }],
      ["average_epochs", { condition: null }],
    ]);
    await page.goto(`/s/${id}/epochs`);
    await expect(page.getByRole("button", { name: "Play" })).toHaveCount(0);
    await page.goto(`/s/${id}/signal`);
    await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
  });
});

test.describe("the trace view states its scale", () => {
  test("µV per division and a numbered time axis", async ({ page }) => {
    const id = await openDemo(page);
    await page.goto(`/s/${id}/signal`);
    // the header states the amplitude scale and how many channels are shown
    await expect(page.getByTitle("amplitude per division")).toContainText("µV");
    await expect(page.getByTitle(/channels selected/)).toContainText(" of ");
  });
});
