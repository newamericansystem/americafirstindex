param env string
param suffix string
param location string
param tags object
param planSku string
param keyVaultUri string
param publicWebOrigin string
param mailFrom string
param storageAccountName string
param mediaBaseUrl string
param appInsightsConnectionString string

func kvRef(vaultUri string, secretName string) string =>
  '@Microsoft.KeyVault(SecretUri=${vaultUri}secrets/${secretName}/)'

resource plan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: 'asp-afi-${env}'
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: planSku
  }
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2024-11-01' = {
  name: 'app-afi-api-${env}-${suffix}'
  location: location
  tags: tags
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/v1/health'
      appCommandLine: 'node dist/server.js'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'APP_ENV', value: env }
        { name: 'PUBLIC_WEB_ORIGIN', value: publicWebOrigin }
        { name: 'ALLOWED_ORIGINS', value: '${publicWebOrigin},https://*.azurestaticapps.net' }
        { name: 'DATABASE_URL', value: kvRef(keyVaultUri, 'database-url') }
        { name: 'SESSION_SECRET', value: kvRef(keyVaultUri, 'session-secret') }
        { name: 'CONGRESS_API_KEY', value: kvRef(keyVaultUri, 'congress-api-key') }
        { name: 'AZURE_MAPS_KEY', value: kvRef(keyVaultUri, 'azure-maps-key') }
        { name: 'ACS_CONNECTION_STRING', value: kvRef(keyVaultUri, 'acs-connection-string') }
        { name: 'MAIL_FROM', value: mailFrom }
        { name: 'STORAGE_ACCOUNT_NAME', value: storageAccountName }
        { name: 'MEDIA_BASE_URL', value: mediaBaseUrl }
        { name: 'ENTRA_TENANT_ID', value: '' }
        { name: 'ENTRA_ADMIN_API_CLIENT_ID', value: '' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsightsConnectionString }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'false' }
      ]
    }
  }
}

output name string = app.name
output defaultHostName string = app.properties.defaultHostName
output principalId string = app.identity.principalId
