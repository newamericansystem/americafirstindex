targetScope = 'resourceGroup'

@allowed(['dev', 'prod'])
param env string
param location string = resourceGroup().location

@description('Azure Maps is not offered in every region; it only serves geocoding, so region is not latency-sensitive.')
param mapsLocation string = 'eastus'

@description('Public apex domain, e.g. americafirstindex.us')
param domain string

@description('Custom sending domain, used only when env == prod')
param mailFromDomain string

@description('ACS can only link a custom email domain after it is verified. Set true in prod once DNS verification succeeds.')
param linkCustomMailDomain bool = false

@secure()
param postgresAdminPassword string
param postgresAdminLogin string = 'afiadmin'

@description('Developer IPs allowed to reach Postgres (dev only)')
param devClientIps array = []

@allowed(['B1', 'B2', 'B3'])
param apiPlanSku string = env == 'prod' ? 'B2' : 'B1'

@allowed(['Standard_B1ms', 'Standard_B2s', 'Standard_B2ms'])
param postgresSkuName string = env == 'prod' ? 'Standard_B2s' : 'Standard_B1ms'

var suffix = take(uniqueString(subscription().id, resourceGroup().id), 5)
var isProd = env == 'prod'
var tags = {
  app: 'americafirstindex'
  env: env
}

resource githubIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: 'id-afi-github-${env}'
}

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    env: env
    location: location
    tags: tags
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    env: env
    suffix: suffix
    location: location
    tags: tags
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres'
  params: {
    env: env
    suffix: suffix
    location: location
    tags: tags
    skuName: postgresSkuName
    adminLogin: postgresAdminLogin
    adminPassword: postgresAdminPassword
    devClientIps: isProd ? [] : devClientIps
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    env: env
    suffix: suffix
    location: location
    tags: tags
    domain: domain
  }
}

module staticWebApp 'modules/staticwebapp.bicep' = {
  name: 'staticwebapp'
  params: {
    env: env
    location: location
    tags: tags
  }
}

module communication 'modules/communication.bicep' = {
  name: 'communication'
  params: {
    env: env
    tags: tags
    mailFromDomain: mailFromDomain
    linkCustomMailDomain: linkCustomMailDomain
  }
}

module maps 'modules/maps.bicep' = {
  name: 'maps'
  params: {
    env: env
    location: mapsLocation
    tags: tags
  }
}

var publicWebOrigin = isProd ? 'https://${domain}' : 'https://${staticWebApp.outputs.defaultHostname}'

module api 'modules/appservice-api.bicep' = {
  name: 'appservice-api'
  params: {
    env: env
    suffix: suffix
    location: location
    tags: tags
    planSku: apiPlanSku
    keyVaultUri: keyVault.outputs.uri
    publicWebOrigin: publicWebOrigin
    mailFrom: communication.outputs.senderAddress
    storageAccountName: storage.outputs.name
    mediaBaseUrl: '${storage.outputs.blobEndpoint}media'
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
  }
}

module functions 'modules/functions.bicep' = {
  name: 'functions'
  params: {
    env: env
    suffix: suffix
    location: location
    tags: tags
    keyVaultUri: keyVault.outputs.uri
    publicWebOrigin: publicWebOrigin
    apiOrigin: isProd ? 'https://api.${domain}' : 'https://${api.outputs.defaultHostName}'
    mailFrom: communication.outputs.senderAddress
    storageAccountName: storage.outputs.name
    blobEndpoint: storage.outputs.blobEndpoint
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
  }
}

module secrets 'modules/secrets.bicep' = {
  name: 'secrets'
  params: {
    keyVaultName: keyVault.outputs.name
    postgresFqdn: postgres.outputs.fqdn
    postgresAdminLogin: postgresAdminLogin
    postgresAdminPassword: postgresAdminPassword
    mapsName: maps.outputs.name
    acsName: communication.outputs.acsName
  }
}

module roles 'modules/roles.bicep' = {
  name: 'roles'
  params: {
    keyVaultName: keyVault.outputs.name
    storageAccountName: storage.outputs.name
    apiPrincipalId: api.outputs.principalId
    functionsPrincipalId: functions.outputs.principalId
    githubPrincipalId: githubIdentity.properties.principalId
  }
}

output keyVaultName string = keyVault.outputs.name
output postgresFqdn string = postgres.outputs.fqdn
output storageAccountName string = storage.outputs.name
output apiName string = api.outputs.name
output apiDefaultHostName string = api.outputs.defaultHostName
output functionAppName string = functions.outputs.name
output staticWebAppName string = staticWebApp.outputs.name
output staticWebAppDefaultHostname string = staticWebApp.outputs.defaultHostname
output acsName string = communication.outputs.acsName
output mailFrom string = communication.outputs.senderAddress
output mailDomainVerificationRecords object = communication.outputs.verificationRecords
output mapsName string = maps.outputs.name
