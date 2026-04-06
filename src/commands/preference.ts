import { Command } from "commander";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { extractPreferenceFromNaturalLanguage } from "../extract-preference.js";
import {
  loadAllPreferences,
  loadStoredPreferenceRecords,
  normalizePreference,
  overwriteStoredPreference,
  savePreference,
  validatePreference,
} from "../store.js";
import type { Preference } from "../types.js";
import { PREFERENCE_TARGET_TYPES, PREFERENCE_VALUES } from "../types.js";
import * as helpers from "./helpers.js";

export function register(program: Command): void {
  program
    .command("capture-preference")
    .description("Capture a workflow or skill preference from natural language or explicit parameters.")
    .option("--target <target>", "The name of the skill, workflow, or task class.")
    .option("--type <type>", `Target type: ${PREFERENCE_TARGET_TYPES.join(" | ")}`)
    .option("--pref <value>", `Preference value: ${PREFERENCE_VALUES.join(" | ")}`)
    .option("--reason <reason>", "Reason for this preference.")
    .option("--input <text>", "Natural language input to extract preference from.")
    .action(async (options: { target?: string; type?: any; pref?: any; reason?: string; input?: string }) => {
      const projectRoot = await helpers.resolveProjectRoot();
      let preference: Preference | null = null;

      const explicitManual =
        Boolean(options.target?.trim()) &&
        Boolean(options.type) &&
        Boolean(options.pref) &&
        Boolean(options.reason?.trim());

      if (explicitManual) {
        const now = new Date().toISOString();
        preference = {
          kind: "routing_preference",
          target_type: options.type,
          target: options.target!.trim(),
          preference: options.pref,
          reason: options.reason!.trim(),
          confidence: 1.0,
          source: "manual",
          created_at: now,
          updated_at: now,
          status: "active",
        };
      } else {
        let nl = options.input?.trim();
        if (!nl && !input.isTTY) {
          nl = (await helpers.readStdin()).trim();
        }
        if (nl) {
          preference = extractPreferenceFromNaturalLanguage(nl);
          if (!preference) {
            process.stderr.write(
              "Could not extract a preference from this text (weak or ambiguous signal). Try explicit flags or a clearer sentence.\n",
            );
            process.stderr.write(
              "无法从该文本提取偏好（信号偏弱或含糊）。请写得更具体，或使用 --target / --type / --pref / --reason。\n",
            );
            process.exit(1);
          }
        } else {
          process.stderr.write(
            "Provide natural language via --input or stdin, or pass all of (--target, --type, --pref, --reason).\n",
          );
          process.stderr.write(
            "请使用 --input 或管道 stdin 输入自然语言，或提供 (--target, --type, --pref, --reason)。\n",
          );
          process.exit(1);
        }
      }

      const savedPath = await savePreference(preference!, projectRoot);
      output.write(`Preference saved to: ${savedPath}\n`);
      output.write(`已保存偏好至: ${savedPath}\n`);
    });

  program;

  program
    .command("list-preferences")
    .description("List all active workflow and skill preferences.")
    .action(async () => {
      const projectRoot = await helpers.resolveProjectRoot();
      const preferences = await loadAllPreferences(projectRoot);
      const active = preferences.filter((p) => p.status === "active");

      if (active.length === 0) {
        output.write("No active preferences found.\n");
        return;
      }

      output.write("Active Preferences:\n");
      active.forEach((p) => {
        output.write(`- [${p.preference}] ${p.target_type}:${p.target} (Reason: ${p.reason})\n`);
      });
    });

  program;

  program
    .command("dismiss-preference")
    .description("Mark a preference as stale/dismissed.")
    .argument("<target>", "The target name to dismiss preferences for.")
    .action(async (target: string) => {
      const projectRoot = await helpers.resolveProjectRoot();
      const nowIso = new Date().toISOString();
      let count = 0;
      const records = await loadStoredPreferenceRecords(projectRoot);
      for (const rec of records) {
        if (rec.preference.target === target.trim() && rec.preference.status === "active") {
          await overwriteStoredPreference({
            ...rec,
            preference: normalizePreference({
              ...rec.preference,
              status: "stale",
              updated_at: nowIso,
              valid_until: rec.preference.valid_until ?? nowIso,
              supersession_reason: rec.preference.supersession_reason ?? "Dismissed via brain dismiss-preference",
            }),
          });
          count += 1;
        }
      }
      output.write(`Dismissed ${count} preference(s) for ${target}.\n`);
    });

  program;

  program
    .command("supersede-preference")
    .description("Supersede an old preference with a new one.")
    .argument("<old_target>", "The target name to supersede.")
    .option("--target <target>", "The new target name.")
    .option("--type <type>", `Target type: ${PREFERENCE_TARGET_TYPES.join(" | ")}`)
    .option("--pref <value>", `Preference value: ${PREFERENCE_VALUES.join(" | ")}`)
    .option("--reason <reason>", "Reason for this new preference.")
    .action(async (oldTarget: string, options: { target?: string; type?: any; pref?: any; reason?: string }) => {
      if (!options.target?.trim() || !options.type || !options.pref || !options.reason?.trim()) {
        process.stderr.write(
          "supersede-preference requires --target, --type, --pref, and --reason for the new preference.\n",
        );
        process.exit(1);
      }

      const projectRoot = await helpers.resolveProjectRoot();
      const now = new Date().toISOString();
      const newPref: Preference = {
        kind: "routing_preference",
        target_type: options.type,
        target: options.target!.trim(),
        preference: options.pref,
        reason: options.reason!.trim(),
        confidence: 1.0,
        source: "manual",
        created_at: now,
        updated_at: now,
        status: "active",
        valid_from: now.slice(0, 10),
        observed_at: now,
        review_state: "cleared",
      };
      const savedPath = await savePreference(newPref, projectRoot);
      const newRelative = path.relative(projectRoot, savedPath).replace(/\\/g, "/");

      let count = 0;
      const records = await loadStoredPreferenceRecords(projectRoot);
      for (const rec of records) {
        if (rec.filePath === savedPath) {
          continue;
        }
        if (rec.preference.target === oldTarget.trim() && rec.preference.status === "active") {
          await overwriteStoredPreference({
            ...rec,
            preference: normalizePreference({
              ...rec.preference,
              status: "superseded",
              superseded_by: newRelative,
              updated_at: new Date().toISOString(),
              valid_until: rec.preference.valid_until ?? new Date().toISOString(),
              supersession_reason: rec.preference.supersession_reason ?? "Superseded via brain supersede-preference",
            }),
          });
          count += 1;
        }
      }

      output.write(`Superseded ${count} old preference(s). New preference saved to: ${savedPath}\n`);
    });

  program;

  program
    .command("lint-preferences")
    .description("Validate all preference files against schema.")
    .action(async () => {
      const projectRoot = await helpers.resolveProjectRoot();
      const preferences = await loadAllPreferences(projectRoot);
      let errors = 0;
      for (const p of preferences) {
        try {
          validatePreference(p);
        } catch (e: any) {
          process.stderr.write(`Lint error in preference for ${p.target}: ${e.message}\n`);
          errors++;
        }
      }
      if (errors === 0) {
        output.write("All preferences are valid.\n");
      } else {
        output.write(`Found ${errors} error(s) in preferences.\n`);
        process.exit(1);
      }
    });

  program;

  program
    .command("normalize-preferences")
    .description("Normalize all preference files (formatting, fields).")
    .action(async () => {
      const projectRoot = await helpers.resolveProjectRoot();
      const records = await loadStoredPreferenceRecords(projectRoot);
      for (const rec of records) {
        await overwriteStoredPreference(rec);
      }
      output.write(`Normalized ${records.length} preference(s).\n`);
    });

  program;
}
