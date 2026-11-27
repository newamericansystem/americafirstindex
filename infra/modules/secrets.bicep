param keyVaultName string
param postgresFqdn string
param postgresAdminLogin string
@secure()
param postgresAdminPassword string
param mapsName string
param acsName string

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' existing = {
  name: keyVaultName
}

resource maps 'Microsoft.Maps/accounts@2023-06-01' existing = {
  name: mapsName
}

resource acs 'Microsoft.Communication/communicationServices@2023-04-01' existing = {
  name: acsName
}

resource databaseUrl 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: vault
  name: 'database-url'
  properties: {
    value: 'postgresql://${uriComponent(postgresAdminLogin)}:${uriComponent(postgresAdminPassword)}@${postgresFqdn}:5432/afi?sslmode=require'
  }
}

resource postgresPassword 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: vault
  name: 'postgres-admin-password'
  properties: {
    value: postgresAdminPassword
  }
}

resource mapsKey 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: vault
  name: 'azure-maps-key'
  properties: {
    value: maps.listKeys().primaryKey
  }
}

resource acsConnectionString 'Microsoft.KeyVault/vaults/secrets@2024-11-01' = {
  parent: vault
  name: 'acs-connection-string'
  properties: {
    value: acs.listKeys().primaryConnectionString
  }
}
