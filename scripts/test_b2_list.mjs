import { createB2PresignedUrl } from "../backend/b2-authorizer/src/sigv4.ts";

const config = {
  endpoint: "https://s3.eu-central-003.backblazeb2.com",
  keyId: "00339929bfc6e8e0000000001",
  applicationKey: "K003Oov9Q01Bsli4wN+WdX8RquZRQhs",
  bucketName: "BrightCloud",
  region: "eu-central-003"
};

async function listAll() {
  console.log("Listing all versions in BrightCloud...");
  let keyMarker = undefined;
  let versionIdMarker = undefined;
  let isTruncated = true;
  let totalVersions = 0;
  let totalMarkers = 0;
  const allObjects = [];

  while (isTruncated) {
    const queryParams = {
      versions: "",
      "max-keys": "1000"
    };
    if (keyMarker) queryParams["key-marker"] = keyMarker;
    if (versionIdMarker) queryParams["version-id-marker"] = versionIdMarker;

    const url = await createB2PresignedUrl(config, {
      method: "GET",
      objectKey: "",
      queryParams,
      expiresInSeconds: 300
    });

    const res = await fetch(url);
    if (!res.ok) {
      console.error("Failed to list versions:", res.status, await res.text());
      return;
    }

    const xml = await res.text();

    // Versions
    const vRegex = /<Version>([\s\S]*?)<\/Version>/g;
    let vMatch;
    while ((vMatch = vRegex.exec(xml)) !== null) {
      const block = vMatch[1];
      const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const versionId = block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1];
      const isLatest = block.match(/<IsLatest>([\s\S]*?)<\/IsLatest>/)?.[1];
      const size = block.match(/<Size>([\s\S]*?)<\/Size>/)?.[1];
      if (key && versionId) {
        totalVersions++;
        allObjects.push({ type: "version", key, versionId, isLatest, size });
      }
    }

    // Delete markers
    const mRegex = /<DeleteMarker>([\s\S]*?)<\/DeleteMarker>/g;
    let mMatch;
    while ((mMatch = mRegex.exec(xml)) !== null) {
      const block = mMatch[1];
      const key = block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
      const versionId = block.match(/<VersionId>([\s\S]*?)<\/VersionId>/)?.[1];
      if (key && versionId) {
        totalMarkers++;
        allObjects.push({ type: "delete_marker", key, versionId });
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

  console.log(`Found ${totalVersions} versions and ${totalMarkers} delete markers:`);
  allObjects.forEach((obj) => {
    console.log(` - [${obj.type}] ${obj.key} (version: ${obj.versionId}, size: ${obj.size || 0} bytes)`);
  });
}

listAll().catch(console.error);
