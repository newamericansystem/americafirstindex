using '../main.bicep'

param env = 'prod'
param domain = 'americafirstindex.us'
param mailFromDomain = 'mail.americafirstindex.us'
param linkCustomMailDomain = true
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD')
param devClientIps = []
// Dev-size SKUs until traffic warrants more (human decision, step 2). Plan defaults: B2 / Standard_B2s.
param apiPlanSku = 'B1'
param postgresSkuName = 'Standard_B1ms'
