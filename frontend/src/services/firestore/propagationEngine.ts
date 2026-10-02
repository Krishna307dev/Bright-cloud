import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { FolderRule } from '../../models';
import { canonicalizePath, generateRuleId, isDescendantOf } from '../../utils/path';
import { PropagationAbortedError } from '../../utils/error';
import { mapToFileRecord } from './fileService';

export interface PropagationOptions {
  forceResetOverrides?: boolean; // When true, clears customPermissions: true on files
  initialChunkSize?: number;
  onProgress?: (processed: number, total: number) => void;
}

export class PropagationEngine {
  /**
   * Fetches an active folder rule by (sourceId, relativePath).
   */
  static async getFolderRule(
    vaultId: string,
    sourceId: string,
    relativePath: string
  ): Promise<FolderRule | null> {
    const ruleId = generateRuleId(sourceId, relativePath);
    const ruleRef = doc(db, 'vaults', vaultId, 'folderRules', ruleId);
    const snap = await getDoc(ruleRef);
    if (!snap.exists()) return null;

    const data = snap.data();
    return {
      ruleId: snap.id,
      sourceId: data.sourceId || sourceId,
      relativePath: canonicalizePath(data.relativePath || ''),
      allowedFriends: data.allowedFriends || [],
      isPublicToFriends: data.isPublicToFriends ?? false,
      status: data.status || 'SYNCED',
      isDeleted: data.isDeleted ?? false,
      fallbackTarget: data.fallbackTarget || undefined,
      propagationId: data.propagationId || undefined,
      ruleVersion: data.ruleVersion || 0,
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(),
      deletedAt: data.deletedAt?.toDate ? data.deletedAt.toDate() : undefined,
      syncedAt: data.syncedAt?.toDate ? data.syncedAt.toDate() : undefined,
    };
  }

  /**
   * Lists all non-deleted folder rules for a given source (Admin only).
   */
  static async listActiveRulesForSource(vaultId: string, sourceId: string): Promise<FolderRule[]> {
    const rulesRef = collection(db, 'vaults', vaultId, 'folderRules');
    const q = query(rulesRef, where('sourceId', '==', sourceId));
    const snap = await getDocs(q);

    return snap.docs
      .map(d => {
        const data = d.data();
        return {
          ruleId: d.id,
          sourceId: data.sourceId || sourceId,
          relativePath: canonicalizePath(data.relativePath || ''),
          allowedFriends: data.allowedFriends || [],
          isPublicToFriends: data.isPublicToFriends ?? false,
          status: data.status || 'SYNCED',
          isDeleted: data.isDeleted ?? false,
          fallbackTarget: data.fallbackTarget || undefined,
          propagationId: data.propagationId || undefined,
          ruleVersion: data.ruleVersion || 0,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(),
          deletedAt: data.deletedAt?.toDate ? data.deletedAt.toDate() : undefined,
          syncedAt: data.syncedAt?.toDate ? data.syncedAt.toDate() : undefined,
        };
      })
      .filter(r => !r.isDeleted);
  }

  /**
   * Creates or updates a folder rule, bumping ruleVersion and source.rulesGeneration atomically.
   */
  static async setFolderRule(
    vaultId: string,
    sourceId: string,
    relativePath: string,
    isPublicToFriends: boolean,
    allowedFriends: string[]
  ): Promise<{ ruleId: string; ruleVersion: number; propagationId: string; rulesGeneration: number }> {
    const canonical = canonicalizePath(relativePath);
    const ruleId = generateRuleId(sourceId, canonical);
    const ruleRef = doc(db, 'vaults', vaultId, 'folderRules', ruleId);
    const sourceRef = doc(db, 'vaults', vaultId, 'sources', sourceId);

    const propagationId = crypto.randomUUID();

    return await runTransaction(db, async transaction => {
      const [ruleSnap, sourceSnap] = await Promise.all([
        transaction.get(ruleRef),
        transaction.get(sourceRef),
      ]);

      const currentRule = ruleSnap.exists() ? ruleSnap.data() : null;
      const currentSource = sourceSnap.exists() ? sourceSnap.data() : {};

      const nextRuleVersion = (currentRule?.ruleVersion || 0) + 1;
      const nextRulesGeneration = (currentSource.rulesGeneration || 0) + 1;

      // Update folder rule
      transaction.set(ruleRef, {
        ruleId,
        sourceId,
        relativePath: canonical,
        allowedFriends,
        isPublicToFriends,
        status: 'PROPAGATING',
        isDeleted: false,
        propagationId,
        ruleVersion: nextRuleVersion,
        updatedAt: serverTimestamp(),
      });

      // Update source rulesGeneration anchor
      transaction.update(sourceRef, {
        rulesGeneration: nextRulesGeneration,
      });

      return {
        ruleId,
        ruleVersion: nextRuleVersion,
        propagationId,
        rulesGeneration: nextRulesGeneration,
      };
    });
  }

