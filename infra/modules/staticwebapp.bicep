param env string
param location string
param tags object

resource site 'Microsoft.Web/staticSites@2024-11-01' = {
  name: 'stapp-afi-${env}'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

output name string = site.name
output defaultHostname string = site.properties.defaultHostname
