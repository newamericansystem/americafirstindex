param env string
param suffix string
param location string
param tags object
param skuName string
param adminLogin string
@secure()
param adminPassword string
param devClientIps array

var isProd = env == 'prod'

resource server 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-afi-${env}-${suffix}'
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    storage: {
      storageSizeGB: isProd ? 64 : 32
      autoGrow: 'Enabled'
    }
    authConfig: {
      passwordAuth: 'Enabled'
      activeDirectoryAuth: 'Disabled'
    }
    backup: {
      backupRetentionDays: isProd ? 14 : 7
      // Fixed at creation; cannot be changed later.
      geoRedundantBackup: isProd ? 'Enabled' : 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

// Flexible Server rejects concurrent child operations, so children are chained with dependsOn.
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: server
  name: 'afi'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'azure.extensions'
  properties: {
    value: 'POSTGIS,CITEXT,PGCRYPTO'
    source: 'user-override'
  }
  dependsOn: [database]
}

resource secureTransport 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: server
  name: 'require_secure_transport'
  properties: {
    value: 'ON'
    source: 'user-override'
  }
  dependsOn: [extensions]
}

resource allowAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: server
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
  dependsOn: [secureTransport]
}

@batchSize(1)
resource devRules 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = [
  for (ip, i) in devClientIps: {
    parent: server
    name: 'dev-client-${i}'
    properties: {
      startIpAddress: ip
      endIpAddress: ip
    }
    dependsOn: [allowAzure]
  }
]

output name string = server.name
output fqdn string = server.properties.fullyQualifiedDomainName