  /**
   * Soft-deletes a folder rule by recording a durable tombstone and computing fallbackTarget.
   */
  static async deleteFolderRule(
    vaultId: string,
    sourceId: string,
    relativePath: string
  ): Promise<{ ruleId: string; ruleVersion: number; propagationId: string; rulesGeneration: number; fallbackTarget: { isPublicToFriends: boolean; allowedFriends: string[] } }> {
    const canonical = canonicalizePath(relativePath);
    const ruleId = generateRuleId(sourceId, canonical);
    const ruleRef = doc(db, 'vaults', vaultId, 'folderRules', ruleId);
    const sourceRef = doc(db, 'vaults', vaultId, 'sources', sourceId);

    const propagationId = crypto.randomUUID();

    // Determine surviving ancestor rule before deleting
    const allActive = await this.listActiveRulesForSource(vaultId, sourceId);
    const surviving = allActive.filter(r => r.ruleId !== ruleId && isDescendantOf(canonical, r.relativePath));
    surviving.sort((a, b) => b.relativePath.length - a.relativePath.length);
    const nearestAncestor = surviving[0] || null;

    const fallbackTarget = {
      isPublicToFriends: nearestAncestor?.isPublicToFriends ?? false,
      allowedFriends: nearestAncestor?.allowedFriends ?? [],
    };

    const result = await runTransaction(db, async transaction => {
      const [ruleSnap, sourceSnap] = await Promise.all([
        transaction.get(ruleRef),
        transaction.get(sourceRef),
      ]);

      if (!ruleSnap.exists()) {
        throw new Error(`Folder rule ${ruleId} does not exist.`);
      }

      const currentRule = ruleSnap.data();
      const currentSource = sourceSnap.exists() ? sourceSnap.data() : {};

      const nextRuleVersion = (currentRule.ruleVersion || 0) + 1;
      const nextRulesGeneration = (currentSource.rulesGeneration || 0) + 1;

      // Soft-delete tombstone
      transaction.update(ruleRef, {
        status: 'DELETED',
        isDeleted: true,
        fallbackTarget,
        deletedAt: serverTimestamp(),
        propagationId,
        ruleVersion: nextRuleVersion,
        updatedAt: serverTimestamp(),
      });

      // Update source rulesGeneration
      transaction.update(sourceRef, {
        rulesGeneration: nextRulesGeneration,
      });

      return {
        ruleId,
        ruleVersion: nextRuleVersion,
        propagationId,
        rulesGeneration: nextRulesGeneration,
      };
    });

    return { ...result, fallbackTarget };
  }

