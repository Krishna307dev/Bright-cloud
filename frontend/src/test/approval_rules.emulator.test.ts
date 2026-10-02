import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

function checkEmulator(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/`, () => resolve(true));
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

describe('Firestore Security Rules: approvalRequests', () => {
  let testEnv: RulesTestEnvironment | null = null;
  const PROJECT_ID = 'cloudusb-rules-test';
  let isEmulatorAvailable = false;

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  const [host, portStr] = emulatorHost.split(':');
  const port = parseInt(portStr || '8080', 10);

  beforeAll(async () => {
    isEmulatorAvailable = await checkEmulator(host, port);
    if (!isEmulatorAvailable) {
      console.warn(
        '\n[Firestore Rules Test] Firestore Emulator not detected on 127.0.0.1:8080. ' +
        'To run live emulator assertions, execute:\n' +
        '  npx firebase-tools emulators:exec --only firestore "npm --prefix frontend test -- src/test/approval_rules.emulator.test.ts --run"\n'
      );
      return;
    }

    const rulesPath = path.resolve(__dirname, '../../../firestore.rules');
    const rules = fs.readFileSync(rulesPath, 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host,
        port,
      },
    });
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();

      // Seed vault settings/config with adminUid for default vault (exact matching production vault structure)
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'vaults', 'default', 'settings', 'config'), {
          adminUids: ['admin-uid'],
          authorizedFriends: ['friend-uid'],
          vaultName: 'Bright Cloud Test Vault',
        });
      });
    }
  });

  const getValidPayload = (uid = 'user-owner-1', email = 'user@example.com') => ({
    uid,
    email,
    name: 'Jane Doe',
    reason: 'Need access to shared family documents',
    referredBy: 'Alice Smith',
    status: 'pending',
    createdAt: new Date('2026-10-01T10:00:00Z'),
    updatedAt: new Date('2026-10-01T10:00:00Z'),
  });

  // --- Section 1: approvalRequests Rules ---
  it('1. owner create OK: allows Google user to create their own approval request with valid fields', async () => {
    if (!testEnv) return;

    const ownerDb = testEnv
      .authenticatedContext('user-owner-1', {
        email: 'user@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    const payload = getValidPayload('user-owner-1', 'user@example.com');
    await assertSucceeds(setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), payload));

    const snap = await assertSucceeds(getDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1')));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.status).toBe('pending');
  });

  it('2. owner create with extra field denied: rejects requests containing unapproved schema keys', async () => {
    if (!testEnv) return;

    const ownerDb = testEnv
      .authenticatedContext('user-owner-1', {
        email: 'user@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    const payloadWithExtra = {
      ...getValidPayload('user-owner-1', 'user@example.com'),
      role: 'admin',
    };

    await assertFails(setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), payloadWithExtra));
  });

  it('3. owner create with mismatched email denied: cannot spoof another user email', async () => {
    if (!testEnv) return;

    const ownerDb = testEnv
      .authenticatedContext('user-owner-1', {
        email: 'realowner@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    const spoofedPayload = getValidPayload('user-owner-1', 'fakeadmin@example.com');
    await assertFails(setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), spoofedPayload));
  });

  it('4. owner update after approved denied: owner cannot modify request once status is approved or rejected', async () => {
    if (!testEnv) return;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'approvalRequests', 'user-owner-1'), {
        ...getValidPayload('user-owner-1', 'user@example.com'),
        status: 'approved',
      });
    });

    const ownerDb = testEnv
      .authenticatedContext('user-owner-1', {
        email: 'user@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    await assertFails(
      setDoc(
        doc(ownerDb, 'approvalRequests', 'user-owner-1'),
        {
          ...getValidPayload('user-owner-1', 'user@example.com'),
          reason: 'Attempting to change request after approval',
        },
        { merge: true }
      )
    );
  });

  it('5. owner cannot change createdAt on update: createdAt must remain unchanged', async () => {
    if (!testEnv) return;

    const initialDate = new Date('2026-10-01T10:00:00Z');
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'approvalRequests', 'user-owner-1'), {
        ...getValidPayload('user-owner-1', 'user@example.com'),
        createdAt: initialDate,
      });
    });

    const ownerDb = testEnv
      .authenticatedContext('user-owner-1', {
        email: 'user@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    await assertFails(
      setDoc(
        doc(ownerDb, 'approvalRequests', 'user-owner-1'),
        {
          ...getValidPayload('user-owner-1', 'user@example.com'),
          createdAt: new Date('2026-10-02T12:00:00Z'),
        },
        { merge: true }
      )
    );
  });

  it('6. other user denied: non-owner and non-admin cannot create, read, or update another user request', async () => {
    if (!testEnv) return;

    const ownerDb = testEnv
      .authenticatedContext('user-owner-1', {
        email: 'user@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();
    await assertSucceeds(
      setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), getValidPayload('user-owner-1', 'user@example.com'))
    );

    const otherDb = testEnv
      .authenticatedContext('user-other-2', {
        email: 'other@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    await assertFails(getDoc(doc(otherDb, 'approvalRequests', 'user-owner-1')));
    await assertFails(
      setDoc(
        doc(otherDb, 'approvalRequests', 'user-owner-1'),
        {
          ...getValidPayload('user-owner-1', 'user@example.com'),
          reason: 'Tampered by other user',
        },
        { merge: true }
      )
    );
    await assertFails(
      setDoc(doc(otherDb, 'approvalRequests', 'user-owner-1'), getValidPayload('user-owner-1', 'other@example.com'))
    );
  });

  it('7. anonymous user denied: unauthenticated and anonymous users cannot create, read, or write requests', async () => {
    if (!testEnv) return;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'approvalRequests', 'user-owner-1'), getValidPayload('user-owner-1', 'user@example.com'));
    });

    const anonDb = testEnv
      .authenticatedContext('anon-user', {
        firebase: { sign_in_provider: 'anonymous' },
      })
      .firestore();

    const unauthDb = testEnv.unauthenticatedContext().firestore();

    await assertFails(getDoc(doc(anonDb, 'approvalRequests', 'user-owner-1')));
    await assertFails(getDoc(doc(unauthDb, 'approvalRequests', 'user-owner-1')));
    await assertFails(setDoc(doc(anonDb, 'approvalRequests', 'anon-user'), getValidPayload('anon-user', 'anon@example.com')));
    await assertFails(setDoc(doc(unauthDb, 'approvalRequests', 'anon-user'), getValidPayload('anon-user', 'anon@example.com')));
  });

  it('8. admin status update OK: admin can read all requests and update status to approved or rejected', async () => {
    if (!testEnv) return;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'approvalRequests', 'user-owner-1'), getValidPayload('user-owner-1', 'user@example.com'));
    });

    const adminDb = testEnv
      .authenticatedContext('admin-uid', {
        email: 'admin@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    const snap = await assertSucceeds(getDocs(collection(adminDb, 'approvalRequests')));
    expect(snap.docs.length).toBe(1);

    await assertSucceeds(
      updateDoc(doc(adminDb, 'approvalRequests', 'user-owner-1'), {
        status: 'approved',
        updatedAt: new Date(),
      })
    );

    await assertSucceeds(
      updateDoc(doc(adminDb, 'approvalRequests', 'user-owner-1'), {
        status: 'rejected',
        updatedAt: new Date(),
      })
    );
  });

  it('9. admin cannot change name/reason: admin is restricted to updating status and updatedAt only', async () => {
    if (!testEnv) return;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'approvalRequests', 'user-owner-1'), getValidPayload('user-owner-1', 'user@example.com'));
    });

    const adminDb = testEnv
      .authenticatedContext('admin-uid', {
        email: 'admin@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    await assertFails(
      updateDoc(doc(adminDb, 'approvalRequests', 'user-owner-1'), {
        name: 'Admin Altered Name',
      })
    );

    await assertFails(
      updateDoc(doc(adminDb, 'approvalRequests', 'user-owner-1'), {
        reason: 'Admin Altered Reason',
      })
    );
  });

  it('10. admin invalid status denied: admin cannot set status to pending or an arbitrary string', async () => {
    if (!testEnv) return;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'approvalRequests', 'user-owner-1'), getValidPayload('user-owner-1', 'user@example.com'));
    });

    const adminDb = testEnv
      .authenticatedContext('admin-uid', {
        email: 'admin@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    await assertFails(
      updateDoc(doc(adminDb, 'approvalRequests', 'user-owner-1'), {
        status: 'pending',
      })
    );

    await assertFails(
      updateDoc(doc(adminDb, 'approvalRequests', 'user-owner-1'), {
        status: 'superadmin',
      })
    );
  });

  it('11. input validation: string length bounds and non-empty checks are enforced', async () => {
    if (!testEnv) return;

    const ownerDb = testEnv
      .authenticatedContext('user-owner-1', {
        email: 'user@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    await assertFails(
      setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), {
        ...getValidPayload('user-owner-1', 'user@example.com'),
        name: '',
      })
    );

    await assertFails(
      setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), {
        ...getValidPayload('user-owner-1', 'user@example.com'),
        name: 'A'.repeat(101),
      })
    );

    await assertFails(
      setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), {
        ...getValidPayload('user-owner-1', 'user@example.com'),
        reason: '',
      })
    );

    await assertFails(
      setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), {
        ...getValidPayload('user-owner-1', 'user@example.com'),
        reason: 'R'.repeat(1001),
      })
    );

    await assertFails(
      setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), {
        ...getValidPayload('user-owner-1', 'user@example.com'),
        referredBy: '',
      })
    );

    await assertFails(
      setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), {
        ...getValidPayload('user-owner-1', 'user@example.com'),
        referredBy: 'F'.repeat(101),
      })
    );
  });

  it('12. owner update while pending OK: resubmission with unchanged createdAt succeeds', async () => {
    if (!testEnv) return;

    const ownerDb = testEnv
      .authenticatedContext('user-owner-1', {
        email: 'user@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    const initialPayload = getValidPayload('user-owner-1', 'user@example.com');
    await assertSucceeds(setDoc(doc(ownerDb, 'approvalRequests', 'user-owner-1'), initialPayload));

    await assertSucceeds(
      setDoc(
        doc(ownerDb, 'approvalRequests', 'user-owner-1'),
        {
          ...initialPayload,
          reason: 'Updated justification before approval',
          updatedAt: new Date(),
        },
        { merge: true }
      )
    );
  });

  // --- Section 2: vaults/{vaultId}/users/{userId} Rules ---
  it('13. users rule: unapproved user creates own pending profile OK', async () => {
    if (!testEnv) return;

    const userDb = testEnv
      .authenticatedContext('applicant-1', {
        email: 'applicant@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    const profileData = {
      uid: 'applicant-1',
      email: 'applicant@example.com',
      displayName: 'Applicant User',
      photoURL: 'https://example.com/photo.jpg',
      lastLogin: new Date(),
      role: 'pending',
      createdAt: new Date(),
    };

    await assertSucceeds(setDoc(doc(userDb, 'vaults', 'default', 'users', 'applicant-1'), profileData));

    // Can read own profile
    const snap = await assertSucceeds(getDoc(doc(userDb, 'vaults', 'default', 'users', 'applicant-1')));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.role).toBe('pending');
  });

  it('14. users rule: unapproved user cannot set role other than pending on create', async () => {
    if (!testEnv) return;

    const userDb = testEnv
      .authenticatedContext('applicant-1', {
        email: 'applicant@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    // Trying to create with role 'admin'
    await assertFails(
      setDoc(doc(userDb, 'vaults', 'default', 'users', 'applicant-1'), {
        uid: 'applicant-1',
        email: 'applicant@example.com',
        role: 'admin',
      })
    );

    // Trying to create with role 'friend'
    await assertFails(
      setDoc(doc(userDb, 'vaults', 'default', 'users', 'applicant-1'), {
        uid: 'applicant-1',
        email: 'applicant@example.com',
        role: 'friend',
      })
    );

    // Trying to create profile for different UID
    await assertFails(
      setDoc(doc(userDb, 'vaults', 'default', 'users', 'victim-2'), {
        uid: 'victim-2',
        email: 'victim@example.com',
        role: 'pending',
      })
    );
  });

  it('15. users rule: unapproved user cannot change own role on update', async () => {
    if (!testEnv) return;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'vaults', 'default', 'users', 'applicant-1'), {
        uid: 'applicant-1',
        email: 'applicant@example.com',
        displayName: 'Applicant',
        role: 'pending',
      });
    });

    const userDb = testEnv
      .authenticatedContext('applicant-1', {
        email: 'applicant@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    // Updating profile metadata without changing role succeeds
    await assertSucceeds(
      updateDoc(doc(userDb, 'vaults', 'default', 'users', 'applicant-1'), {
        displayName: 'Applicant Updated Name',
        role: 'pending',
      })
    );

    // Attempting to elevate role to admin fails
    await assertFails(
      updateDoc(doc(userDb, 'vaults', 'default', 'users', 'applicant-1'), {
        role: 'admin',
      })
    );

    // Attempting to elevate role to friend fails
    await assertFails(
      updateDoc(doc(userDb, 'vaults', 'default', 'users', 'applicant-1'), {
        role: 'friend',
      })
    );
  });

  it('16. users rule: unapproved user cannot read others profiles', async () => {
    if (!testEnv) return;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'vaults', 'default', 'users', 'other-user'), {
        uid: 'other-user',
        email: 'other@example.com',
        displayName: 'Other',
        role: 'friend',
      });
    });

    const userDb = testEnv
      .authenticatedContext('applicant-1', {
        email: 'applicant@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    await assertFails(getDoc(doc(userDb, 'vaults', 'default', 'users', 'other-user')));
  });

  it('17. users rule: admin can read all users and set roles', async () => {
    if (!testEnv) return;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'vaults', 'default', 'users', 'applicant-1'), {
        uid: 'applicant-1',
        email: 'applicant@example.com',
        role: 'pending',
      });
    });

    const adminDb = testEnv
      .authenticatedContext('admin-uid', {
        email: 'admin@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    // Admin can list collection
    const snap = await assertSucceeds(getDocs(collection(adminDb, 'vaults', 'default', 'users')));
    expect(snap.docs.length).toBe(1);

    // Admin can update user role to 'friend'
    await assertSucceeds(
      updateDoc(doc(adminDb, 'vaults', 'default', 'users', 'applicant-1'), {
        role: 'friend',
      })
    );

    // Admin can delete user
    await assertSucceeds(deleteDoc(doc(adminDb, 'vaults', 'default', 'users', 'applicant-1')));
  });

  // --- Section 3: Regression for Unchanged Vault Rules ---
  it('18. unchanged rules: anonymous daemon can create and update its own source', async () => {
    if (!testEnv) return;

    const anonDb = testEnv
      .authenticatedContext('daemon-uid', {
        firebase: { sign_in_provider: 'anonymous' },
      })
      .firestore();

    const sourceData = {
      sourceId: 'src-123',
      usbVendorId: 100,
      usbProductId: 200,
      serialNumber: 'SN-001',
      volumeUuid: 'VOL-UUID-1',
      displayName: 'USB Drive 1',
      firstSeen: new Date(),
      lastSeen: new Date(),
      totalFilesBackedUp: 0,
    };

    // Daemon creates source
    await assertSucceeds(setDoc(doc(anonDb, 'vaults', 'default', 'sources', 'src-123'), sourceData));

    // Daemon updates source
    await assertSucceeds(
      updateDoc(doc(anonDb, 'vaults', 'default', 'sources', 'src-123'), {
        lastSeen: new Date(),
        totalFilesBackedUp: 10,
      })
    );
  });

  it('19. unchanged rules: anonymous daemon can create files and read/create contentHashes, but cannot read files', async () => {
    if (!testEnv) return;

    const anonDb = testEnv
      .authenticatedContext('daemon-uid', {
        firebase: { sign_in_provider: 'anonymous' },
      })
      .firestore();

    // Daemon creates file doc
    await assertSucceeds(
      setDoc(doc(anonDb, 'vaults', 'default', 'files', 'file-123'), {
        fileName: 'backup.txt',
        sourceId: 'src-123',
      })
    );

    // Daemon CANNOT read files
    await assertFails(getDoc(doc(anonDb, 'vaults', 'default', 'files', 'file-123')));

    // Daemon can read contentHashes
    const dummyHash = 'a'.repeat(64);
    await assertSucceeds(getDoc(doc(anonDb, 'vaults', 'default', 'contentHashes', dummyHash)));

    // Daemon can create contentHashes
    await assertSucceeds(
      setDoc(doc(anonDb, 'vaults', 'default', 'contentHashes', dummyHash), {
        sha256: dummyHash,
      })
    );

    // Content hash update is forbidden
    await assertFails(
      updateDoc(doc(anonDb, 'vaults', 'default', 'contentHashes', dummyHash), {
        sha256: 'b'.repeat(64),
      })
    );
  });

  it('20. unchanged rules: anonymous daemon can create backupJobs and nameReservations', async () => {
    if (!testEnv) return;

    const anonDb = testEnv
      .authenticatedContext('daemon-uid', {
        firebase: { sign_in_provider: 'anonymous' },
      })
      .firestore();

    // Daemon creates backupJob
    await assertSucceeds(
      setDoc(doc(anonDb, 'vaults', 'default', 'backupJobs', 'job-123'), {
        jobId: 'job-123',
        sourceId: 'src-123',
        state: 'RUNNING',
        startedAt: new Date(),
        completedAt: null,
        totalFiles: 5,
        skippedFiles: 0,
        uploadedFiles: 1,
        errorFiles: 0,
      })
    );

    // Daemon creates nameReservation
    await assertSucceeds(
      setDoc(doc(anonDb, 'vaults', 'default', 'nameReservations', 'res-123'), {
        reservationId: 'res-123',
        status: 'PENDING',
      })
    );
  });

  it('21. unchanged rules: anonymous daemon cannot touch settings, folderRules, users, or approvalRequests', async () => {
    if (!testEnv) return;

    const anonDb = testEnv
      .authenticatedContext('daemon-uid', {
        firebase: { sign_in_provider: 'anonymous' },
      })
      .firestore();

    await assertFails(getDoc(doc(anonDb, 'vaults', 'default', 'settings', 'config')));
    await assertFails(setDoc(doc(anonDb, 'vaults', 'default', 'settings', 'config'), { hack: true }));

    await assertFails(getDoc(doc(anonDb, 'vaults', 'default', 'folderRules', 'rule-1')));
    await assertFails(setDoc(doc(anonDb, 'vaults', 'default', 'folderRules', 'rule-1'), { hack: true }));

    await assertFails(getDoc(doc(anonDb, 'vaults', 'default', 'users', 'user-1')));
    await assertFails(setDoc(doc(anonDb, 'vaults', 'default', 'users', 'user-1'), { hack: true }));

    await assertFails(getDoc(doc(anonDb, 'approvalRequests', 'user-1')));
    await assertFails(setDoc(doc(anonDb, 'approvalRequests', 'user-1'), getValidPayload('user-1')));
  });

  it('22. unchanged rules: admin can create, update, and delete files', async () => {
    if (!testEnv) return;

    const adminDb = testEnv
      .authenticatedContext('admin-uid', {
        email: 'admin@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    // Admin creates file
    await assertSucceeds(
      setDoc(doc(adminDb, 'vaults', 'default', 'files', 'admin-file-1'), {
        name: 'test.pdf',
      })
    );

    // Admin reads file
    await assertSucceeds(getDoc(doc(adminDb, 'vaults', 'default', 'files', 'admin-file-1')));

    // Admin updates file
    await assertSucceeds(
      updateDoc(doc(adminDb, 'vaults', 'default', 'files', 'admin-file-1'), {
        name: 'updated.pdf',
      })
    );

    // Admin deletes file
    await assertSucceeds(deleteDoc(doc(adminDb, 'vaults', 'default', 'files', 'admin-file-1')));
  });

  it('23. unchanged rules: friend can read permitted files only', async () => {
    if (!testEnv) return;

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'vaults', 'default', 'files', 'shared-file-1'), {
        name: 'shared.pdf',
      });
    });

    const friendDb = testEnv
      .authenticatedContext('friend-uid', {
        email: 'friend@example.com',
        firebase: { sign_in_provider: 'google.com' },
      })
      .firestore();

    // Friend reads file
    await assertSucceeds(getDoc(doc(friendDb, 'vaults', 'default', 'files', 'shared-file-1')));

    // Friend CANNOT update file
    await assertFails(
      updateDoc(doc(friendDb, 'vaults', 'default', 'files', 'shared-file-1'), {
        name: 'tampered.pdf',
      })
    );

    // Friend CANNOT delete file
    await assertFails(deleteDoc(doc(friendDb, 'vaults', 'default', 'files', 'shared-file-1')));
  });
});
