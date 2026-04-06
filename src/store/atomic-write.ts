import { readFile, rename, rm, writeFile } from "node:fs/promises";

export interface AtomicWriteOperation {
  targetPath: string;
  tempPath: string;
  backupPath: string;
  content: string;
  existed: boolean;
}

export function createAtomicWriteOperation(targetPath: string, content: string): AtomicWriteOperation {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    targetPath,
    tempPath: `${targetPath}.tmp-${stamp}`,
    backupPath: `${targetPath}.bak-${stamp}`,
    content,
    existed: false,
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await readFile(targetPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function commitAtomicWriteOperations(operations: AtomicWriteOperation[]): Promise<void> {
  if (operations.length === 0) {
    return;
  }

  const prepared: AtomicWriteOperation[] = [];
  const movedToBackup: AtomicWriteOperation[] = [];
  const committed: AtomicWriteOperation[] = [];

  try {
    for (const operation of operations) {
      operation.existed = await pathExists(operation.targetPath);
      await writeFile(operation.tempPath, operation.content, "utf8");
      prepared.push(operation);
    }

    for (const operation of operations) {
      if (operation.existed) {
        await rename(operation.targetPath, operation.backupPath);
        movedToBackup.push(operation);
      }

      await rename(operation.tempPath, operation.targetPath);
      committed.push(operation);
    }

    await Promise.all(movedToBackup.map((operation) => rm(operation.backupPath, { force: true })));
    await Promise.all(prepared.map((operation) => rm(operation.tempPath, { force: true })));
  } catch (error) {
    for (const operation of committed.reverse()) {
      await rm(operation.targetPath, { force: true }).catch(() => undefined);
    }

    for (const operation of movedToBackup.reverse()) {
      await rename(operation.backupPath, operation.targetPath).catch(() => undefined);
    }

    await Promise.all(
      prepared.flatMap((operation) => [
        rm(operation.tempPath, { force: true }).catch(() => undefined),
        rm(operation.backupPath, { force: true }).catch(() => undefined),
      ]),
    );
    throw error;
  }
}
