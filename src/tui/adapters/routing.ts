import type { BrainConfig } from "../../types.js";
import {
  buildTaskRoutingBundle,
  type BuildTaskRoutingBundleOptions,
  type TaskRoutingBundle,
} from "../../task-routing.js";

export interface RoutingInspectorViewModel {
  contractVersion: string;
  task: string;
  pathSource: TaskRoutingBundle["path_source"];
  paths: string[];
  displayMode: TaskRoutingBundle["display_mode"];
  warnings: string[];
  bundle: TaskRoutingBundle;
}

export async function buildRoutingInspectorViewModel(
  projectRoot: string,
  config: BrainConfig,
  options: BuildTaskRoutingBundleOptions,
): Promise<RoutingInspectorViewModel> {
  const bundle = await buildTaskRoutingBundle(projectRoot, config, options);
  return createRoutingInspectorViewModel(bundle);
}

export function createRoutingInspectorViewModel(bundle: TaskRoutingBundle): RoutingInspectorViewModel {
  return {
    contractVersion: bundle.contract_version,
    task: bundle.task,
    pathSource: bundle.path_source,
    paths: bundle.paths,
    displayMode: bundle.display_mode,
    warnings: bundle.warnings,
    bundle,
  };
}
