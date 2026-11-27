param env string
param suffix string
param location string
param tags object
param keyVaultUri string
param publicWebOrigin string
param apiOrigin string
param mailFrom string
param storageAccountName string
param blobEndpoint string
param appInsightsConnectionString string

func kvRef(vaultUri string, secretName string) string =>
  '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/${secretName}/)'

resource plan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: 'asp-afi-jobs-${env}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2024-11-01' = {
  name: 'func-afi-jobs-${env}-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storageAccountName }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
        { name: 'APP_ENV', value: env }
        { name: 'DATABASE_URL', value: kvRef(keyVaultUri, 'database-url') }
        { name: 'CONGRESS_API_KEY', value: kvRef(keyVaultUri, 'congress-api-key') }
        { name: 'ACS_CONNECTION_STRING', value: kvRef(keyVaultUri, 'acs-connection-string') }
        { name: 'OPENSTATES_API_KEY', value: kvRef(keyVaultUri, 'openstates-api-key') }
        { name: 'MAIL_FROM', value: mailFrom }
        { name: 'PUBLIC_WEB_ORIGIN', value: publicWebOrigin }
        { name: 'API_ORIGIN', value: apiOrigin }
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${blobEndpoint}func-deploy'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: {
        name: 'node'
        version: '26'
      }
    }
  }
}

output name string = app.name
output principalId string = app.identity.principalId
