// The person's latest host-recorded chat turn, read for D's exact-command
// authority checks (delegation grants, decision-summary permission).
//
// Upstream AI-DLC v2.11.2 removed core's `latestPersonTurn`: the
// record-human-turn hook now keeps each message in the message store
// (`aidlc/.aidlc-sessions/messages/<id>.json`) and names it in the HUMAN_TURN
// row's `Message Id` field. This D-owned reader keeps the old contract over
// those official records, read-only: the latest HUMAN_TURN row in this clone's
// audit shard for the selected work, and the text of the typed prompt its row
// names (null when the row names none, the record is gone or cut, or the turn
// was a question-box pick). D never writes a HUMAN_TURN or a message record.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { auditBlockField, auditFilePath, personsWordsText } from "../../core/tools/aidlc-lib.ts";
import { readMessage } from "../../core/tools/aidlc-message-store.ts";

export type PersonTurn = { at: string; session: string | null; messageId: string | null; words: string | null };

export function latestPersonTurn(projectDir: string): PersonTurn | null {
  try {
    const shard = auditFilePath(projectDir);
    if (!existsSync(shard) || lstatSync(shard).isSymbolicLink() || !lstatSync(shard).isFile()) return null;
    const row = readFileSync(shard, "utf8").replace(/\r\n/g, "\n").split("\n---\n")
      .filter((block) => auditBlockField(block, "Event") === "HUMAN_TURN").at(-1);
    if (!row) return null;
    const at = auditBlockField(row, "Timestamp") ?? "";
    const session = auditBlockField(row, "Session");
    const messageId = auditBlockField(row, "Message Id");
    const message = messageId ? readMessage(projectDir, messageId) : null;
    const kept = message !== null && message.source === "prompt" && message.session === session && message.cut !== true;
    return { at, session, messageId, words: kept ? personsWordsText(message.text) : null };
  } catch {
    return null;
  }
}
