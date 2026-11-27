param env string
param suffix string
param location string
param tags object

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: 'kv-afi-${env}-${suffix}'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    // Purge protection can be turned on but never off, and the API rejects an explicit false.
    enablePurgeProtection: env == 'prod' ? true : null
    publicNetworkAccess: 'Enabled'
  }
}

output name string = vault.name
output uri string = vault.properties.vaultUri
