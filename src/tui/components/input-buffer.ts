import React from "react";
import { Text } from "ink";

export interface InputBufferKey {
  backspace?: boolean;
  return?: boolean;
}

export function applyInputBuffer(current: string, input: string, key: InputBufferKey): string {
  if (key.backspace || input === "\u007f") {
    return current.slice(0, -1);
  }
  if (key.return) {
    return current;
  }
  if (input.length === 1) {
    return current + input;
  }
  return current;
}

export function parseCommaSeparatedValues(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export interface InputLineProps {
  label: string;
  value: string;
  active?: boolean;
}

export function InputLine({ label, value, active = false }: InputLineProps): React.JSX.Element {
  return React.createElement(Text, active ? { color: "cyan" } : {}, `${label}: ${value || "(empty)"}`);
}
