// D-owned adapter for the existing source/native engine hook dispatcher.
import { runPersistence } from "../d-persistence-hook.ts";
export const run = (input: string): number => runPersistence(input, "pre");
