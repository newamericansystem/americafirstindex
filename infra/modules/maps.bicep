param env string
param location string
param tags object

resource account 'Microsoft.Maps/accounts@2023-06-01' = {
  name: 'maps-afi-${env}'
  location: location
  tags: tags
  sku: {
    name: 'G2'
  }
  kind: 'Gen2'
  properties: {
    disableLocalAuth: false
  }
}

output name string = account.name
