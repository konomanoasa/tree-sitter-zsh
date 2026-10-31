import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import { createParser } from "./support/parser.js";
import {
  representativeSource,
  scaleFactors,
  scalingWorkloads,
} from "./support/workloads.js";

for (const language of grammars) {
  describe(language.name, () => {
    const { parseSummary } = createParser(language);
    const warmupSamples = 1;
    const measurementSamples = 3;
    const ordinaryLimitMs = 1000;
    const durationGrowthLimit = 12;
    const timerAllowanceMs = 20;

    function measure(source) {
      const samples = [];
      for (let run = 0; run < warmupSamples + measurementSamples; run++) {
        const summary = parseSummary(source);
        if (run >= warmupSamples)
          samples.push(
            summary.duration.secs * 1000 + summary.duration.nanos / 1e6,
          );
      }
      return samples.toSorted((a, b) => a - b)[Math.floor(samples.length / 2)];
    }

    test("representative native source parses without an editing-sized pause", (context) => {
      const durationMs = measure(representativeSource);
      context.diagnostic(
        `${Buffer.byteLength(representativeSource)} bytes: ${durationMs.toFixed(2)} ms`,
      );
      assert.ok(durationMs < ordinaryLimitMs);
    });
    for (const { name, units, source } of scalingWorkloads) {
      test(`large ${name} scale without an extreme duration increase`, (context) => {
        const durations = scaleFactors.map((factor) =>
          measure(source(units * factor)),
        );
        context.diagnostic(`${name}: ${durations.join(" / ")}ms`);
        for (const duration of durations.slice(1)) {
          assert.ok(
            duration <= durations[0] * durationGrowthLimit + timerAllowanceMs,
            name,
          );
        }
      });
    }
  });
}
