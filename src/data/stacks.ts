export interface StackDefinition {
  id: string;
  max: number;
  gainOn: "kill";
  resetOn: "encounter_start";
}

export const STACKS = {
  momentum: { id: "momentum", max: 5, gainOn: "kill", resetOn: "encounter_start" },
} as const satisfies Record<string, StackDefinition>;

export type StackId = keyof typeof STACKS;