  /**
   * Propagates permissions to all descendant files in chunks using the Transactional Chunk Mutation Protocol.
   * Adheres strictly to read-before-write ordering and adaptive chunk sizing.
   */
  static async propagateFolderPermissions(
    vaultId: string,
    sourceId: string,
    relativePath: string,
    targetPolicy: { isPublicToFriends: boolean; allowedFriends: string[] },
    workerContext: {
      ruleId: string;
      ruleVersion: number;
      propagationId: string;
      rulesGeneration: number;
      isTombstone?: boolean;
    },
    options: PropagationOptions = {}
  ): Promise<void> {
    const canonical = canonicalizePath(relativePath);
    const ruleRef = doc(db, 'vaults', vaultId, 'folderRules', workerContext.ruleId);
    const sourceRef = doc(db, 'vaults', vaultId, 'sources', sourceId);

    let chunkSize = Math.min(options.initialChunkSize || 200, 300); // Ceiling 300 to stay safely under Firestore 500 ops limit
    let totalProcessed = 0;

    // Discover any deeper nested rules under this folder path to preserve de-escalation invariant
    const allActiveRules = await this.listActiveRulesForSource(vaultId, sourceId);
    const deeperRules = allActiveRules.filter(
      r => r.ruleId !== workerContext.ruleId && r.relativePath.startsWith(canonical) && r.relativePath !== canonical
    );

    // Query all files for this source using single-field equality on sourceId (zero composite index required)
    const sourceFilesQuery = query(
      collection(db, 'vaults', vaultId, 'files'),
      where('sourceId', '==', sourceId)
    );
    const sourceFilesSnap = await getDocs(sourceFilesQuery);
    const allSourceFiles = sourceFilesSnap.docs.map(mapToFileRecord);

    // In-memory filter for descendant files under canonical path
    const candidateFiles = allSourceFiles.filter(file => isDescendantOf(file.relativePath, canonical));

    // Filter out files governed by deeper subfolder rules
    const eligibleFiles = candidateFiles.filter(file => {
      for (const deeperRule of deeperRules) {
        if (isDescendantOf(file.relativePath, deeperRule.relativePath)) {
          return false; // Skip file: governed by deeper rule
        }
      }
      return true;
    });

    // Step 2: Execute chunk mutation in transactions with adaptive retry
    for (let offset = 0; offset < eligibleFiles.length; offset += chunkSize) {
      const currentChunk = eligibleFiles.slice(offset, offset + chunkSize);
      let chunkCommitted = false;
      let attempt = 0;

      while (!chunkCommitted) {
        try {
          await runTransaction(db, async transaction => {
            // PHASE A: ALL READS FIRST
            const [ruleSnap, sourceSnap] = await Promise.all([
              transaction.get(ruleRef),
              transaction.get(sourceRef),
            ]);

            const fileRefs: DocumentReference[] = currentChunk.map(f => doc(db, 'vaults', vaultId, 'files', f.fileId));
            const fileSnaps = await Promise.all(fileRefs.map(ref => transaction.get(ref)));

            // PHASE B: VALIDATION & DECISION LOGIC
            if (!ruleSnap.exists()) {
              throw new PropagationAbortedError(`Rule ${workerContext.ruleId} no longer exists.`);
            }

            const currentRule = ruleSnap.data();
            const currentSource = sourceSnap.data() || {};

            if (workerContext.isTombstone && !currentRule.isDeleted) {
              throw new PropagationAbortedError(`Tombstone superseded by recreated rule ${workerContext.ruleId}.`);
            }

            if (
              currentRule.propagationId !== workerContext.propagationId ||
              currentRule.ruleVersion !== workerContext.ruleVersion
            ) {
              throw new PropagationAbortedError(`Rule generation superseded. Aborting worker.`);
            }

            if (currentSource.rulesGeneration !== workerContext.rulesGeneration) {
              throw new PropagationAbortedError(`Hierarchical policy changed under source. Aborting worker.`);
            }

            const updates: { ref: DocumentReference; data: any }[] = [];

            for (let i = 0; i < fileSnaps.length; i++) {
              const fileSnap = fileSnaps[i];
              if (!fileSnap.exists()) continue;

              const fileData = fileSnap.data();
              // Preserve explicit file-level custom permissions
              if (fileData.customPermissions === true && !options.forceResetOverrides) {
                continue;
              }

              updates.push({
                ref: fileRefs[i],
                data: {
                  isPublicToFriends: targetPolicy.isPublicToFriends,
                  allowedFriends: targetPolicy.allowedFriends,
                  customPermissions: false,
                },
              });
            }

            // PHASE C: ALL WRITES AFTERWARD
            for (const u of updates) {
              transaction.update(u.ref, u.data);
            }
          });

          chunkCommitted = true;
        } catch (err: any) {
          if (err instanceof PropagationAbortedError) {
            // Class 2 interruption: Generation superseded. Old cursor must be discarded!
            console.warn(`[PropagationEngine] ${err.message}`);
            throw err;
          }

          // Class 1 interruption: Transient deadline or lock contention -> adaptive chunk reduction
          attempt++;
          if (attempt > 3 || chunkSize <= 50) {
            throw err; // Exhausted adaptive retries
          }

          // Halve chunk size and back off
          chunkSize = Math.max(Math.floor(chunkSize / 2), 50);
          const backoffMs = Math.pow(2, attempt) * 1000;
          await new Promise(r => setTimeout(r, backoffMs));
        }
      }

      totalProcessed += currentChunk.length;
      if (options.onProgress) {
        options.onProgress(totalProcessed, eligibleFiles.length);
      }
    }

    // Step 3: Atomic Finalization Guard via transaction
    await runTransaction(db, async transaction => {
      const ruleSnap = await transaction.get(ruleRef);
      if (!ruleSnap.exists()) return;

      const data = ruleSnap.data();
      if (data.propagationId === workerContext.propagationId && data.ruleVersion === workerContext.ruleVersion) {
        transaction.update(ruleRef, {
          status: workerContext.isTombstone ? 'DELETED_SYNCED' : 'SYNCED',
          syncedAt: serverTimestamp(),
        });
      }
    });
  }

