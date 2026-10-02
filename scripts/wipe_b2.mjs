import { createB2PresignedUrl } from "../backend/b2-authorizer/src/sigv4.ts";

const config = {
  endpoint: "https://s3.eu-central-003.backblazeb2.com",
  keyId: "00339929bfc6e8e0000000001",
  applicationKey: "K003Oov9Q01Bsli4wN+WdX8RquZRQhs",
  bucketName: "BrightCloud",
  region: "eu-central-003"
};

function unescapeXml(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function wipeB2(vaultId = "default") {
  const prefix = `backups/${vaultId}/`;
  const systemPrefix = `backups/${vaultId}/_system/`;
  console.log(`Starting Backblaze B2 wipe for vault: ${vaultId} (prefix: ${prefix})...`);
  console.log(`Preserving system prefix: ${systemPrefix}`);

  let isTruncated = true;
  let keyMarker = undefined;
  let versionIdMarker = undefined;
  let totalPurged = 0;

  while (isTruncated) {
    const queryParams = {
      versions: "",
      prefix: prefix,
      "max-keys": "1000"
    };
    if (keyMarker) queryParams["key-marker"] = keyMarker;
    if (versionIdMarker) queryParams["version-id-marker"] = versionIdMarker;

    const listUrl = await createB2PresignedUrl(config, {
      method: "GET",
      objectKey: "",
      queryParams,
      expiresInSeconds: 300
    });

    const res = await fetch(listUrl);
    if (!res.ok) {
      console.error(`Failed to list versions: HTTP ${res.status}`, await res.text());
      break;
    }

    const xml = await res.text();
    const itemsToPurge = [];

    // Match <Version> blocks
    const vRegex = /<Version>([\s\S]*?)<\/Version>/g;
    let vMatch;
    while ((vMatch = vRegex.exec(xml)) !== null) {
      const block = vMatch[1];
      const rawKey = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const versionId = block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1];
      if (rawKey && versionId) {
        const key = unescapeXml(rawKey);
        if (key.startsWith(systemPrefix)) {
          console.log(`[PRESERVE] System object: ${key}`);
          continue;
        }
        itemsToPurge.push({ key, versionId, type: "Version" });
      }
    }

    // Match <DeleteMarker> blocks
    const mRegex = /<DeleteMarker>([\s\S]*?)<\/DeleteMarker>/g;
    let mMatch;
    while ((mMatch = mRegex.exec(xml)) !== null) {
      const block = mMatch[1];
      const rawKey = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const versionId = block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1];
      if (rawKey && versionId) {
        const key = unescapeXml(rawKey);
        if (key.startsWith(systemPrefix)) {
          console.log(`[PRESERVE] System delete marker: ${key}`);
          continue;
        }
        itemsToPurge.push({ key, versionId, type: "DeleteMarker" });
      }
    }

    console.log(`Found ${itemsToPurge.length} items to permanently delete in this batch...`);

    for (const item of itemsToPurge) {
      try {
        const delUrl = await createB2PresignedUrl(config, {
          method: "DELETE",
          objectKey: item.key,
          queryParams: { versionId: item.versionId },
          expiresInSeconds: 300
        });

        const delRes = await fetch(delUrl, {
          method: "DELETE",
          headers: { "Content-Length": "0" }
        });

        if (delRes.ok || delRes.status === 204) {
          totalPurged++;
          console.log(`[DELETED] ${item.key} (${item.type}, version: ${item.versionId})`);
        } else {
          console.warn(`[WARN] Delete failed for ${item.key}: HTTP ${delRes.status}`);
        }
      } catch (err) {
        console.error(`[ERROR] Delete error for ${item.key}:`, err);
      }
    }

    const isTruncatedMatch = xml.match(/<IsTruncated>(true|false)<\/IsTruncated>/i);
    isTruncated = isTruncatedMatch ? isTruncatedMatch[1].toLowerCase() === "true" : false;

    if (isTruncated) {
      keyMarker = xml.match(/<NextKeyMarker>([\s\S]*?)<\/NextKeyMarker>/)?.[1];
      versionIdMarker = xml.match(/<NextVersionIdMarker>([\s\S]*?)<\/NextVersionIdMarker>/)?.[1];
      if (!keyMarker) break;
    }
  }

  console.log(`\n=== B2 Wipe Complete ===`);
  console.log(`Total versions & delete markers permanently purged: ${totalPurged}\n`);

  // Verify remaining
  console.log("Verifying remaining items in bucket under prefix...");
  const verifyUrl = await createB2PresignedUrl(config, {
    method: "GET",
    objectKey: "",
    queryParams: { prefix: prefix, versions: "" },
    expiresInSeconds: 300
  });
  const verifyRes = await fetch(verifyUrl);
  const verifyXml = await verifyRes.text();

  const remKeys = [];
  const vRegex2 = /<Key>([\s\S]*?)<\/Key>/g;
  let kMatch;
  while ((kMatch = vRegex2.exec(verifyXml)) !== null) {
    remKeys.push(unescapeXml(kMatch[1]));
  }
  const uniqueRemKeys = Array.from(new Set(remKeys));
  console.log(`Remaining keys count: ${uniqueRemKeys.length}`);
  uniqueRemKeys.forEach((k) => console.log(` - Remaining: ${k}`));
}

wipeB2().catch(console.error);
