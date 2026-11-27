using '../main.bicep'

param env = 'dev'
param domain = 'americafirstindex.us'
param mailFromDomain = 'mail.americafirstindex.us'
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
param devClientIps = []
