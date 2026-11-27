param env string
param tags object
param mailFromDomain string
param linkCustomMailDomain bool

var isProd = env == 'prod'

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: 'ecs-afi-${env}'
  location: 'global'
  tags: tags
  properties: {
    dataLocation: 'United States'
  }
}

resource domain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: isProd ? mailFromDomain : 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: {
    domainManagement: isProd ? 'CustomerManaged' : 'AzureManaged'
    userEngagementTracking: 'Disabled'
  }
}

// Azure-managed domains only allow their built-in DoNotReply sender, so custom senders are prod-only.
resource sender 'Microsoft.Communication/emailServices/domains/senderUsernames@2023-04-01' = if (isProd) {
  parent: domain
  name: 'noreply'
  properties: {
    username: 'noreply'
    displayName: 'America First Index'
  }
}

resource acs 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: 'acs-afi-${env}'
  location: 'global'
  tags: tags
  properties: {
    dataLocation: 'United States'
    linkedDomains: !isProd || linkCustomMailDomain ? [domain.id] : []
  }
}

output acsName string = acs.name
output senderAddress string = isProd ? 'noreply@${mailFromDomain}' : 'DoNotReply@${domain.properties.mailFromSenderDomain}'
output verificationRecords object = isProd ? domain.properties.verificationRecords : {}
