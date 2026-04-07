import React from "react";
import { render } from "ink";
import { App, type ScreenId } from "./app.js";

export interface RunTuiOptions {
  projectRoot: string;
  initialScreen: ScreenId;
}

export async function runTui(options: RunTuiOptions): Promise<void> {
  const app = render(<App projectRoot={options.projectRoot} initialScreen={options.initialScreen} />);
  await app.waitUntilExit();
}
