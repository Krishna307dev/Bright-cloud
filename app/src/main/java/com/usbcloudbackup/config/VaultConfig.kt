package com.usbcloudbackup.config

/**
 * Shared-Vault Configuration.
 *
 * In the Shared-Vault architecture, all physical USB drives are backed up into
 * a shared vault namespace, decoupling device installation identity from physical storage.
 */
object VaultConfig {
    /**
     * Default canonical vault identifier.
     * Maps to `vaults/{DEFAULT_VAULT_ID}/` in Firestore and `backups/{DEFAULT_VAULT_ID}/` in Backblaze B2.
     */
    const val DEFAULT_VAULT_ID = "default"
}
