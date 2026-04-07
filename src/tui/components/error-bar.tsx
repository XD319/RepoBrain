import React from "react";
import { Box, Text } from "ink";

export interface ErrorBarProps {
  error: string | null;
}

export function ErrorBar({ error }: ErrorBarProps): React.JSX.Element {
  if (!error) {
    return (
      <Box marginTop={1}>
        <Text color="gray">Status: OK</Text>
      </Box>
    );
  }
  return (
    <Box marginTop={1}>
      <Text color="red">Error: {error}</Text>
    </Box>
  );
}