  /**
   * Helper that updates the rule and immediately propagates permissions.
   */
  static async propagateFolderRule(
    vaultId: string,
    sourceId: string,
    relativePath: string,
    policy: { isPublicToFriends: boolean; allowedFriends: string[] },
    options: PropagationOptions = {}
  ): Promise<void> {
    const res = await this.setFolderRule(
      vaultId,
      sourceId,
      relativePath,
      policy.isPublicToFriends,
      policy.allowedFriends
    );
    await this.propagateFolderPermissions(
      vaultId,
      sourceId,
      relativePath,
      policy,
      {
        ruleId: res.ruleId,
        ruleVersion: res.ruleVersion,
        propagationId: res.propagationId,
        rulesGeneration: res.rulesGeneration,
      },
      options
    );
  }

  /**
   * Helper that records a tombstone and immediately propagates ancestor fallback policy.
   */
  static async tombstoneFolderRule(
    vaultId: string,
    sourceId: string,
    relativePath: string,
    options: PropagationOptions = {}
  ): Promise<void> {
    const res = await this.deleteFolderRule(vaultId, sourceId, relativePath);
    await this.propagateFolderPermissions(
      vaultId,
      sourceId,
      relativePath,
      res.fallbackTarget,
      {
        ruleId: res.ruleId,
        ruleVersion: res.ruleVersion,
        propagationId: res.propagationId,
        rulesGeneration: res.rulesGeneration,
        isTombstone: true,
      },
      options
    );
  }

  /**
   * Performs an on-demand full vault sweep reconciling newly ingested private files
   * against active folder rules (preserving files with customPermissions = true).
   */
  static async reconcileAllVaultFiles(vaultId: string): Promise<number> {
    const filesRef = collection(db, 'vaults', vaultId, 'files');
    const snap = await getDocs(filesRef);
    let updatedCount = 0;

    for (const d of snap.docs) {
      const file = mapToFileRecord(d);
      if (!file.customPermissions) {
        const rules = await this.listActiveRulesForSource(vaultId, file.sourceId);
        const matching = rules
          .filter(r => file.relativePath === r.relativePath || isDescendantOf(file.relativePath, r.relativePath))
          .sort((a, b) => b.relativePath.length - a.relativePath.length);
        const bestRule = matching[0] || null;

        const targetPublic = bestRule ? bestRule.isPublicToFriends ?? false : false;
        const targetAllowed = bestRule ? bestRule.allowedFriends || [] : [];

        if (
          file.isPublicToFriends !== targetPublic ||
          JSON.stringify(file.allowedFriends) !== JSON.stringify(targetAllowed)
        ) {
          await runTransaction(db, async tx => {
            const fRef = doc(db, 'vaults', vaultId, 'files', file.fileId);
            const liveSnap = await tx.get(fRef);
            if (liveSnap.exists() && !liveSnap.data().customPermissions) {
              tx.update(fRef, {
                isPublicToFriends: targetPublic,
                allowedFriends: targetAllowed,
              });
              updatedCount++;
            }
          });
        }
      }
    }
    return updatedCount;
  }
}
