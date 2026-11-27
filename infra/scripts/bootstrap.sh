#!/usr/bin/env bash
# One-time setup per environment. Run as a subscription Owner (or User Access Administrator + Contributor),
# with `gh` signed in.
# Usage: LOCATION=centralus ./infra/scripts/bootstrap.sh dev|prod
set -euo pipefail
ENV="${1:?usage: bootstrap.sh dev|prod}"
LOCATION="${LOCATION:?set LOCATION}"
REPO="newamericansystem/americafirstindex"
RG="rg-afi-${ENV}"
ID_NAME="id-afi-github-${ENV}"

# The deploy identity is scoped to its resource group and cannot register providers itself.
for ns in Microsoft.AlertsManagement Microsoft.Communication Microsoft.DBforPostgreSQL Microsoft.Insights \
  Microsoft.KeyVault Microsoft.ManagedIdentity Microsoft.Maps Microsoft.OperationalInsights \
  Microsoft.Storage Microsoft.Web; do
  az provider register -n "$ns" --wait -o none
done

az group create -n "$RG" -l "$LOCATION" --tags app=americafirstindex env="$ENV" -o none
az identity create -g "$RG" -n "$ID_NAME" -o none
PRINCIPAL_ID=$(az identity show -g "$RG" -n "$ID_NAME" --query principalId -o tsv)
CLIENT_ID=$(az identity show -g "$RG" -n "$ID_NAME" --query clientId -o tsv)
RG_ID=$(az group show -n "$RG" --query id -o tsv)

az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role "Contributor" --scope "$RG_ID" -o none
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role "Role Based Access Control Administrator" --scope "$RG_ID" -o none

# GitHub issues OIDC subjects keyed by immutable owner/repo IDs: repo:{owner}@{ownerId}/{repo}@{repoId}:...
SUBJECT_REPO=$(gh api "repos/${REPO}" -q '"\(.owner.login)@\(.owner.id)/\(.name)@\(.id)"')
az identity federated-credential create -g "$RG" --identity-name "$ID_NAME" \
  --name "github-${ENV}" --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:${SUBJECT_REPO}:environment:${ENV}" --audiences "api://AzureADTokenExchange" -o none

echo "AZURE_CLIENT_ID=${CLIENT_ID}"
