import React from "react";
import { Box, Text } from "ink";

export interface SectionProps {
  title: string;
  children: React.ReactNode;
}

export function Section({ title, children }: SectionProps): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">[{title}]</Text>
      {children}
    </Box>
  );
}
