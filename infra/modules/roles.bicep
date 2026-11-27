param keyVaultName string
param storageAccountName string
param apiPrincipalId string
param functionsPrincipalId string
param githubPrincipalId string

var roleIds = {
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  keyVaultSecretsOfficer: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  storageBlobDataOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  storageQueueDataContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  storageQueueDataMessageSender: 'c6a89b2d-59bc-44d0-9896-0f6e12d7b80a'
  storageTableDataContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
}

var vaultAssignments = [
  { principalId: apiPrincipalId, role: roleIds.keyVaultSecretsUser }
  { principalId: functionsPrincipalId, role: roleIds.keyVaultSecretsUser }
  { principalId: githubPrincipalId, role: roleIds.keyVaultSecretsOfficer }
]

var storageAssignments = [
  { principalId: apiPrincipalId, role: roleIds.storageBlobDataContributor }
  { principalId: apiPrincipalId, role: roleIds.storageQueueDataMessageSender }
  { principalId: functionsPrincipalId, role: roleIds.storageBlobDataOwner }
  { principalId: functionsPrincipalId, role: roleIds.storageQueueDataContributor }
  { principalId: functionsPrincipalId, role: roleIds.storageTableDataContributor }
  { principalId: githubPrincipalId, role: roleIds.storageBlobDataContributor }
]

resource vault 'Microsoft.KeyVault/vaults@2024-11-01' existing = {
  name: keyVaultName
}

resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' existing = {
  name: storageAccountName
}

resource vaultRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for a in vaultAssignments: {
    scope: vault
    name: guid(vault.id, a.principalId, a.role)
    properties: {
      principalId: a.principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', a.role)
    }
  }
]

resource storageRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for a in storageAssignments: {
    scope: storage
    name: guid(storage.id, a.principalId, a.role)
    properties: {
      principalId: a.principalId
      principalType: 'ServicePrincipal'
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', a.role)
    }
  }
]
